"""
预警事件数据模型
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class AlertBase(BaseModel):
    """预警基础模型"""
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
    status: Optional[str] = Field(None, description="状态: pending, confirmed, processing, resolved, ignored")
    confirmed_by: Optional[str] = Field(None, description="确认人")
    resolution_notes: Optional[str] = Field(None, description="处理备注")


class AlertResponse(AlertBase):
    """预警响应模型"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    alert_code: str
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


class AlertRuleBase(BaseModel):
    """预警规则基础模型"""
    rule_name: str = Field(..., description="规则名称", max_length=128)
    rule_type: str = Field(..., description="规则类型: threshold, trend, composite")
    station_ids: Optional[List[UUID]] = Field(None, description="适用站点ID列表")
    metric_codes: Optional[List[str]] = Field(None, description="适用指标编码列表")
    conditions: Dict[str, Any] = Field(..., description="规则条件配置")
    alert_level: str = Field(..., description="触发预警级别")
    notification_channels: List[str] = Field(default_factory=list, description="通知渠道")
    is_enabled: bool = Field(True, description="是否启用")


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


class AlertRuleResponse(AlertRuleBase):
    """规则响应模型"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    created_at: datetime
    updated_at: datetime


class AlertStatistics(BaseModel):
    """预警统计"""
    total_alerts: int
    pending_count: int
    confirmed_count: int
    resolved_count: int
    by_level: Dict[str, int]
    by_type: Dict[str, int]
