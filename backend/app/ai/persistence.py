"""
AI Agent 任务持久化层

策略:
- coordinator 保持纯内存 Dict（无侵入）
- 本模块提供 upsert / get / list 工具 + 周期同步后台任务
- API 层在 submit_task 后立即 upsert 一条，避免首次同步窗口丢失
"""
import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.agents.coordinator import AgentTask, CoordinatorAgent
from app.ai.database import AsyncSessionLocal
from app.ai.models import AgentTaskORM, AgentStationModel

logger = logging.getLogger(__name__)


def _extract_station_id(payload: Optional[Dict[str, Any]]) -> Optional[str]:
    """尝试从 payload 中抽取 station_id 用作检索索引"""
    if not isinstance(payload, dict):
        return None
    # 常见键位
    for key in ("station_id", "stationId"):
        if key in payload and payload[key]:
            return str(payload[key])
    data = payload.get("data") if isinstance(payload.get("data"), dict) else None
    if data:
        for key in ("station_id", "stationId"):
            if key in data and data[key]:
                return str(data[key])
    return None


def _task_snapshot(task: AgentTask, *, mode: str = "async") -> Dict[str, Any]:
    """把 coordinator 的 dataclass 任务转为可序列化 dict"""
    return {
        "task_id": task.task_id,
        "task_type": task.task_type,
        "status": task.status,
        "priority": task.priority,
        "mode": mode,
        "payload": task.payload,
        "result": task.result,
        "assigned_to": task.assigned_to,
        "station_id": _extract_station_id(task.payload),
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }


async def upsert_task(session: AsyncSession, snapshot: Dict[str, Any]) -> None:
    """写入或更新一条任务记录"""
    task_id = snapshot["task_id"]
    existing = await session.get(AgentTaskORM, task_id)
    if existing is None:
        existing = AgentTaskORM(task_id=task_id)
        session.add(existing)

    for field in (
        "task_type",
        "status",
        "priority",
        "mode",
        "payload",
        "result",
        "error",
        "assigned_to",
        "station_id",
        "created_at",
        "started_at",
        "completed_at",
    ):
        if field in snapshot and snapshot[field] is not None:
            setattr(existing, field, snapshot[field])


async def upsert_task_safe(snapshot: Dict[str, Any]) -> None:
    """独立会话版本的 upsert，供 API / 回调直接调用"""
    try:
        async with AsyncSessionLocal() as session:
            await upsert_task(session, snapshot)
            await session.commit()
    except Exception as e:
        logger.warning(f"[ai.persist] upsert task {snapshot.get('task_id')} failed: {e}")


async def get_task_from_db(task_id: str) -> Optional[Dict[str, Any]]:
    """从 DB 读取单条任务"""
    try:
        async with AsyncSessionLocal() as session:
            row = await session.get(AgentTaskORM, task_id)
            return row.to_dict() if row else None
    except Exception as e:
        logger.warning(f"[ai.persist] get task {task_id} failed: {e}")
        return None


