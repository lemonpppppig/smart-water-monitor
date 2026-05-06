"""
Pydantic Schema Definitions
"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator


# 时序分析相关Schema
class AnomalyDetectionRequest(BaseModel):
    """异常检测请求"""
    station_id: str = Field(..., description="站点ID")
    metric: str = Field(..., description="指标编码")
    data: List[float] = Field(..., description="历史数据序列")


class AnomalyDetectionResponse(BaseModel):
    """异常检测响应（含智能体双输出：machine/human）

    machine：供下游系统消费的结构化决策（severity/action）。
    human：供人类阅读的四段式推理（异常模式/可能原因/风险评估/建议动作）。
    原有 is_anomaly/anomaly_score/threshold/metric/station_id 保持向后兼容。
    """
    model_config = ConfigDict(extra="allow")

    is_anomaly: bool = Field(..., description="是否异常")
    anomaly_score: float = Field(..., description="异常分数")
    threshold: float = Field(..., description="阈值")
    metric: str = Field(..., description="指标编码")
    station_id: str = Field(..., description="站点ID")
    # 智能体双输出（PPT Part 2 约定）
    machine: Optional[Dict[str, Any]] = Field(default=None, description="机器决策：severity / action")
    human: Optional[str] = Field(default=None, description="人类推理：异常模式/可能原因/风险评估/建议动作")
    anomalies: Optional[List[Dict[str, Any]]] = Field(default=None, description="命中规则的多指标异常（来自 detect_anomaly_core）")


class PredictionRequest(BaseModel):
    """预测请求"""
    station_id: str = Field(..., description="站点ID")
    metric: str = Field(..., description="指标编码")
    hours: int = Field(default=72, ge=1, le=168, description="预测时长（小时）")


class PredictionPoint(BaseModel):
    """预测点"""
    timestamp: str = Field(..., description="时间戳")
    value: float = Field(..., description="预测值")
    lower_bound: float = Field(..., description="置信区间下限")
    upper_bound: float = Field(..., description="置信区间上限")


class PredictionResponse(BaseModel):
    """预测响应"""
    station_id: str = Field(..., description="站点ID")
    metric: str = Field(..., description="指标编码")
    predictions: List[PredictionPoint] = Field(..., description="预测结果")
    horizon_hours: int = Field(..., description="预测时长")


class RiskPredictionRequest(BaseModel):
    """风险预测请求"""
    station_id: str = Field(..., description="站点ID")
    metric: str = Field(default="ph", description="指标编码")
    hours: int = Field(default=72, description="预测时长")


class RiskPredictionResponse(BaseModel):
    """风险预测响应"""
    analysis_type: str = Field(default="risk_prediction")
    station_id: str = Field(..., description="站点ID")
    metric: str = Field(..., description="指标编码")
    risk_level: str = Field(..., description="风险等级")
    risk_probability: float = Field(..., description="风险概率")
    prediction: PredictionResponse = Field(..., description="预测详情")
    timestamp: str = Field(..., description="分析时间")


# 知识推理相关Schema
class PollutionIdentificationRequest(BaseModel):
    """污染识别请求

    兼容两种前端发送格式：
    1. 标准格式：``{"data": {"pH": 7.2, ...}}``
    2. 扁平格式（告警页与智能体页在用）：``{"station_id": "...", "metrics": {...}, "alert_level": "..."}``

    统一归一化后仅 ``data`` 字段传给推理引擎。
    """
    data: Optional[Dict[str, float]] = Field(default=None, description="水质数据")
    metrics: Optional[Dict[str, Any]] = Field(default=None, description="指标数据（扁平格式兼容）")
    station_id: Optional[str] = Field(default=None, description="站点 ID（可选）")
    station_code: Optional[str] = Field(default=None, description="站点编码（可选）")
    alert_level: Optional[str] = Field(default=None, description="告警等级（可选）")
    # 跨阶段上下文（PPT 三 Part 闭环：Part 2 异常 + Part 3 溯源 → Part 4 决策）
    anomalies: Optional[List[Dict[str, Any]]] = Field(default=None, description="Part 2 异常详情，跨阶段上下文")
    source_info: Optional[Dict[str, Any]] = Field(default=None, description="Part 3 溯源 top 源头，跨阶段上下文")

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _normalize_data(self):
        """将 metrics 归一到 data，并过滤非数值、空值。

        兼容告警的元数据结构：
        - 告警 alerts.metrics 存的是 ``{"metric":"nh3_n","peak_value":2.38,"avg_value":1.96,"standard":1.0}``
          这种中 ``metric`` 是指标名字符串，``peak_value``/``avg_value`` 才是数值。
          此时展开为 ``{metric_name: peak_value 或 avg_value}`` 让规则引擎能用。
        """
        if not self.data and self.metrics:
            merged: Dict[str, float] = {}

            # 告警 meta 结构检测: metric 字段是字符串，同时存在 peak_value / avg_value
            raw = self.metrics
            meta_metric = raw.get("metric")
            if isinstance(meta_metric, str) and meta_metric:
                value_candidate = (
                    raw.get("peak_value")
                    if raw.get("peak_value") is not None
                    else raw.get("avg_value") if raw.get("avg_value") is not None
                    else raw.get("value")
                )
                if value_candidate is not None:
                    try:
                        merged[meta_metric] = float(value_candidate)
                    except (TypeError, ValueError):
                        pass
                # 告警 meta 里常附带的相关指标（如 chlorophyll、reconstruction_error）
                for extra_key in ("chlorophyll", "blue_green_algae", "reconstruction_error"):
                    ev = raw.get(extra_key)
                    if ev is not None:
                        try:
                            merged[extra_key] = float(ev)
                        except (TypeError, ValueError):
                            continue

            # 标准结构：{metric_name: number, ...}，直接遍历
            if not merged:
                for k, v in raw.items():
                    if v is None:
                        continue
                    try:
                        merged[k] = float(v)
                    except (TypeError, ValueError):
                        continue

            self.data = merged
        if self.data is None:
            self.data = {}
        return self


class PollutionIdentificationResponse(BaseModel):
    """污染识别响应（充分实现版：规则识别 + 历史案例 + 应急预案 + 智能体双输出）"""
    pollution_type: str = Field(..., description="污染类型编码")
    pollution_name: str = Field(..., description="污染类型名称")
    description: str = Field(..., description="描述")
    confidence: float = Field(..., description="置信度")
    matched_features: int = Field(default=0, description="匹配特征数")
    all_scores: Dict[str, float] = Field(default_factory=dict, description="各类型得分")
    # 完整版（涉及 Neo4j 规则图谱 + PG 案例库 + Neo4j 应急预案）
    cases: List[Dict[str, Any]] = Field(default_factory=list, description="相似历史案例（来自 PostgreSQL pollution_cases）")
    plan: Optional[Dict[str, Any]] = Field(default=None, description="应急预案（来自 Neo4j EmergencyPlan）")
    # 智能体双输出（PPT Part 4 约定）
    machine: Optional[Dict[str, Any]] = Field(default=None, description="机器决策：priority / level / actions / dept / response_time / similar_cases")
    human: Optional[str] = Field(default=None, description="人类推理：态势研判/案例参考/处置方案/预期效果")

    model_config = ConfigDict(extra="allow")


class SimilarCase(BaseModel):
    """相似案例"""
    case_id: str = Field(..., description="案例ID")
    pollution_type: str = Field(..., description="污染类型")
    pollution_name: str = Field(..., description="污染名称")
    similarity: float = Field(..., description="相似度")
    outcome: str = Field(..., description="处理结果")


class CaseReasoningResponse(BaseModel):
    """案例推理响应"""
    cases: List[SimilarCase] = Field(..., description="相似案例列表")


class EmergencyPlanResponse(BaseModel):
    """应急预案响应"""
    pollution_type: str = Field(..., description="污染类型")
    pollution_name: str = Field(..., description="污染名称")
    actions: List[str] = Field(..., description="处置措施")
    departments: List[str] = Field(..., description="责任部门")


class ComprehensiveAnalysisRequest(BaseModel):
    """综合分析请求"""
    data: Dict[str, float] = Field(..., description="水质数据")


class ComprehensiveAnalysisResponse(BaseModel):
    """综合分析响应"""
    rule_based: PollutionIdentificationResponse = Field(..., description="规则识别结果")
    case_based: List[SimilarCase] = Field(..., description="相似案例")
    emergency_plan: EmergencyPlanResponse = Field(..., description="应急预案")
    timestamp: str = Field(..., description="分析时间")


# 图计算相关Schema
class TraceSourceRequest(BaseModel):
    """溯源分析请求"""
    station_id: str = Field(..., description="站点ID")
    detection_time: datetime = Field(default_factory=datetime.now, description="检测时间")
    lookback_hours: int = Field(default=24, description="回溯时长")


class PollutionSource(BaseModel):
    """污染源"""
    station_id: str = Field(..., description="站点ID")
    station_name: str = Field(..., description="站点名称")
    # Neo4j Station 节点未必有 station_type 属性，允许为空
    station_type: Optional[str] = Field(None, description="站点类型")
    distance: float = Field(..., description="距离")
    travel_time: float = Field(..., description="传播时间")
    estimated_pollution_time: Dict[str, str] = Field(..., description="污染时间窗口")
    confidence: float = Field(..., description="置信度")


class PollutionSourceEntity(BaseModel):
    """污染源实体（来自 Neo4j 污染图谱）"""
    source_id: str = Field(..., description="污染源唯一标识")
    name: str = Field(..., description="污染源名称")
    source_type: Optional[str] = Field(None, description="类型：sewage_plant/electroplating/livestock 等")
    category: Optional[str] = Field(None, description="类别：municipal_sewage/electronics/food/furniture 等")
    entity_label: Optional[str] = Field(None, description="图谱标签：IndustrialSource / AgriculturalSource / MunicipalSource")
    river_id: Optional[str] = Field(None, description="所属河流 river_id")
    district_code: Optional[str] = Field(None, description="行政区编码")
    longitude: Optional[float] = Field(None, description="经度")
    latitude: Optional[float] = Field(None, description="纬度")
    pollutants: Optional[List[str]] = Field(None, description="主要污染指标列表")
    risk_level: Optional[str] = Field(None, description="风险等级：high/medium/low")


class TraceSourceResponse(BaseModel):
    """溯源分析响应（含智能体双输出：machine/human）

    machine：{source, confidence, alert}。
    human：假设排列/证据分析/最终判断/下游预警。
    """
    model_config = ConfigDict(extra="allow")

    target_station: str = Field(..., description="目标站点")
    detection_time: str = Field(..., description="检测时间")
    sources: List[PollutionSource] = Field(..., description="可能污染来源站点")
    pollution_sources: List[PollutionSourceEntity] = Field(default_factory=list, description="上游路径所经河流上的污染源实体（图谱结合）")
    total_sources: int = Field(..., description="上游候选来源总数")
    total_pollution_entities: int = Field(0, description="污染源实体总数")
    confidence: float = Field(..., description="整体置信度")
    message: Optional[str] = Field(None, description="附加说明")
    # 智能体双输出（PPT Part 3 约定）
    machine: Optional[Dict[str, Any]] = Field(default=None, description="机器决策：source / confidence / alert")
    human: Optional[str] = Field(default=None, description="人类推理：假设排列/证据分析/最终判断/下游预警")


class SpreadPrediction(BaseModel):
    """扩散预测"""
    station_id: str = Field(..., description="站点ID")
    station_name: str = Field(..., description="站点名称")
    distance: float = Field(..., description="距离")
    estimated_arrival: str = Field(..., description="预计到达时间")
    hours_from_now: float = Field(..., description="距现在小时数")


class SpreadAnalysisResponse(BaseModel):
    """扩散分析响应"""
    source_station: str = Field(..., description="源站点")
    detection_time: str = Field(..., description="检测时间")
    forecast_hours: int = Field(..., description="预测时长")
    affected_stations: List[SpreadPrediction] = Field(..., description="受影响站点")
    total_affected: int = Field(..., description="总数")


class GraphPathNode(BaseModel):
    """路径节点"""
    station_id: str = Field(..., description="站点ID")
    name: str = Field(..., description="站点名称")
    station_type: Optional[str] = Field(None, description="站点类型")


class FlowPathResponse(BaseModel):
    """水流路径响应"""
    path: List[GraphPathNode] = Field(..., description="路径节点")
    total_distance: float = Field(..., description="总距离")


# 多智能体相关Schema
class AgentStatus(BaseModel):
    """Agent状态"""
    agent_name: str = Field(..., description="Agent名称")
    agent_type: str = Field(..., description="Agent类型")
    status: str = Field(..., description="状态")
    current_task: Optional[str] = Field(None, description="当前任务")
    capabilities: List[str] = Field(..., description="能力列表")


class SystemStatusResponse(BaseModel):
    """系统状态响应"""
    system_mode: str = Field(..., description="系统模式")
    active_agents: int = Field(..., description="活跃Agent数")
    total_agents: int = Field(..., description="总Agent数")
    pending_tasks: int = Field(..., description="待处理任务数")
    running_tasks: int = Field(..., description="运行中任务数")
    active_alerts: int = Field(..., description="活跃预警数")


class TaskSubmissionRequest(BaseModel):
    """任务提交请求"""
    task_type: str = Field(..., description="任务类型")
    priority: int = Field(default=5, ge=1, le=10, description="优先级")
    payload: Dict[str, Any] = Field(..., description="任务载荷")


class TaskSubmissionResponse(BaseModel):
    """任务提交响应"""
    task_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="状态")


class TaskResult(BaseModel):
    """任务结果"""
    task_id: str = Field(..., description="任务ID")
    task_type: str = Field(..., description="任务类型")
    status: str = Field(..., description="状态")
    result: Optional[Dict[str, Any]] = Field(None, description="结果")
    created_at: str = Field(..., description="创建时间")
    completed_at: Optional[str] = Field(None, description="完成时间")


# 模型训练相关Schema
class ModelTrainingRequest(BaseModel):
    """模型训练请求（站点级粒度）

    训练粒度为一站一模型，模型覆盖 metrics 列表中的全部指标。
    - 若 metrics 未提供，后端自动从 station_metrics 表拉取该站全部启用指标。
    - metric 为兼容字段：若仅传 metric，等价于 metrics=[metric]。
    """
    station_id: str = Field(..., description="站点业务编码 station_code")
    metric: Optional[str] = Field(None, description="[兼容] 单指标编码，若传入则等价于 metrics=[metric]")
    metrics: Optional[List[str]] = Field(None, description="模型覆盖的指标编码列表；为空时自动拉取该站全部启用指标")
    epochs: int = Field(default=50, ge=10, le=200, description="训练轮数")
    lookback_days: int = Field(default=30, ge=1, le=365, description="拉取历史数据的回望天数")


class ModelTrainingResponse(BaseModel):
    """模型训练响应"""
    station_id: str = Field(..., description="站点ID")
    metrics: List[str] = Field(default_factory=list, description="本次训练覆盖的指标列表")
    success: bool = Field(..., description="是否成功提交")
    message: str = Field(..., description="消息")
    status: Optional[str] = Field(None, description="当前状态: pending/training/active/failed")
    version: Optional[int] = Field(None, description="模型版本（同步成功后才有值）")


class StationModelInfo(BaseModel):
    """站点模型绑定信息"""
    station_id: str
    station_name: Optional[str] = None
    model_type: Optional[str] = None
    metrics: List[str] = Field(default_factory=list)
    epochs: Optional[int] = None
    final_loss: Optional[float] = None
    samples: Optional[int] = None
    data_source: Optional[str] = None
    version: Optional[int] = None
    status: Optional[str] = None
    error: Optional[str] = None
    trained_at: Optional[str] = None
    updated_at: Optional[str] = None


class StationModelListResponse(BaseModel):
    """站点模型绑定列表响应"""
    items: List[StationModelInfo] = Field(default_factory=list)
    total: int = 0
