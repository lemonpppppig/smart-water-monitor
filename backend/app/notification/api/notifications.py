"""通知 API 路由"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.notification.database import get_db
from app.notification.services import NotificationService
from app.notification.schemas import (
    NotificationCreate, NotificationUpdate,
    NotificationResponse, NotificationListResponse,
    NotificationStatistics, BatchIdsRequest,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("", response_model=NotificationResponse, status_code=201)
async def create_notification(
    payload: NotificationCreate,
    db: AsyncSession = Depends(get_db),
):
    """创建通知"""
    notification = await NotificationService.create(db, payload.model_dump())
    return notification.to_dict()


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    notification_type: Optional[str] = Query(None, description="通知类型"),
    level: Optional[str] = Query(None, description="级别"),
    is_read: Optional[bool] = Query(None, description="是否已读"),
    recipient: Optional[str] = Query(None, description="接收人"),
    source: Optional[str] = Query(None, description="来源模块"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """获取通知列表"""
    items, total, unread = await NotificationService.list_notifications(
        db, notification_type, level, is_read, recipient, source, skip, limit
    )
    return {
        "total": total,
        "unread": unread,
        "items": [n.to_dict() for n in items],
    }


@router.get("/statistics", response_model=NotificationStatistics)
async def statistics(db: AsyncSession = Depends(get_db)):
    """通知统计"""
    return await NotificationService.statistics(db)


@router.post("/mark-all-read")
async def mark_all_read(
    recipient: Optional[str] = Query(None, description="接收人，空表示所有"),
    db: AsyncSession = Depends(get_db),
):
    """全部标记为已读"""
    updated = await NotificationService.mark_all_read(db, recipient)
    return {"updated": updated}


@router.post("/batch-delete")
async def batch_delete(
    request: BatchIdsRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除通知"""
    deleted = await NotificationService.batch_delete(db, request.ids)
    return {"deleted": deleted, "requested": len(request.ids)}


@router.get("/{notification_id}", response_model=NotificationResponse)
async def get_notification(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取通知详情"""
    notification = await NotificationService.get_by_id(db, notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification.to_dict()


@router.put("/{notification_id}", response_model=NotificationResponse)
async def update_notification(
    notification_id: UUID,
    payload: NotificationUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新通知"""
    notification = await NotificationService.get_by_id(db, notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    updated = await NotificationService.update(
        db, notification, payload.model_dump(exclude_unset=True)
    )
    return updated.to_dict()


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """标记单条为已读"""
    notification = await NotificationService.get_by_id(db, notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    updated = await NotificationService.mark_read(db, notification)
    return updated.to_dict()


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除单条通知"""
    notification = await NotificationService.get_by_id(db, notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    await NotificationService.delete(db, notification)
    return None
