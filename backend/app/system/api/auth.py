"""认证相关 API"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.system.database import get_db
from app.system.deps import require_current_user
from app.system.models import User
from app.system.schemas import (
    LoginRequest,
    PasswordChangeRequest,
    TokenResponse,
    UserResponse,
)
from app.system.security import JWT_EXPIRE_SECONDS, create_access_token
from app.system.services import LogService, UserService


router = APIRouter(prefix="/auth", tags=["认证"])


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    user = await UserService.authenticate(db, payload.username, payload.password)
    ip = _client_ip(request)
    if not user:
        # 记录失败日志
        await LogService.create_log(db, {
            "username": payload.username,
            "action": "登录失败",
            "module": "auth",
            "method": "POST",
            "path": "/auth/login",
            "ip": ip,
            "user_agent": request.headers.get("user-agent", ""),
            "status": "failed",
            "status_code": 401,
        })
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    await UserService.update_last_login(db, user, ip)
    token = create_access_token(
        subject=user.username,
        extra={"uid": str(user.id), "role": user.role.code if user.role else None},
    )
    await LogService.create_log(db, {
        "user_id": user.id,
        "username": user.username,
        "action": "登录成功",
        "module": "auth",
        "method": "POST",
        "path": "/auth/login",
        "ip": ip,
        "user_agent": request.headers.get("user-agent", ""),
        "status": "success",
        "status_code": 200,
    })
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=JWT_EXPIRE_SECONDS,
        user=UserResponse(**user.to_dict()),
    )


@router.post("/logout")
async def logout(request: Request, current_user: User = Depends(require_current_user), db: AsyncSession = Depends(get_db)):
    await LogService.create_log(db, {
        "user_id": current_user.id,
        "username": current_user.username,
        "action": "退出登录",
        "module": "auth",
        "method": "POST",
        "path": "/auth/logout",
        "ip": _client_ip(request),
        "user_agent": request.headers.get("user-agent", ""),
        "status": "success",
        "status_code": 200,
    })
    return {"message": "已退出"}


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(require_current_user)):
    return UserResponse(**current_user.to_dict())


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await UserService.change_password(db, current_user, payload.old_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "密码已更新"}
