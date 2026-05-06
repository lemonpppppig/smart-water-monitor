"""依赖：Bearer token 校验 + 当前用户解析"""
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.system.database import get_db
from app.system.models import User
from app.system.security import decode_access_token
from app.system.services import UserService


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """从 Authorization 头解析当前用户。没登录返回 None（不强制）。"""
    if not authorization:
        return None
    token = authorization
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    payload = decode_access_token(token)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    return await UserService.get_user_by_username(db, username)


async def require_current_user(
    current_user: Optional[User] = Depends(get_current_user),
) -> User:
    """必须登录"""
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或 token 无效")
    return current_user


def require_permission(permission: str):
    """RBAC 权限校验依赖"""
    async def _checker(user: User = Depends(require_current_user)) -> User:
        role = user.role
        if role is None:
            raise HTTPException(status_code=403, detail="用户未分配角色")
        perms = role.permissions or []
        # admin 或具备该权限
        if role.code == "admin" or permission in perms or "*" in perms:
            return user
        raise HTTPException(status_code=403, detail=f"缺少权限: {permission}")
    return _checker
