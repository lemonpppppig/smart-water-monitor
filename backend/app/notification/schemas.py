"""Pydantic Schema - Notification"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class NotificationBase(BaseModel):
    title: str = Field(..., max_length=256, description="通知标题")
    content: Optional[str] = Field(None, description="通知内容")
    notification_type: str = Field("system", description="system/alert/report/task/user")
    level: str = Field("info", description="info/warning/error/success")
    source: Optional[str] = Field(None, max_length=64)
    source_id: Optional[str] = Field(None, max_length=64)
    recipient: Optional[str] = Field(None, max_length=128)
    meta: Optional[Dict[str, Any]] = None


class NotificationCreate(NotificationBase):
    pass


class NotificationUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=256)
    content: Optional[str] = None
    level: Optional[str] = None
    is_read: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    content: Optional[str]
    notification_type: str
    level: str
    source: Optional[str]
    source_id: Optional[str]
    recipient: Optional[str]
    is_read: bool
    read_at: Optional[datetime]
    meta: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class NotificationListResponse(BaseModel):
    total: int
    unread: int
    items: List[NotificationResponse]


class BatchIdsRequest(BaseModel):
    ids: List[UUID] = Field(..., description="ID 列表")


class NotificationStatistics(BaseModel):
    total: int
    unread: int
    by_type: Dict[str, int]
    by_level: Dict[str, int]
