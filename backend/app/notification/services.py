"""通知服务业务逻辑"""
import uuid
from datetime import datetime
from typing import List, Optional, Tuple, Dict, Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.notification.models import Notification


class NotificationService:
    """通知服务"""

    @staticmethod
    async def create(db: AsyncSession, data: Dict[str, Any]) -> Notification:
        notification = Notification(**data)
        db.add(notification)
        await db.flush()
        await db.refresh(notification)
        return notification

    @staticmethod
    async def get_by_id(db: AsyncSession, notification_id: uuid.UUID) -> Optional[Notification]:
        result = await db.execute(select(Notification).where(Notification.id == notification_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def list_notifications(
        db: AsyncSession,
        notification_type: Optional[str] = None,
        level: Optional[str] = None,
        is_read: Optional[bool] = None,
        recipient: Optional[str] = None,
        source: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[Notification], int, int]:
        conditions = []
        if notification_type:
            conditions.append(Notification.notification_type == notification_type)
        if level:
            conditions.append(Notification.level == level)
        if is_read is not None:
            conditions.append(Notification.is_read == is_read)
        if recipient:
            conditions.append(Notification.recipient == recipient)
        if source:
            conditions.append(Notification.source == source)

        count_q = select(func.count()).select_from(Notification)
        if conditions:
            count_q = count_q.where(and_(*conditions))
        total = (await db.execute(count_q)).scalar() or 0

        unread_q = select(func.count()).select_from(Notification).where(Notification.is_read == False)
        if conditions:
            unread_q = unread_q.where(and_(*conditions))
        unread = (await db.execute(unread_q)).scalar() or 0

        q = select(Notification).order_by(Notification.created_at.desc())
        if conditions:
            q = q.where(and_(*conditions))
        q = q.offset(skip).limit(limit)
        rows = (await db.execute(q)).scalars().all()
        return list(rows), int(total), int(unread)

    @staticmethod
    async def update(db: AsyncSession, notification: Notification, data: Dict[str, Any]) -> Notification:
        for k, v in data.items():
            if v is None and k != "is_read":
                continue
            setattr(notification, k, v)
        # 标记已读时间
        if data.get("is_read") is True and not notification.read_at:
            notification.read_at = datetime.utcnow()
        await db.flush()
        await db.refresh(notification)
        return notification

    @staticmethod
    async def mark_read(db: AsyncSession, notification: Notification) -> Notification:
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = datetime.utcnow()
            await db.flush()
            await db.refresh(notification)
        return notification

    @staticmethod
    async def mark_all_read(db: AsyncSession, recipient: Optional[str] = None) -> int:
        q = select(Notification).where(Notification.is_read == False)
        if recipient:
            q = q.where(Notification.recipient == recipient)
        rows = list((await db.execute(q)).scalars().all())
        now = datetime.utcnow()
        for r in rows:
            r.is_read = True
            r.read_at = now
        return len(rows)

    @staticmethod
    async def delete(db: AsyncSession, notification: Notification):
        await db.delete(notification)

    @staticmethod
    async def batch_delete(db: AsyncSession, ids: List[uuid.UUID]) -> int:
        if not ids:
            return 0
        result = await db.execute(select(Notification).where(Notification.id.in_(ids)))
        rows = list(result.scalars().all())
        for r in rows:
            await db.delete(r)
        return len(rows)

    @staticmethod
    async def statistics(db: AsyncSession) -> Dict[str, Any]:
        total = (await db.execute(select(func.count()).select_from(Notification))).scalar() or 0
        unread = (await db.execute(
            select(func.count()).select_from(Notification).where(Notification.is_read == False)
        )).scalar() or 0

        type_rows = await db.execute(
            select(Notification.notification_type, func.count()).group_by(Notification.notification_type)
        )
        by_type = {row[0]: row[1] for row in type_rows.all()}

        level_rows = await db.execute(
            select(Notification.level, func.count()).group_by(Notification.level)
        )
        by_level = {row[0]: row[1] for row in level_rows.all()}

        return {
            "total": int(total),
            "unread": int(unread),
            "by_type": by_type,
            "by_level": by_level,
        }
