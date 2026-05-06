"""
SQLAlchemy ORM Models
"""
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey, Text, ARRAY, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Alert(Base):
    """预警事件表"""
    __tablename__ = "alerts"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_code = Column(String(64), unique=True, nullable=False, comment="预警编码")
    station_id = Column(UUID(as_uuid=True), nullable=False, comment="站点ID")
    alert_type = Column(String(32), nullable=False, comment="预警类型: threshold, anomaly, prediction")
    alert_level = Column(String(16), nullable=False, comment="预警级别: low, medium, high, critical")
    title = Column(String(256), nullable=False, comment="预警标题")
    description = Column(Text, comment="预警描述")
    metrics = Column(JSON, comment="相关指标数据")
    pollution_type = Column(String(64), comment="污染类型识别结果")
    source_analysis = Column(JSON, comment="溯源分析结果")
    status = Column(String(16), default="pending", comment="状态")
    confirmed_by = Column(String(64), comment="确认人")
    confirmed_at = Column(DateTime(timezone=True), comment="确认时间")
    resolved_by = Column(String(64), comment="处理人")
    resolved_at = Column(DateTime(timezone=True), comment="处理时间")
    resolution_notes = Column(Text, comment="处理备注")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True, comment="软删除时间")
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "alert_code": self.alert_code,
            "station_id": str(self.station_id),
            "alert_type": self.alert_type,
            "alert_level": self.alert_level,
            "title": self.title,
            "description": self.description,
            "metrics": self.metrics,
            "pollution_type": self.pollution_type,
            "source_analysis": self.source_analysis,
            "status": self.status,
            "confirmed_by": self.confirmed_by,
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "resolved_by": self.resolved_by,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "resolution_notes": self.resolution_notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
        }


class AlertRule(Base):
    """预警规则表"""
    __tablename__ = "alert_rules"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_name = Column(String(128), nullable=False, comment="规则名称")
    rule_type = Column(String(32), nullable=False, comment="规则类型: threshold, trend, composite")
    station_ids = Column(ARRAY(UUID(as_uuid=True)), comment="适用站点ID列表")
    metric_codes = Column(ARRAY(String), comment="适用指标编码列表")
    conditions = Column(JSON, nullable=False, comment="规则条件配置")
    alert_level = Column(String(16), nullable=False, comment="触发预警级别")
    notification_channels = Column(ARRAY(String), default=list, comment="通知渠道")
    is_enabled = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "rule_name": self.rule_name,
            "rule_type": self.rule_type,
            "station_ids": [str(sid) for sid in self.station_ids] if self.station_ids else None,
            "metric_codes": self.metric_codes,
            "conditions": self.conditions,
            "alert_level": self.alert_level,
            "notification_channels": self.notification_channels,
            "is_enabled": bool(self.is_enabled) if self.is_enabled is not None else True,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
