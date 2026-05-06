"""操作日志 API"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.system.database import get_db
from app.system.schemas import BatchDeleteRequest, OperationLogCreate
from app.system.services import LogService


router = APIRouter(prefix="/system/logs", tags=["操作日志"])


@router.get("")
async def list_logs(
    username: Optional[str] = None,
    module: Optional[str] = None,
    status: Optional[str] = None,
    action: Optional[str] = None,
    keyword: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=500),
    db: AsyncSession = Depends(get_db),
):
    logs, total = await LogService.list_logs(
        db,
        username=username, module=module, status=status, action=action,
        start_time=start_time, end_time=end_time, keyword=keyword,
        skip=skip, limit=limit,
    )
    return {"total": total, "items": [l.to_dict() for l in logs]}


@router.post("")
async def create_log(payload: OperationLogCreate, db: AsyncSession = Depends(get_db)):
    log = await LogService.create_log(db, payload.model_dump())
    return log.to_dict()


@router.post("/batch-delete")
async def batch_delete_logs(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    count = await LogService.batch_delete_logs(db, payload.ids)
    return {"deleted": count}


@router.post("/clean")
async def clean_old_logs(days: int = Query(default=90, ge=1), db: AsyncSession = Depends(get_db)):
    """清理超过指定天数的日志"""
    before = datetime.utcnow() - timedelta(days=days)
    count = await LogService.clear_before(db, before)
    return {"deleted": count, "before": before.isoformat()}


@router.delete("/{log_id}")
async def delete_log(log_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    ok = await LogService.delete_log(db, log_id)
    if not ok:
        raise HTTPException(status_code=404, detail="日志不存在")
    return {"message": "已删除"}
