"""
AI 站点级模型训练编排

职责:
- resolve_station_metrics: 确定本次训练覆盖哪些指标（入参 > 兼容单指标 > station_metrics 默认）
- run_station_training: 后台任务：拉数据 -> 训练 -> 更新绑定表
"""
import asyncio
import logging
import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from app.ai.database import AsyncSessionLocal
from app.ai.persistence import (
    upsert_station_model_safe,
    get_station_model_from_db,
    upsert_task_safe,
    build_sync_task_record,
)

logger = logging.getLogger(__name__)

# 与 time_series.py 的白名单保持一致 + 常见水质字段
_ALLOWED_METRICS = {
    "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
    "chlorophyll", "blue_green_algae", "total_n", "total_p",
    "codcr", "transparency", "orp", "water_temperature",
}


async def resolve_station_metrics(
    station_id: str,
    metrics: Optional[List[str]],
    legacy_metric: Optional[str],
) -> List[str]:
    """确定训练覆盖的指标列表。

    优先级：
    1) 显式 metrics
    2) 兼容 legacy metric -> [metric]
    3) 从 station_metrics 拉取该站全部 is_enabled=true 的指标
    """
    if metrics:
        return [m for m in metrics if m in _ALLOWED_METRICS]
    if legacy_metric and legacy_metric in _ALLOWED_METRICS:
        return [legacy_metric]

    # 从 DB 拉取
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(
                text(
                    """
                    SELECT sm.metric_code
                    FROM station_metrics sm
                    JOIN stations s ON sm.station_id = s.id
                    WHERE s.station_code = :code AND sm.is_enabled = true
                    ORDER BY sm.metric_code
                    """
                ),
                {"code": station_id},
            )
            codes = [row[0] for row in res.fetchall()]
            return [c for c in codes if c in _ALLOWED_METRICS]
    except Exception as e:
        logger.warning(f"[ai.training] resolve metrics for {station_id} failed: {e}")
        return []


async def _fetch_station_name(station_id: str) -> Optional[str]:
    try:
        async with AsyncSessionLocal() as session:
            res = await session.execute(
                text("SELECT station_name FROM stations WHERE station_code = :code"),
                {"code": station_id},
            )
            row = res.fetchone()
            return row[0] if row else None
    except Exception:
        return None


def _fetch_history_from_tdengine(
    station_id: str, metrics: List[str], lookback_days: int
) -> List[Dict[str, Any]]:
    """同步从 TDengine 拉水质历史（会阻塞，在线程池中执行）"""
    try:
        from app.data.db.tdengine import get_tdengine_client

        client = get_tdengine_client()
        end = datetime.utcnow()
        start = end - timedelta(days=lookback_days)
        # fields 需要加上 ts 以便时间维度稳定
        fields = ["ts", *metrics]
        return client.query_water_quality(station_id, start, end, fields) or []
    except Exception as e:
        logger.warning(f"[ai.training] tdengine fetch failed for {station_id}: {e}")
        return []


def _synthesize_data(metrics: List[str], count: int = 400) -> List[Dict[str, Any]]:
    """合成数据回落：仅保证训练管线可跑通。均值/波动按指标类型给合理默认值。"""
    defaults = {
        "ph": (7.2, 0.3),
        "do": (8.0, 0.8),
        "nh3_n": (0.4, 0.15),
        "codmn": (3.5, 0.8),
        "turbidity": (15.0, 5.0),
        "conductivity": (350.0, 60.0),
        "chlorophyll": (5.0, 2.0),
        "blue_green_algae": (2000.0, 800.0),
        "total_n": (1.5, 0.4),
        "total_p": (0.1, 0.04),
        "codcr": (15.0, 4.0),
        "transparency": (0.6, 0.2),
        "orp": (200.0, 50.0),
        "water_temperature": (18.0, 3.0),
    }
    rnd = random.Random(42)
    base_ts = datetime.utcnow() - timedelta(hours=count)
    rows: List[Dict[str, Any]] = []
    for i in range(count):
        row: Dict[str, Any] = {"ts": base_ts + timedelta(hours=i)}
        for m in metrics:
            mean, sigma = defaults.get(m, (1.0, 0.2))
            row[m] = rnd.gauss(mean, sigma)
        rows.append(row)
    return rows


