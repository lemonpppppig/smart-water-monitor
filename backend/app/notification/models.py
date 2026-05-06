"""
SQLAlchemy ORM Models - Notification
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Notification(Base):
    """系统通知表"""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(256), nullable=False, comment="通知标题")
    content = Column(Text, comment="通知内容")
    notification_type = Column(
        String(32), nullable=False, default="system",
        comment="通知类型: system, alert, report, task, user"
    )
    level = Column(String(16), default="info", comment="级别: info, warning, error, success")
    source = Column(String(64), comment="来源模块: station/alert/report/ai/...")
    source_id = Column(String(64), comment="来源对象ID")
    recipient = Column(String(128), comment="接收人（用户名/ID），空表示广播")
    is_read = Column(Boolean, default=False, nullable=False, comment="是否已读")
    read_at = Column(DateTime(timezone=True), comment="读取时间")
    meta = Column(JSON, comment="附加数据")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": str(self.id),
            "title": self.title,
            "content": self.content,
            "notification_type": self.notification_type,
            "level": self.level,
            "source": self.source,
            "source_id": self.source_id,
            "recipient": self.recipient,
            "is_read": bool(self.is_read),
            "read_at": self.read_at.isoformat() if self.read_at else None,
            "meta": self.meta,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
