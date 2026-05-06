"""
Pydantic Schema Definitions
"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


# 预警相关Schema
class AlertBase(BaseModel):
    """预警基础Schema"""
    station_id: UUID = Field(..., description="站点ID")
    alert_type: str = Field(..., description="预警类型: threshold, anomaly, prediction")
    alert_level: str = Field(..., description="预警级别: low, medium, high, critical")
    title: str = Field(..., description="预警标题", max_length=256)
    description: Optional[str] = Field(None, description="预警描述")
    metrics: Optional[Dict[str, Any]] = Field(None, description="相关指标数据")
    pollution_type: Optional[str] = Field(None, description="污染类型识别结果")
    source_analysis: Optional[Dict[str, Any]] = Field(None, description="溯源分析结果")


class AlertCreate(AlertBase):
    """创建预警请求"""
    alert_code: Optional[str] = Field(None, description="预警编码")


class AlertUpdate(BaseModel):
    """更新预警请求"""
    status: Optional[str] = Field(None, description="状态")
    confirmed_by: Optional[str] = Field(None, description="确认人")
    resolution_notes: Optional[str] = Field(None, description="处理备注")


class AlertConfirm(BaseModel):
    """确认预警请求"""
    confirmed_by: str = Field(..., description="确认人")


class AlertResolve(BaseModel):
    """解决预警请求"""
    resolved_by: str = Field(..., description="处理人")
    notes: Optional[str] = Field(None, description="处理备注")


class AlertResponse(BaseModel):
    """预警响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    alert_code: str
    station_id: UUID
    alert_type: str
    alert_level: str
    title: str
    description: Optional[str]
    metrics: Optional[Dict[str, Any]]
    pollution_type: Optional[str]
    source_analysis: Optional[Dict[str, Any]]
    status: str
    confirmed_by: Optional[str]
    confirmed_at: Optional[datetime]
    resolved_by: Optional[str]
    resolved_at: Optional[datetime]
    resolution_notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class AlertListResponse(BaseModel):
    """预警列表响应"""
    total: int
    items: List[AlertResponse]


class AlertStatistics(BaseModel):
    """预警统计"""
    total: int
    by_status: Dict[str, int]
    by_level: Dict[str, int]
    by_type: Dict[str, int]


# 预警规则相关Schema
class AlertRuleBase(BaseModel):
    """预警规则基础Schema"""
    rule_name: str = Field(..., description="规则名称", max_length=128)
    rule_type: str = Field(..., description="规则类型: threshold, trend, composite")
    station_ids: Optional[List[UUID]] = Field(None, description="适用站点ID列表")
    metric_codes: Optional[List[str]] = Field(None, description="适用指标编码列表")
    conditions: Dict[str, Any] = Field(..., description="规则条件配置")
    alert_level: str = Field(..., description="触发预警级别")
    notification_channels: List[str] = Field(default_factory=list, description="通知渠道")


class AlertRuleCreate(AlertRuleBase):
    """创建规则请求"""
    pass


class AlertRuleUpdate(BaseModel):
    """更新规则请求"""
    rule_name: Optional[str] = Field(None, max_length=128)
    conditions: Optional[Dict[str, Any]] = None
    alert_level: Optional[str] = None
    notification_channels: Optional[List[str]] = None
    is_enabled: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    """规则响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    rule_name: str
    rule_type: str
    station_ids: Optional[List[UUID]]
    metric_codes: Optional[List[str]]
    conditions: Dict[str, Any]
    alert_level: str
    notification_channels: List[str]
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class AlertRuleListResponse(BaseModel):
    """规则列表响应"""
    total: int
    items: List[AlertRuleResponse]


# 规则触发检查
class RuleCheckResult(BaseModel):
    """规则检查结果"""
    rule_id: str
    rule_name: str
    metric_code: str
    value: float
    threshold: float
    condition: str
    alert_level: str


class RuleCheckRequest(BaseModel):
    """规则检查请求"""
    station_id: str = Field(..., description="站点ID")
    data: Dict[str, Any] = Field(..., description="监测数据")


class RuleCheckResponse(BaseModel):
    """规则检查响应"""
    triggered: bool
    triggered_rules: List[RuleCheckResult]
