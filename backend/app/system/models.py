"""
SQLAlchemy ORM Models - System (User / Role / OperationLog)
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON, Text, Boolean, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Role(Base):
    """角色表"""
    __tablename__ = "sys_roles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False, comment="角色代码：admin/operator/viewer...")
    name = Column(String(128), nullable=False, comment="角色名称")
    description = Column(Text, comment="角色描述")
    permissions = Column(JSON, default=list, comment="权限列表：['station:view','station:edit',...]")
    is_builtin = Column(Boolean, default=False, comment="是否内置角色，不可删除")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("User", back_populates="role", lazy="noload")

    def to_dict(self):
        return {
            "id": str(self.id),
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "permissions": self.permissions or [],
            "is_builtin": bool(self.is_builtin),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class User(Base):
    """用户表"""
    __tablename__ = "sys_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(64), unique=True, nullable=False, comment="用户名")
    email = Column(String(128), comment="邮箱")
    phone = Column(String(32), comment="手机号")
    full_name = Column(String(128), comment="姓名")
    password_hash = Column(String(256), nullable=False, comment="密码哈希")
    role_id = Column(UUID(as_uuid=True), ForeignKey("sys_roles.id", ondelete="SET NULL"))
    status = Column(String(16), default="active", comment="active/inactive")
    last_login = Column(DateTime(timezone=True), comment="最后登录时间")
    last_login_ip = Column(String(64), comment="最后登录IP")
    avatar = Column(String(256), comment="头像URL")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    role = relationship("Role", back_populates="users", lazy="joined")

    def to_dict(self, include_role: bool = True):
        data = {
            "id": str(self.id),
            "username": self.username,
            "email": self.email,
            "phone": self.phone,
            "full_name": self.full_name,
            "role_id": str(self.role_id) if self.role_id else None,
            "status": self.status,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "last_login_ip": self.last_login_ip,
            "avatar": self.avatar,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_role and self.role is not None:
            data["role"] = self.role.to_dict()
            data["role_name"] = self.role.name
            data["role_code"] = self.role.code
            data["permissions"] = self.role.permissions or []
        else:
            data["role"] = None
            data["role_name"] = None
            data["role_code"] = None
            data["permissions"] = []
        return data


class OperationLog(Base):
    """操作日志"""
    __tablename__ = "sys_operation_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), comment="用户ID")
    username = Column(String(64), comment="用户名")
    action = Column(String(128), nullable=False, comment="操作名")
    module = Column(String(64), comment="模块")
    method = Column(String(16), comment="HTTP方法")
    path = Column(String(512), comment="请求路径")
    ip = Column(String(64), comment="客户端IP")
    user_agent = Column(String(512), comment="UA")
    status = Column(String(16), default="success", comment="success/failed")
    status_code = Column(Integer, comment="HTTP状态码")
    duration_ms = Column(Integer, comment="耗时毫秒")
    detail = Column(JSON, comment="详情：参数/错误")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": str(self.id),
            "user_id": str(self.user_id) if self.user_id else None,
            "username": self.username,
            "action": self.action,
            "module": self.module,
            "method": self.method,
            "path": self.path,
            "ip": self.ip,
            "user_agent": self.user_agent,
            "status": self.status,
            "status_code": self.status_code,
            "duration_ms": self.duration_ms,
            "detail": self.detail,
            "time": self.created_at.isoformat() if self.created_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
