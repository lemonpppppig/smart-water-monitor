"""Pydantic Schemas - System"""
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ==================== Role ====================
class RoleBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None


class RoleResponse(RoleBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_builtin: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ==================== User ====================
class UserBase(BaseModel):
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    full_name: Optional[str] = None
    status: str = "active"
    avatar: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=4)
    role_id: Optional[UUID] = None
    role_code: Optional[str] = None  # 允许按 code 指定


class UserUpdate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    full_name: Optional[str] = None
    status: Optional[str] = None
    avatar: Optional[str] = None
    role_id: Optional[UUID] = None
    role_code: Optional[str] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    full_name: Optional[str] = None
    status: str
    avatar: Optional[str] = None
    role_id: Optional[UUID] = None
    role_name: Optional[str] = None
    role_code: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    last_login: Optional[datetime] = None
    last_login_ip: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=4)


# ==================== Auth ====================
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 86400
    user: UserResponse


# ==================== OperationLog ====================
class OperationLogCreate(BaseModel):
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    action: str
    module: Optional[str] = None
    method: Optional[str] = None
    path: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    status: str = "success"
    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    detail: Optional[Any] = None


class OperationLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    action: str
    module: Optional[str] = None
    method: Optional[str] = None
    path: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    status: str
    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    detail: Optional[Any] = None
    created_at: Optional[datetime] = None


class BatchDeleteRequest(BaseModel):
    ids: List[UUID]
