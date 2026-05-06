"""
数据模块 SQLAlchemy ORM 模型
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class MqttConnectionORM(Base):
    """MQTT连接配置表"""
    __tablename__ = "mqtt_connections"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4())[:8])
    name = Column(String(128), default="", comment="连接名称")
    broker_host = Column(String(256), nullable=False, comment="Broker地址")
    broker_port = Column(Integer, default=1883, comment="Broker端口")
    topic = Column(String(512), nullable=False, comment="订阅主题")
    module_keys = Column(String(128), nullable=True, default="", comment="绑定模块 key 列表（逗号分隔，如 m1,m2,ap）")
    username = Column(String(128), nullable=True, comment="用户名")
    password = Column(String(256), nullable=True, comment="密码")
    client_id = Column(String(128), nullable=True, comment="客户端ID")
    qos = Column(Integer, default=1, comment="QoS等级")
    station_id = Column(String(64), nullable=True, comment="绑定站点ID")
    station_name = Column(String(128), nullable=True, comment="绑定站点名称")
    status = Column(String(16), default="disconnected", comment="连接状态")
    error_message = Column(Text, nullable=True, comment="错误信息")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "broker_host": self.broker_host,
            "broker_port": self.broker_port,
            "topic": self.topic,
            "module_keys": (self.module_keys or "").split(",") if self.module_keys else [],
            "username": self.username,
            "password": self.password,
            "client_id": self.client_id,
            "qos": self.qos,
            "station_id": self.station_id,
            "station_name": self.station_name,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_active_at": self.last_active_at.isoformat() if self.last_active_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
