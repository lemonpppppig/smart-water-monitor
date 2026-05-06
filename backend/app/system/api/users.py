"""用户管理 API"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.system.database import get_db
from app.system.schemas import (
    BatchDeleteRequest,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.system.services import UserService


router = APIRouter(prefix="/system/users", tags=["用户管理"])


@router.get("")
async def list_users(
    keyword: Optional[str] = None,
    role_code: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
):
    users, total = await UserService.list_users(
        db, keyword=keyword, role_code=role_code, status=status, skip=skip, limit=limit,
    )
    return {
        "total": total,
        "items": [u.to_dict() for u in users],
    }


@router.post("", response_model=UserResponse)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    try:
        user = await UserService.create_user(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return UserResponse(**user.to_dict())


@router.post("/batch-delete")
async def batch_delete_users(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    count = await UserService.batch_delete_users(db, payload.ids)
    return {"deleted": count}


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return UserResponse(**user.to_dict())


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(user_id: uuid.UUID, payload: UserUpdate, db: AsyncSession = Depends(get_db)):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        user = await UserService.update_user(db, user, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return UserResponse(**user.to_dict())


@router.delete("/{user_id}")
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        await UserService.delete_user(db, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "已删除"}
