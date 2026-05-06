"""
SQLAlchemy ORM Models
"""
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import Column, String, DateTime, JSON, Text, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Report(Base):
    """报告表"""
    __tablename__ = "reports"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_code = Column(String(64), unique=True, nullable=False, comment="报告编码")
    report_type = Column(String(32), nullable=False, comment="报告类型: daily, weekly, monthly, alert, custom")
    report_name = Column(String(256), nullable=False, comment="报告名称")
    station_id = Column(UUID(as_uuid=True), comment="站点ID（可选）")
    start_time = Column(DateTime(timezone=True), comment="数据开始时间")
    end_time = Column(DateTime(timezone=True), comment="数据结束时间")
    content = Column(JSON, comment="报告内容数据")
    file_path = Column(String(512), comment="报告文件路径")
    file_format = Column(String(16), default="pdf", comment="文件格式: pdf, excel, word")
    file_size = Column(Integer, comment="文件大小（字节）")
    status = Column(String(16), default="generating", comment="状态: generating, completed, failed")
    error_message = Column(Text, comment="错误信息")
    created_by = Column(String(64), comment="创建人")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "report_code": self.report_code,
            "report_type": self.report_type,
            "report_name": self.report_name,
            "station_id": str(self.station_id) if self.station_id else None,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "content": self.content,
            "file_path": self.file_path,
            "file_format": self.file_format,
            "file_size": self.file_size,
            "status": self.status,
            "error_message": self.error_message,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ReportTemplate(Base):
    """报告模板表"""
    __tablename__ = "report_templates"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_code = Column(String(64), unique=True, nullable=False, comment="模板编码")
    template_name = Column(String(128), nullable=False, comment="模板名称")
    template_type = Column(String(32), nullable=False, comment="模板类型: daily, weekly, monthly, alert, custom")
    description = Column(Text, comment="模板描述")
    content_structure = Column(JSON, comment="内容结构配置")
    is_default = Column(String(16), default="false", comment="是否默认模板")
    is_enabled = Column(String(16), default="true", comment="是否启用")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "template_code": self.template_code,
            "template_name": self.template_name,
            "template_type": self.template_type,
            "description": self.description,
            "content_structure": self.content_structure,
            "is_default": self.is_default,
            "is_enabled": self.is_enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ScheduledReport(Base):
    """定时报告配置表"""
    __tablename__ = "scheduled_reports"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_name = Column(String(128), nullable=False, comment="计划名称")
    report_type = Column(String(32), nullable=False, comment="报告类型")
    station_ids = Column(JSON, comment="站点ID列表")
    cron_expression = Column(String(64), comment="Cron表达式")
    recipients = Column(JSON, comment="接收人列表")
    is_enabled = Column(String(16), default="true", comment="是否启用")
    last_run_at = Column(DateTime(timezone=True), comment="上次执行时间")
    next_run_at = Column(DateTime(timezone=True), comment="下次执行时间")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "schedule_name": self.schedule_name,
            "report_type": self.report_type,
            "station_ids": self.station_ids,
            "cron_expression": self.cron_expression,
            "recipients": self.recipients,
            "is_enabled": self.is_enabled,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
