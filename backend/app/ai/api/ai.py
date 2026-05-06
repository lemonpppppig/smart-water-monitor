"""
AI引擎API路由
"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel, Field

from app.ai.engines.time_series import TimeSeriesEngine
from app.ai.engines.knowledge import KnowledgeEngine
from app.ai.engines.graph import GraphEngine
from app.ai.agents.coordinator import CoordinatorAgent
from app.ai.agents.output_generator import AgentProcessor
from app.ai.persistence import (
    upsert_task_safe,
    get_task_from_db,
    list_tasks_from_db,
    count_tasks_in_db,
    build_sync_task_record,
    _task_snapshot,
)
from app.ai.schemas import (
    AnomalyDetectionRequest, AnomalyDetectionResponse,
    PredictionRequest, PredictionResponse,
    RiskPredictionRequest, RiskPredictionResponse,
    PollutionIdentificationRequest, PollutionIdentificationResponse,
    CaseReasoningResponse, EmergencyPlanResponse,
    ComprehensiveAnalysisRequest, ComprehensiveAnalysisResponse,
    TraceSourceRequest, TraceSourceResponse,
    SpreadAnalysisResponse, FlowPathResponse,
    SystemStatusResponse, TaskSubmissionRequest, TaskSubmissionResponse,
    ModelTrainingRequest, ModelTrainingResponse,
    StationModelInfo, StationModelListResponse,
)

router = APIRouter(prefix="/ai", tags=["ai"])

logger = logging.getLogger(__name__)

# 初始化引擎
time_series_engine = TimeSeriesEngine()
graph_engine = GraphEngine()
coordinator = CoordinatorAgent()
# 智能体处理器（负责 decide_*_action 双输出包装）
#   - LLM 未配置时 self.llm=None，自动走 _default_*_reasoning 生成 human 文本
agent_processor = AgentProcessor(llm_client=None)

# 知识引擎延迟初始化（需要数据库连接）
_knowledge_engine = None


async def get_knowledge_engine() -> KnowledgeEngine:
    """获取知识引擎实例（延迟初始化）"""
    global _knowledge_engine
    if _knowledge_engine is None:
        import asyncpg
        from shared.db.neo4j_client import Neo4jClient
        from app.ai.config import settings
        
        # 初始化Neo4j客户端
        neo4j_client = Neo4jClient(
            uri=settings.NEO4J_URI,
            user=settings.NEO4J_USER,
            password=settings.NEO4J_PASSWORD
        )
        
        # 初始化PostgreSQL连接池
        pg_pool = await asyncpg.create_pool(settings.DATABASE_URL.replace('+asyncpg', ''))
        
        _knowledge_engine = KnowledgeEngine(neo4j_client, pg_pool)
    return _knowledge_engine


# 时序分析接口
@router.post("/anomaly/detect", response_model=AnomalyDetectionResponse)
async def detect_anomaly(request: AnomalyDetectionRequest):
    """异常检测（含智能体双输出）

    在核心检测结果的基础上，调用 ``AgentProcessor.decide_anomaly_action``
    追加 machine/human 双输出，与 PPT Part 2 约定保持一致。
    """
    result = time_series_engine.detect_anomaly(
        request.station_id,
        request.metric,
        request.data
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # 构造 decide_anomaly_action 要求的 engine_result 格式（anomalies[]+ lstm_score + is_anomaly）
    #   - detect_anomaly() 返回的是单指标格式：{is_anomaly, anomaly_score, threshold, metric, station_id}
    #   - 转换为核心方法 detect_anomaly_core 的签名，供智能体包装使用
    is_anom = bool(result.get("is_anomaly", False))
    last_value = request.data[-1] if request.data else None
    anomalies_list: List[Dict[str, Any]] = []
    if is_anom and last_value is not None:
        anomalies_list = [{
            "metric": request.metric,
            "value": last_value,
            "name": request.metric,
        }]
    engine_result = {
        "anomalies": anomalies_list,
        "lstm_score": float(result.get("anomaly_score", 0.0)),
        "is_anomaly": is_anom,
    }
    try:
        decision = await agent_processor.decide_anomaly_action(
            engine_result=engine_result,
            station=request.station_id,
            data={request.metric: last_value} if last_value is not None else {},
        )
        result["machine"] = decision.get("machine")
        result["human"] = decision.get("human")
        result["anomalies"] = anomalies_list
    except Exception as e:
        # 双输出失败不阻滞主结果
        logger.warning(f"[anomaly.detect] decide_anomaly_action failed: {e}")

    return result


@router.post("/prediction/forecast", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """趋势预测（已降级）

    全站统一到 LSTM AutoEncoder，该模型不支持趋势预测。
    该接口保留仅供兼容，会返回空 predictions。
    模型评估请改用 /ai/evaluation/reconstruction。
    """
    result = time_series_engine.predict(
        request.station_id,
        request.metric,
        request.hours
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@router.post("/evaluation/reconstruction")
async def evaluate_reconstruction(request: PredictionRequest):
    """基于站点级 LSTM AutoEncoder 的重构误差评估。

    流程：
      1. 从 TDengine 拉取该站点最近 `hours` 小时的全量指标历史；
      2. 加载该站点 LSTM AE 模型，对每个滑动窗口做重构；
      3. 汇总每个时刻被覆盖窗口的重构均值；
      4. 输出目标指标的 actual vs reconstructed 时序 + 误差统计。
    """
    from datetime import timedelta
    from app.ai.config import settings as ai_settings
    seq_len = getattr(ai_settings, "LSTM_SEQUENCE_LENGTH", 24)
    try:
        from app.data.db.tdengine import get_tdengine_client
        td = get_tdengine_client()
        end_time = datetime.utcnow()
        # 自适应扩窗：若样本不足 seq_len * 1.5，自动翻倍拉取，最多 5 次（上限 ≈ 30 天）
        requested_hours = max(int(request.hours or 24), 1)
        current_hours = requested_hours
        history: List[Dict[str, Any]] = []
        attempts: List[Dict[str, Any]] = []
        for _attempt in range(6):
            start_time = end_time - timedelta(hours=current_hours)
            history = td.query_water_quality(request.station_id, start_time, end_time, None) or []
            attempts.append({"hours": current_hours, "rows": len(history)})
            if len(history) >= seq_len + 1:
                break
            # 扩窗
            if current_hours >= 24 * 30:
                break
            current_hours = min(current_hours * 2, 24 * 30)
    except Exception as e:
        logger.exception(f"[evaluation.reconstruction] fetch history failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {e}")

    if not history:
        raise HTTPException(
            status_code=400,
            detail=f"No historical data available for station {request.station_id} in the last {current_hours}h. 请确认数据采集服务是否在运行。"
        )

    result = time_series_engine.evaluate_reconstruction(
        request.station_id, request.metric, history
    )
    # 模型不存在时自动训练后重试
    if "error" in result and "model not found" in result["error"].lower():
        logger.info(f"[evaluation.reconstruction] auto-training model for station {request.station_id}")
        # 从历史数据中提取可用指标
        available_metrics: List[str] = []
        if history:
            sample = history[0]
            from app.ai.training import _ALLOWED_METRICS
            available_metrics = [k for k in sample.keys() if k in _ALLOWED_METRICS and sample[k] is not None]
        # 确保请求的 metric 在列表中
        if request.metric not in available_metrics:
            available_metrics.insert(0, request.metric)
        if available_metrics:
            train_result = time_series_engine.train_station_model(
                request.station_id, available_metrics, history, epochs=30
            )
            if train_result.get("success"):
                # 同步更新数据库绑定记录
                try:
                    from app.ai.persistence import upsert_station_model_safe
                    await upsert_station_model_safe(
                        station_id=request.station_id,
                        updates={
                            "model_type": "lstm_autoencoder",
                            "metrics": available_metrics,
                            "epochs": 30,
                            "final_loss": train_result.get("final_loss"),
                            "samples": train_result.get("samples"),
                            "data_source": "tdengine",
                            "model_file": train_result.get("model_file"),
                            "params_file": train_result.get("params_file"),
                            "status": "active",
                            "error": None,
                            "trained_at": datetime.utcnow(),
                        },
                    )
                except Exception as _e:
                    logger.warning(f"[evaluation.reconstruction] upsert model record failed: {_e}")
                # 重新评估
                result = time_series_engine.evaluate_reconstruction(
                    request.station_id, request.metric, history
                )
            else:
                logger.warning(f"[evaluation.reconstruction] auto-train failed: {train_result.get('error')}")
    if "error" in result:
        raise HTTPException(
            status_code=400,
            detail=f"{result['error']} （已自动扩窗至 {current_hours}h，实际拿到 {len(history)} 行）"
        )
    # 回填实际使用的窗口、尝试次数，方便前端提示
    result["window_hours_used"] = current_hours
    result["window_hours_requested"] = requested_hours
    result["fetch_attempts"] = attempts
    return result


@router.post("/prediction/risk", response_model=RiskPredictionResponse)
async def predict_risk(request: RiskPredictionRequest):
    """风险预测

    模型未就绪（LSTM 未训练或 /prediction/forecast 降级返回空预测）时，
    降级返回 risk_level=unknown + 空 predictions，避免 ResponseValidationError 导致 500。

    同步接口：直接用 build_sync_task_record 落任务记录，不经过 coordinator 异步队列，
    避免任务永远 pending。
    """
    task_id = f"task_sync_risk_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
    payload = request.model_dump()

    try:
        # 直接执行
        prediction = time_series_engine.predict(
            request.station_id,
            request.metric,
            request.hours,
        )

        # 模型未就绪降级：构造合法的空 PredictionResponse 占位
        model_missing = ("error" in prediction) or ("predictions" not in prediction)
        if model_missing:
            model_error_msg = prediction.get("error") if isinstance(prediction, dict) else "Model not found"
            prediction = {
                "station_id": request.station_id,
                "metric": request.metric,
                "predictions": [],
                "horizon_hours": request.hours,
            }
            risk_level = "unknown"
            risk_probability = 0.0
            logger = __import__("logging").getLogger(__name__)
            logger.warning(
                f"[predict_risk] model not ready for {request.station_id}/{request.metric}: {model_error_msg}"
            )
        else:
            risk_level = "low"
            risk_probability = 0.0
            for pred in prediction.get("predictions", []) or []:
                value = pred.get("value", 0)
                if request.metric == "ph" and (value < 6.0 or value > 9.0):
                    risk_level = "high"
                    risk_probability = 0.8
                    break
                elif request.metric == "do" and value < 2.0:
                    risk_level = "high"
                    risk_probability = 0.8
                    break

        result = {
            "analysis_type": "risk_prediction",
            "station_id": request.station_id,
            "metric": request.metric,
            "risk_level": risk_level,
            "risk_probability": risk_probability,
            "prediction": prediction,
            "timestamp": datetime.now().isoformat(),
        }

        # 同步落任务记录
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="risk_prediction",
            payload=payload,
            status="completed",
            result={"risk_level": risk_level, "risk_probability": risk_probability},
            priority=7,
        ))
        return result
    except Exception as e:
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="risk_prediction",
            payload=payload,
            status="failed",
            error=str(e),
            priority=7,
        ))
        raise


# 知识推理接口
@router.post("/knowledge/identify", response_model=PollutionIdentificationResponse)
async def identify_pollution(request: PollutionIdentificationRequest):
    """污染类型识别（充分实现版：规则图谱 + 历史案例 + 应急预案）

    这个接口是前端告警页、智能体页的统一入口，内部走 knowledge.analyze_knowledge_core:
    1. 从 Neo4j 缓存的规则特征做打分，得分最高者即污染类型
    2. 从 PostgreSQL pollution_cases 按类型拉最近 3 个历史案例
    3. 从 Neo4j EmergencyPlan 拉对应的处置预案
    同步返回 + 自动落 task 历史
    """
    engine = await get_knowledge_engine()
    task_id = f"sync_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
    payload = request.data if isinstance(request.data, dict) else {"data": request.data}
    try:
        # 1. 规则识别（已移除 0.3 阈值：有得分即返回最高项）
        identify_result = await engine.identify_pollution_type(request.data)
        pollution_type = identify_result.get("pollution_type", "unknown")

        # 2. 案例检索 + 预案获取（并行）
        cases: list = []
        plan = None
        if pollution_type and pollution_type != "unknown":
            try:
                async with engine.pg_pool.acquire() as conn:
                    rows = await conn.fetch(
                        "SELECT case_code, pollution_type, description, cause, source, "
                        "actions_taken, outcome, recovery_days, occurrence_date "
                        "FROM pollution_cases WHERE pollution_type = $1 "
                        "ORDER BY occurrence_date DESC LIMIT 3",
                        pollution_type,
                    )
                    cases = [
                        {
                            **dict(r),
                            # 时间字段序列化为字符串，避免 JSON 编码问题
                            "occurrence_date": r["occurrence_date"].isoformat() if r.get("occurrence_date") else None,
                        }
                        for r in rows
                    ]
            except Exception as case_err:
                # 案例查询失败不影响识别主流程
                logger.warning(f"[identify] 案例检索失败: {case_err}")

            try:
                plan = await engine.neo4j_client.get_emergency_plan(pollution_type)
            except Exception as plan_err:
                logger.warning(f"[identify] 预案获取失败: {plan_err}")

        # 3. 合并完整响应
        result = {
            **identify_result,
            "cases": cases,
            "plan": plan,
        }

        # 4. 追加智能体双输出（PPT Part 4）
        #    knowledge 结构对齐 decide_response 的入参：{pollution:{type,name,score}, plan, cases}
        try:
            severity = (request.alert_level or "high").lower()
            knowledge_bundle = {
                "pollution": {
                    "type": pollution_type,
                    "name": identify_result.get("pollution_name", "未知"),
                    "score": float(identify_result.get("confidence", 0.0)),
                },
                "plan": plan or {},
                "cases": cases,
            }
            decision = await agent_processor.decide_response(
                knowledge=knowledge_bundle,
                severity=severity,
                anomalies=request.anomalies,
                source_info=request.source_info,
            )
            result["machine"] = decision.get("machine")
            result["human"] = decision.get("human")
        except Exception as dec_err:
            logger.warning(f"[identify] decide_response failed: {dec_err}")

        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="knowledge_reasoning",
            payload=payload,
            status="completed",
            result=result,
        ))
        return result
    except Exception as e:
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="knowledge_reasoning",
            payload=payload,
            status="failed",
            error=str(e),
        ))
        raise


@router.post("/knowledge/cases", response_model=CaseReasoningResponse)
async def case_reasoning(request: PollutionIdentificationRequest):
    """案例推理"""
    engine = await get_knowledge_engine()
    cases = await engine.case_based_reasoning(request.data)
    return {"cases": cases}


@router.get("/knowledge/emergency-plan/{pollution_type}", response_model=EmergencyPlanResponse)
async def get_emergency_plan(pollution_type: str):
    """获取应急预案"""
    engine = await get_knowledge_engine()
    result = await engine.get_emergency_plan(pollution_type)
    return result


@router.post("/knowledge/analyze", response_model=ComprehensiveAnalysisResponse)
async def comprehensive_analysis(request: ComprehensiveAnalysisRequest):
    """综合分析（同步，自动落 task 历史）"""
    engine = await get_knowledge_engine()
    task_id = f"sync_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
    payload = request.data if isinstance(request.data, dict) else {"data": request.data}
    try:
        result = await engine.analyze(request.data)
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="comprehensive_analysis",
            payload=payload,
            status="completed",
            result=result if isinstance(result, dict) else {"result": result},
        ))
        return result
    except Exception as e:
        await upsert_task_safe(build_sync_task_record(
            task_id=task_id,
            task_type="comprehensive_analysis",
            payload=payload,
            status="failed",
            error=str(e),
        ))
        raise


# 图计算接口
async def _resolve_neo4j_station_id(station_id: str) -> str:
    """把前端传入的 station_id 解析为 Neo4j 中使用的 station_id（如 'ST_016'）。

    前端 Select 使用 PostgreSQL stations.id（UUID）作为 value，而 Neo4j
    Station 节点的 station_id 对应 PostgreSQL stations.station_code
    （如 'ST_016'）。此函数负责在调用图计算前完成 UUID → station_code 映射；
    若传入值本身已是 station_code，则原样返回。
    """
    if not station_id:
        return station_id
    # 非 UUID 形式（例如 'ST_016'）直接使用
    try:
        uuid.UUID(str(station_id))
    except (ValueError, AttributeError, TypeError):
        return station_id
    try:
        from sqlalchemy import text
        from app.ai.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text("SELECT station_code FROM stations WHERE id = :uid"),
                {"uid": str(station_id)},
            )
            row = result.first()
            if row and row[0]:
                return row[0]
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            f"[ai.graph] resolve station_id failed: {station_id} -> {e}"
        )
    return station_id


@router.post("/graph/trace-source", response_model=TraceSourceResponse)
async def trace_source(request: TraceSourceRequest):
    """污染溯源（含智能体双输出）

    在图计算结果的基础上追加 ``decide_trace_action`` 的 machine/human
    双输出，与 PPT Part 3 约定保持一致。
    """
    from datetime import datetime

    detection_time = request.detection_time
    if isinstance(detection_time, str):
        detection_time = datetime.fromisoformat(detection_time)

    # 将前端传入的 UUID 映射为 Neo4j 中的 station_id
    neo4j_sid = await _resolve_neo4j_station_id(request.station_id)

    # 使用线程池执行阻塞的图计算操作
    result = await asyncio.to_thread(
        graph_engine.trace_pollution_source,
        neo4j_sid,
        detection_time,
        request.lookback_hours
    )

    # 追加智能体双输出：decide_trace_action 的 sources 用的字段为
    #   station_name / distance / confidence 与 current sources 一致
    try:
        sources_for_agent = result.get("sources") or []
        decision = await agent_processor.decide_trace_action(
            sources=sources_for_agent,
            station=result.get("target_station") or neo4j_sid,
            anomalies=None,
        )
        result["machine"] = decision.get("machine")
        result["human"] = decision.get("human")
    except Exception as e:
        logger.warning(f"[graph.trace_source] decide_trace_action failed: {e}")

    return result


@router.post("/graph/spread-analysis", response_model=SpreadAnalysisResponse)
async def spread_analysis(request: TraceSourceRequest):
    """扩散分析"""
    from datetime import datetime
    
    detection_time = request.detection_time
    if isinstance(detection_time, str):
        detection_time = datetime.fromisoformat(detection_time)
    
    neo4j_sid = await _resolve_neo4j_station_id(request.station_id)

    # 使用线程池执行阻塞的图计算操作
    result = await asyncio.to_thread(
        graph_engine.analyze_spread,
        neo4j_sid,
        detection_time,
        forecast_hours=request.lookback_hours
    )
    return result


@router.get("/graph/path/{start_station}/{end_station}", response_model=FlowPathResponse)
async def get_flow_path(start_station: str, end_station: str):
    """获取水流路径"""
    start_sid = await _resolve_neo4j_station_id(start_station)
    end_sid = await _resolve_neo4j_station_id(end_station)
    # 使用线程池执行阻塞的图计算操作
    result = await asyncio.to_thread(
        graph_engine.get_flow_path,
        start_sid,
        end_sid
    )
    return result


@router.get("/graph/upstream/{station_id}")
async def get_upstream(station_id: str, max_depth: int = 3):
    """获取上游站点"""
    neo4j_sid = await _resolve_neo4j_station_id(station_id)
    # 使用线程池执行阻塞的图计算操作
    result = await asyncio.to_thread(
        graph_engine.get_upstream_stations,
        neo4j_sid,
        max_depth
    )
    return {"upstream": result}


@router.get("/graph/downstream/{station_id}")
async def get_downstream(station_id: str, max_depth: int = 3):
    """获取下游站点"""
    neo4j_sid = await _resolve_neo4j_station_id(station_id)
    # 使用线程池执行阻塞的图计算操作
    result = await asyncio.to_thread(
        graph_engine.get_downstream_stations,
        neo4j_sid,
        max_depth
    )
    return {"downstream": result}


# 图谱数据查询接口
@router.get("/graph/rivers")
async def get_all_rivers():
    """获取所有河流数据"""
    result = await asyncio.to_thread(graph_engine.get_all_rivers)
    return {"rivers": result, "total": len(result)}


@router.get("/graph/rivers/topology")
async def get_river_topology():
    """获取河流拓扑关系（用于可视化）"""
    result = await asyncio.to_thread(graph_engine.get_river_topology)
    return result


@router.get("/graph/pollution-sources")
async def get_pollution_sources(
    source_type: str = None,
    district_code: str = None,
    risk_level: str = None
):
    """获取所有污染源数据（支持过滤）"""
    result = await asyncio.to_thread(
        graph_engine.get_all_pollution_sources,
        source_type,
        district_code,
        risk_level
    )
    return {"pollution_sources": result, "total": len(result)}


@router.get("/graph/pollution-sources/{source_id}")
async def get_pollution_source_detail(source_id: str):
    """获取单个污染源详情"""
    result = await asyncio.to_thread(graph_engine.get_pollution_source_detail, source_id)
    if not result:
        raise HTTPException(status_code=404, detail="Pollution source not found")
    return result


@router.get("/graph/confluences")
async def get_confluences():
    """获取所有交汇点数据"""
    result = await asyncio.to_thread(graph_engine.get_all_confluences)
    return {"confluences": result, "total": len(result)}


@router.get("/graph/districts")
async def get_districts():
    """获取所有行政区数据"""
    result = await asyncio.to_thread(graph_engine.get_all_districts)
    return {"districts": result, "total": len(result)}


@router.get("/graph/statistics")
async def get_graph_statistics():
    """获取图谱统计数据"""
    result = await asyncio.to_thread(graph_engine.get_graph_statistics)
    return result


# 多智能体接口
@router.get("/agents/status", response_model=SystemStatusResponse)
async def get_system_status():
    """获取系统状态"""
    return coordinator.get_system_status()


@router.post("/agents/task", response_model=TaskSubmissionResponse)
async def submit_task(request: TaskSubmissionRequest):
    """提交任务（异步），立即落库一条 pending 记录"""
    task_id = coordinator.submit_task(
        request.task_type,
        request.payload,
        request.priority
    )
    # 立即持久化一条 pending 记录，避免首次同步窗口丢失
    task = coordinator.tasks.get(task_id)
    if task is not None:
        await upsert_task_safe(_task_snapshot(task, mode="async"))
    return {"task_id": task_id, "status": "submitted"}


@router.get("/agents/tasks")
async def list_agent_tasks(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    station_id: Optional[str] = None,
):
    """任务历史列表（DB 持久化，内存最新状态由后台同步器每 2s upsert）"""
    # 先把内存中最新状态 flush 一次，保证列表拿到的是最新的
    for task in list(coordinator.tasks.values()):
        try:
            await upsert_task_safe(_task_snapshot(task, mode="async"))
        except Exception:
            pass
    items = await list_tasks_from_db(
        limit=limit,
        offset=offset,
        status=status,
        task_type=task_type,
        station_id=station_id,
    )
    total = await count_tasks_in_db(status=status, task_type=task_type)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/agents/task/{task_id}")
async def get_task_result(task_id: str):
    """获取任务结果（内存优先，回落 DB）"""
    # 1) 内存优先
    if task_id in coordinator.tasks:
        task = coordinator.tasks[task_id]
        # 顺手 upsert 最新状态
        await upsert_task_safe(_task_snapshot(task, mode="async"))
        return {
            "task_id": task.task_id,
            "task_type": task.task_type,
            "status": task.status,
            "priority": task.priority,
            "mode": "async",
            "payload": task.payload,
            "result": task.result,
            "assigned_to": task.assigned_to,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        }
    # 2) 回落 DB
    row = await get_task_from_db(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return row


# 模型管理接口
@router.post("/models/train", response_model=ModelTrainingResponse)
async def train_model(request: ModelTrainingRequest, background_tasks: BackgroundTasks):
    """训练站点级模型（一站一模型）

    流程：
    1) 确定 metrics：优先用请求中的 metrics；其次拥旧 metric 字段 (单指标兼容)；
       均为空时从 station_metrics 表拉取该站全部启用指标。
    2) upsert ai_station_models (status=pending)，立即返回。
    3) 后台任务拉取历史数据(TDengine, 失败或不足时回落合成数据)→训练→更新绑定表。
    """
    from app.ai.training import resolve_station_metrics, run_station_training

    metrics = await resolve_station_metrics(
        request.station_id, request.metrics, request.metric
    )
    if not metrics:
        raise HTTPException(
            status_code=400,
            detail="No metrics available for this station. Please provide `metrics` explicitly or configure station_metrics.",
        )

    # 立即写入绑定表，用户刷列表即可看到 pending
    from app.ai.persistence import upsert_station_model_safe
    await upsert_station_model_safe(
        station_id=request.station_id,
        updates={
            "metrics": metrics,
            "epochs": request.epochs,
            "status": "pending",
            "error": None,
        },
    )

    background_tasks.add_task(
        run_station_training,
        request.station_id,
        metrics,
        request.epochs,
        request.lookback_days,
    )

    return {
        "station_id": request.station_id,
        "metrics": metrics,
        "success": True,
        "message": f"Training scheduled for {len(metrics)} metrics in background",
        "status": "pending",
        "version": None,
    }


@router.get("/models/stations", response_model=StationModelListResponse)
async def list_station_models(
    status: Optional[str] = Query(None, description="筛选状态"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """列出站点模型绑定关系"""
    from app.ai.persistence import list_station_models_from_db, count_station_models_in_db
    items = await list_station_models_from_db(limit=limit, offset=offset, status=status)
    total = await count_station_models_in_db(status=status)
    return {"items": items, "total": total}


@router.get("/models/status/{station_id}")
async def get_station_model_status(station_id: str):
    """查询单站点的模型绑定状态"""
    from app.ai.persistence import get_station_model_from_db
    row = await get_station_model_from_db(station_id)
    if row is None:
        # 对齐前端预期：返回空模型状态，便于展示“未训练”
        return {
            "station_id": station_id,
            "status": "untrained",
            "metrics": [],
            "has_model": False,
        }
    row["has_model"] = row.get("status") == "active"
    return row


@router.get("/models/status/{station_id}/{metric}")
async def get_model_status(station_id: str, metric: str):
    """[兼容] 查询指定指标是否在该站点模型覆盖范围内"""
    from app.ai.persistence import get_station_model_from_db
    row = await get_station_model_from_db(station_id)
    metrics = (row or {}).get("metrics") or []
    covered = metric in metrics
    return {
        "station_id": station_id,
        "metric": metric,
        "has_model": bool(row) and row.get("status") == "active" and covered,
        "covered": covered,
        "station_model_status": (row or {}).get("status", "untrained"),
        "station_model_metrics": metrics,
    }


# ============ 模型通用别名接口 (与前端 api 对齐) ============
@router.get("/models")
async def list_models_alias(
    status: Optional[str] = Query(None, description="状态筛选"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """列出所有站点模型（/models/stations 别名）"""
    from app.ai.persistence import list_station_models_from_db, count_station_models_in_db
    items = await list_station_models_from_db(limit=limit, offset=offset, status=status)
    total = await count_station_models_in_db(status=status)
    return {"items": items, "total": total}


@router.get("/models/{station_id}")
async def get_model_detail(station_id: str):
    """获取站点模型详情（/models/status/{station_id} 别名）"""
    from app.ai.persistence import get_station_model_from_db
    row = await get_station_model_from_db(station_id)
    if not row:
        raise HTTPException(status_code=404, detail="Station model not found")
    return row


@router.get("/models/{station_id}/training-history")
async def get_model_training_history(
    station_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """查询该站点的训练历史（从 ai_agent_tasks 按 station_id 筛选模型训练类任务）"""
    from app.ai.database import AsyncSessionLocal
    from app.ai.models import AgentTaskORM
    from sqlalchemy import select, desc, or_, func

    training_types = ["model_training", "train_model", "training"]
    try:
        async with AsyncSessionLocal() as session:
            base_cond = (AgentTaskORM.station_id == station_id) & AgentTaskORM.task_type.in_(training_types)
            count_stmt = select(func.count(AgentTaskORM.task_id)).where(base_cond)
            total = int((await session.execute(count_stmt)).scalar() or 0)

            stmt = (
                select(AgentTaskORM)
                .where(base_cond)
                .order_by(desc(AgentTaskORM.created_at))
                .offset(offset)
                .limit(limit)
            )
            rows = (await session.execute(stmt)).scalars().all()
            items = [r.to_dict() for r in rows]
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"[ai.training-history] fetch failed: {e}")
        items, total = [], 0
    return {"station_id": station_id, "items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/models/{station_id}/deploy")
async def deploy_model(station_id: str):
    """部署/激活站点模型（将 status 置为 active）"""
    from app.ai.persistence import get_station_model_from_db, upsert_station_model_safe
    row = await get_station_model_from_db(station_id)
    if not row:
        raise HTTPException(status_code=404, detail="Station model not found")
    if row.get("status") in ("pending", "training"):
        raise HTTPException(status_code=400, detail="Model is not ready for deployment")

    await upsert_station_model_safe(
        station_id=station_id,
        updates={"status": "active", "error": None},
    )
    updated = await get_station_model_from_db(station_id)
    return {"success": True, "message": "Model deployed", "model": updated}


@router.post("/models/{station_id}/undeploy")
async def undeploy_model(station_id: str):
    """下线站点模型（将 status 置为 inactive）"""
    from app.ai.persistence import get_station_model_from_db, upsert_station_model_safe
    row = await get_station_model_from_db(station_id)
    if not row:
        raise HTTPException(status_code=404, detail="Station model not found")
    await upsert_station_model_safe(
        station_id=station_id,
        updates={"status": "inactive"},
    )
    updated = await get_station_model_from_db(station_id)
    return {"success": True, "message": "Model undeployed", "model": updated}


@router.delete("/models/{station_id}", status_code=204)
async def delete_station_model(station_id: str):
    """删除站点模型绑定"""
    from app.ai.database import AsyncSessionLocal
    from app.ai.models import AgentStationModel
    try:
        async with AsyncSessionLocal() as session:
            row = await session.get(AgentStationModel, station_id)
            if not row:
                raise HTTPException(status_code=404, detail="Station model not found")
            await session.delete(row)
            await session.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")
    return None


# ============ 智能体任务删除 ============
@router.delete("/agents/task/{task_id}", status_code=204)
async def delete_agent_task(task_id: str):
    """删除一条智能体任务记录"""
    from app.ai.database import AsyncSessionLocal
    from app.ai.models import AgentTaskORM
    # 先清理内存中的快照
    coordinator.tasks.pop(task_id, None)
    try:
        async with AsyncSessionLocal() as session:
            row = await session.get(AgentTaskORM, task_id)
            if row:
                await session.delete(row)
                await session.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete task failed: {e}")
    return None


class _IdsRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1)


@router.post("/agents/tasks/batch-delete")
async def batch_delete_agent_tasks(request: _IdsRequest):
    """批量删除智能体任务"""
    from app.ai.database import AsyncSessionLocal
    from app.ai.models import AgentTaskORM
    deleted = 0
    for tid in request.ids:
        coordinator.tasks.pop(tid, None)
        async with AsyncSessionLocal() as session:
            row = await session.get(AgentTaskORM, tid)
            if row:
                await session.delete(row)
                await session.commit()
                deleted += 1
    return {"deleted": deleted, "total": len(request.ids)}


@router.post("/models/batch-delete")
async def batch_delete_station_models(request: _IdsRequest):
    """批量删除站点模型绑定"""
    from app.ai.database import AsyncSessionLocal
    from app.ai.models import AgentStationModel
    deleted = 0
    async with AsyncSessionLocal() as session:
        for sid in request.ids:
            row = await session.get(AgentStationModel, sid)
            if row:
                await session.delete(row)
                deleted += 1
        await session.commit()
    return {"deleted": deleted, "total": len(request.ids)}

