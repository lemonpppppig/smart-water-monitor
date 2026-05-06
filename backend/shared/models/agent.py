"""
多智能体系统数据模型
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class AgentState(BaseModel):
    """智能体状态"""
    model_config = ConfigDict(from_attributes=True)
    
    id: Optional[UUID] = None
    agent_name: str = Field(..., description="Agent名称")
    agent_type: str = Field(..., description="Agent类型: coordinator, monitor, analysis, decision")
    status: str = Field(..., description="状态: online, offline, busy, error")
    current_task: Optional[Dict[str, Any]] = Field(None, description="当前执行任务")
    last_heartbeat: datetime = Field(default_factory=datetime.utcnow)
    metrics: Optional[Dict[str, Any]] = Field(None, description="性能指标")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AgentTask(BaseModel):
    """Agent任务"""
    task_id: str = Field(..., description="任务ID")
    task_type: str = Field(..., description="任务类型")
    priority: int = Field(1, description="优先级: 1-10")
    payload: Dict[str, Any] = Field(..., description="任务数据")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    deadline: Optional[datetime] = None


class AgentMessage(BaseModel):
    """Agent间消息"""
    message_id: str = Field(..., description="消息ID")
    from_agent: str = Field(..., description="发送方")
    to_agent: Optional[str] = Field(None, description="接收方,空表示广播")
    message_type: str = Field(..., description="消息类型: task, result, state, heartbeat")
    payload: Dict[str, Any] = Field(..., description="消息内容")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class CoordinatorState(BaseModel):
    """协调中枢状态"""
    active_agents: List[str] = Field(default_factory=list, description="活跃Agent列表")
    pending_tasks: List[AgentTask] = Field(default_factory=list, description="待处理任务")
    active_alerts: List[str] = Field(default_factory=list, description="活跃异常事件")
    system_mode: str = Field("normal", description="系统模式: normal, alert, emergency")
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class AnalysisResult(BaseModel):
    """分析结果"""
    result_id: str = Field(..., description="结果ID")
    analysis_type: str = Field(..., description="分析类型: anomaly_detection, risk_prediction, source_tracing")
    station_id: str = Field(..., description="站点ID")
    alert_id: Optional[str] = None
    status: str = Field(..., description="状态: success, failed, partial")
    findings: Dict[str, Any] = Field(..., description="分析发现")
    confidence: float = Field(..., ge=0, le=1, description="置信度")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class AnomalyDetectionResult(AnalysisResult):
    """异常检测结果"""
    analysis_type: str = "anomaly_detection"
    anomaly_score: float = Field(..., ge=0, description="异常分数")
    affected_metrics: List[str] = Field(default_factory=list)
    pattern_type: Optional[str] = None  # sudden, gradual, periodic


class RiskPredictionResult(AnalysisResult):
    """风险预测结果"""
    analysis_type: str = "risk_prediction"
    prediction_horizon: int = Field(..., description="预测时间跨度(小时)")
    risk_level: str = Field(..., description="风险等级")
    risk_probability: float = Field(..., ge=0, le=1)
    predicted_values: Dict[str, List[float]] = Field(default_factory=dict)


class SourceTracingResult(AnalysisResult):
    """溯源分析结果"""
    analysis_type: str = "source_tracing"
    source_regions: List[Dict[str, Any]] = Field(default_factory=list, description="可能来源区域及概率")
    upstream_path: List[str] = Field(default_factory=list, description="上游传播路径")
    time_window: Dict[str, datetime] = Field(..., description="时间窗口")