async def list_tasks_from_db(
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    station_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """列出任务，按创建时间倒序"""
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(AgentTaskORM).order_by(desc(AgentTaskORM.created_at))
            if status:
                stmt = stmt.where(AgentTaskORM.status == status)
            if task_type:
                stmt = stmt.where(AgentTaskORM.task_type == task_type)
            if station_id:
                stmt = stmt.where(AgentTaskORM.station_id == station_id)
            stmt = stmt.offset(offset).limit(limit)
            res = await session.execute(stmt)
            rows = res.scalars().all()
            return [r.to_dict() for r in rows]
    except Exception as e:
        logger.warning(f"[ai.persist] list tasks failed: {e}")
        return []


async def count_tasks_in_db(
    status: Optional[str] = None,
    task_type: Optional[str] = None,
) -> int:
    """统计任务数"""
    try:
        from sqlalchemy import func

        async with AsyncSessionLocal() as session:
            stmt = select(func.count(AgentTaskORM.task_id))
            if status:
                stmt = stmt.where(AgentTaskORM.status == status)
            if task_type:
                stmt = stmt.where(AgentTaskORM.task_type == task_type)
            res = await session.execute(stmt)
            return int(res.scalar() or 0)
    except Exception as e:
        logger.warning(f"[ai.persist] count tasks failed: {e}")
        return 0


class CoordinatorPersister:
    """周期把 coordinator.tasks 同步到 DB"""

    def __init__(self, coordinator: CoordinatorAgent, interval: float = 2.0):
        self.coordinator = coordinator
        self.interval = interval
        self._task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None
        # 记录已同步的任务状态指纹，避免重复写
        self._fingerprints: Dict[str, str] = {}

    def _fingerprint(self, task: AgentTask) -> str:
        return f"{task.status}|{task.completed_at}|{task.started_at}|{task.assigned_to}"

    async def _tick(self) -> None:
        try:
            tasks_snapshot = list(self.coordinator.tasks.values())
        except Exception:
            return

        for task in tasks_snapshot:
            fp = self._fingerprint(task)
            if self._fingerprints.get(task.task_id) == fp:
                continue
            try:
                async with AsyncSessionLocal() as session:
                    await upsert_task(session, _task_snapshot(task))
                    await session.commit()
                self._fingerprints[task.task_id] = fp
            except Exception as e:
                logger.debug(f"[ai.persist] sync task {task.task_id} failed: {e}")

    async def _loop(self) -> None:
        assert self._stop_event is not None
        while not self._stop_event.is_set():
            await self._tick()
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                pass

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._loop())
        logger.info("[ai.persist] CoordinatorPersister started")

    async def stop(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except Exception:
                pass
        logger.info("[ai.persist] CoordinatorPersister stopped")


# ==================== 站点模型绑定表 ====================


async def upsert_station_model(
    session: AsyncSession,
    station_id: str,
    updates: Dict[str, Any],
) -> AgentStationModel:
    """上入或更新站点模型绑定记录"""
    existing = await session.get(AgentStationModel, station_id)
    if existing is None:
        existing = AgentStationModel(station_id=station_id)
        session.add(existing)
    for field, value in updates.items():
        if hasattr(existing, field):
            setattr(existing, field, value)
    return existing


async def upsert_station_model_safe(station_id: str, updates: Dict[str, Any]) -> None:
    try:
        async with AsyncSessionLocal() as session:
            await upsert_station_model(session, station_id, updates)
            await session.commit()
    except Exception as e:
        logger.warning(f"[ai.persist] upsert station model {station_id} failed: {e}")


async def get_station_model_from_db(station_id: str) -> Optional[Dict[str, Any]]:
    try:
        async with AsyncSessionLocal() as session:
            row = await session.get(AgentStationModel, station_id)
            return row.to_dict() if row else None
    except Exception as e:
        logger.warning(f"[ai.persist] get station model {station_id} failed: {e}")
        return None


async def list_station_models_from_db(
    limit: int = 200,
    offset: int = 0,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(AgentStationModel).order_by(desc(AgentStationModel.updated_at))
            if status:
                stmt = stmt.where(AgentStationModel.status == status)
            stmt = stmt.offset(offset).limit(limit)
            res = await session.execute(stmt)
            rows = res.scalars().all()
            return [r.to_dict() for r in rows]
    except Exception as e:
        logger.warning(f"[ai.persist] list station models failed: {e}")
        return []


async def count_station_models_in_db(status: Optional[str] = None) -> int:
    try:
        from sqlalchemy import func

        async with AsyncSessionLocal() as session:
            stmt = select(func.count(AgentStationModel.station_id))
            if status:
                stmt = stmt.where(AgentStationModel.status == status)
            res = await session.execute(stmt)
            return int(res.scalar() or 0)
    except Exception as e:
        logger.warning(f"[ai.persist] count station models failed: {e}")
        return 0


def build_sync_task_record(
    task_id: str,
    task_type: str,
    payload: Dict[str, Any],
    *,
    status: str = "completed",
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    priority: int = 5,
) -> Dict[str, Any]:
    """构建一条同步模式的任务记录（用于 knowledge/identify、knowledge/analyze 等）"""
    now = datetime.utcnow()
    return {
        "task_id": task_id,
        "task_type": task_type,
        "status": status,
        "priority": priority,
        "mode": "sync",
        "payload": payload,
        "result": result,
        "error": error,
        "assigned_to": None,
        "station_id": _extract_station_id(payload),
        "created_at": now,
        "started_at": now,
        "completed_at": now if status in ("completed", "failed") else None,
    }