async def run_station_training(
    station_id: str,
    metrics: List[str],
    epochs: int,
    lookback_days: int,
) -> None:
    """后台任务：拉数据 → 训练 → 更新绑定表

    同时将训练事件写入 ai_agent_tasks，供模型管理页「训练任务流水」与「版本历史」使用。
    """
    station_name = await _fetch_station_name(station_id)
    task_id = f"train_{station_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    train_payload = {
        "station_id": station_id,
        "station_name": station_name,
        "metrics": metrics,
        "epochs": epochs,
        "lookback_days": lookback_days,
    }

    # 开始：落一条 running 记录（created_at / started_at 只在第一次写入时赋值）
    try:
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="training",
            payload=train_payload,
            status="running",
            priority=5,
        ))
    except Exception as _e:
        logger.warning(f"[ai.training] write task running failed: {_e}")

    # 标记 training
    await upsert_station_model_safe(
        station_id=station_id,
        updates={
            "station_name": station_name,
            "metrics": metrics,
            "epochs": epochs,
            "status": "training",
            "error": None,
        },
    )

    # 拉历史数据（线程池内同步调用）
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(
        None, _fetch_history_from_tdengine, station_id, metrics, lookback_days
    )
    data_source = "tdengine"
    if len(data) < 48:  # 数据不足时回落合成
        logger.warning(
            f"[ai.training] insufficient history ({len(data)}) for {station_id}, "
            f"fallback to synthetic data"
        )
        data = _synthesize_data(metrics, count=400)
        data_source = "synthetic"

    # 训练（CPU 密集，放线程池）
    from app.ai.api.ai import time_series_engine  # 复用模块级实例

    def _train():
        return time_series_engine.train_station_model(station_id, metrics, data, epochs)

    result = await loop.run_in_executor(None, _train)

    if not result.get("success"):
        await upsert_station_model_safe(
            station_id=station_id,
            updates={
                "status": "failed",
                "error": result.get("error") or "Training failed",
                "samples": result.get("samples"),
                "data_source": data_source,
            },
        )
        try:
            # 注意：不覆盖 created_at / started_at，只写 status/error/completed_at
            await upsert_task_safe({
                "task_id": task_id,
                "task_type": "training",
                "status": "failed",
                "priority": 5,
                "mode": "sync",
                "payload": train_payload,
                "result": None,
                "error": result.get("error") or "Training failed",
                "assigned_to": None,
                "station_id": station_id,
                "completed_at": datetime.utcnow(),
            })
        except Exception as _e:
            logger.warning(f"[ai.training] write task failed record failed: {_e}")
        logger.warning(f"[ai.training] station={station_id} training failed: {result.get('error')}")
        return

    # 成功 → 更新绑定表（版本递增）
    prev = await get_station_model_from_db(station_id)
    prev_version = (prev or {}).get("version") or 0
    new_version = prev_version + 1
    await upsert_station_model_safe(
        station_id=station_id,
        updates={
            "station_name": station_name,
            "model_type": "lstm_autoencoder",
            "metrics": result["metrics"],
            "epochs": epochs,
            "final_loss": result.get("final_loss"),
            "samples": result.get("samples"),
            "data_source": data_source,
            "model_file": result.get("model_file"),
            "params_file": result.get("params_file"),
            "version": new_version,
            "status": "active",
            "error": None,
            "trained_at": datetime.utcnow(),
        },
    )
    try:
        # 不覆盖 created_at / started_at，只写 status/result/completed_at
        await upsert_task_safe({
            "task_id": task_id,
            "task_type": "training",
            "status": "completed",
            "priority": 5,
            "mode": "sync",
            "payload": train_payload,
            "result": {
                "version": new_version,
                "final_loss": result.get("final_loss"),
                "samples": result.get("samples"),
                "metrics": result.get("metrics"),
                "data_source": data_source,
            },
            "error": None,
            "assigned_to": None,
            "station_id": station_id,
            "completed_at": datetime.utcnow(),
        })
    except Exception as _e:
        logger.warning(f"[ai.training] write task completed record failed: {_e}")
    logger.info(
        f"[ai.training] station={station_id} trained OK, version={new_version}, "
        f"loss={result.get('final_loss'):.4f}, samples={result.get('samples')}"
    )
