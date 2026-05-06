"""System services: User / Role / OperationLog"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.system.models import OperationLog, Role, User
from app.system.security import hash_password, verify_password


# ==================== 默认权限清单 ====================
ALL_PERMISSIONS: List[str] = [
    # 站点
    "station:view", "station:create", "station:update", "station:delete",
    # 数据
    "data:view", "data:update", "data:delete",
    # 预警
    "alert:view", "alert:handle", "alert:rule", "alert:delete",
    # 报告
    "report:view", "report:generate", "report:download", "report:delete",
    # AI
    "ai:view", "ai:agent", "ai:model", "ai:graph",
    # 通知
    "notification:view", "notification:manage",
    # 系统
    "system:view", "system:user", "system:role", "system:log", "system:backup",
]

DEFAULT_ROLES: List[Dict[str, Any]] = [
    {
        "code": "admin",
        "name": "超级管理员",
        "description": "拥有所有权限",
        "permissions": ALL_PERMISSIONS,
        "is_builtin": True,
    },
    {
        "code": "operator",
        "name": "操作员",
        "description": "可执行日常操作，无系统管理权限",
        "permissions": [
            "station:view", "station:create", "station:update",
            "data:view", "data:update",
            "alert:view", "alert:handle",
            "report:view", "report:generate", "report:download",
            "ai:view", "ai:agent",
            "notification:view",
        ],
        "is_builtin": True,
    },
    {
        "code": "viewer",
        "name": "访客",
        "description": "仅可查看数据",
        "permissions": [
            "station:view", "data:view", "alert:view",
            "report:view", "report:download", "ai:view", "notification:view",
        ],
        "is_builtin": True,
    },
]


async def bootstrap_defaults(db: AsyncSession) -> None:
    """创建内置角色 + 默认 admin 账号（admin / admin123）"""
    # 1. 创建内置角色
    for r in DEFAULT_ROLES:
        row = (await db.execute(select(Role).where(Role.code == r["code"]))).scalar_one_or_none()
        if row is None:
            db.add(Role(**r))
    await db.flush()

    # 2. 创建默认 admin
    admin = (await db.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
    if admin is None:
        admin_role = (await db.execute(select(Role).where(Role.code == "admin"))).scalar_one_or_none()
        db.add(User(
            username="admin",
            full_name="系统管理员",
            email="admin@example.com",
            password_hash=hash_password("admin123"),
            role_id=admin_role.id if admin_role else None,
            status="active",
        ))


# ==================== Role ====================
class RoleService:
    @staticmethod
    async def list_roles(db: AsyncSession) -> List[Role]:
        res = await db.execute(select(Role).order_by(Role.created_at))
        return list(res.scalars().all())

    @staticmethod
    async def get_role(db: AsyncSession, role_id: uuid.UUID) -> Optional[Role]:
        res = await db.execute(select(Role).where(Role.id == role_id))
        return res.scalar_one_or_none()

    @staticmethod
    async def get_role_by_code(db: AsyncSession, code: str) -> Optional[Role]:
        res = await db.execute(select(Role).where(Role.code == code))
        return res.scalar_one_or_none()

    @staticmethod
    async def create_role(db: AsyncSession, payload: Dict[str, Any]) -> Role:
        if await RoleService.get_role_by_code(db, payload["code"]):
            raise ValueError(f"角色代码 {payload['code']} 已存在")
        role = Role(**payload)
        db.add(role)
        await db.flush()
        await db.refresh(role)
        return role

    @staticmethod
    async def update_role(db: AsyncSession, role: Role, payload: Dict[str, Any]) -> Role:
        for k, v in payload.items():
            if v is not None:
                setattr(role, k, v)
        await db.flush()
        await db.refresh(role)
        return role

    @staticmethod
    async def delete_role(db: AsyncSession, role: Role) -> None:
        if role.is_builtin:
            raise ValueError("内置角色不可删除")
        # 检查是否有用户使用该角色
        used = (await db.execute(select(func.count()).select_from(User).where(User.role_id == role.id))).scalar_one()
        if used and used > 0:
            raise ValueError(f"该角色下还有 {used} 个用户，无法删除")
        await db.delete(role)
        await db.flush()


# ==================== User ====================
class UserService:
    @staticmethod
    async def _resolve_role_id(db: AsyncSession, role_id, role_code) -> Optional[uuid.UUID]:
        if role_id:
            return role_id if isinstance(role_id, uuid.UUID) else uuid.UUID(str(role_id))
        if role_code:
            role = await RoleService.get_role_by_code(db, role_code)
            if not role:
                raise ValueError(f"角色 {role_code} 不存在")
            return role.id
        return None

    @staticmethod
    async def list_users(
        db: AsyncSession,
        *,
        keyword: Optional[str] = None,
        role_code: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[User], int]:
        stmt = select(User).options(selectinload(User.role))
        filters = []
        if keyword:
            kw = f"%{keyword}%"
            filters.append(or_(User.username.ilike(kw), User.email.ilike(kw), User.full_name.ilike(kw)))
        if status:
            filters.append(User.status == status)
        if role_code:
            role = await RoleService.get_role_by_code(db, role_code)
            if role:
                filters.append(User.role_id == role.id)
            else:
                return [], 0
        if filters:
            stmt = stmt.where(and_(*filters))
        total_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db.execute(total_stmt)).scalar_one()
        stmt = stmt.order_by(User.created_at.desc()).offset(skip).limit(limit)
        res = await db.execute(stmt)
        return list(res.scalars().unique().all()), int(total)

    @staticmethod
    async def get_user(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
        res = await db.execute(select(User).options(selectinload(User.role)).where(User.id == user_id))
        return res.scalar_one_or_none()

    @staticmethod
    async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
        res = await db.execute(select(User).options(selectinload(User.role)).where(User.username == username))
        return res.scalar_one_or_none()

    @staticmethod
    async def create_user(db: AsyncSession, payload: Dict[str, Any]) -> User:
        username = payload.get("username")
        if not username:
            raise ValueError("用户名不能为空")
        existed = await UserService.get_user_by_username(db, username)
        if existed:
            raise ValueError(f"用户名 {username} 已存在")
        role_id = await UserService._resolve_role_id(db, payload.pop("role_id", None), payload.pop("role_code", None))
        raw_password = payload.pop("password")
        user = User(
            password_hash=hash_password(raw_password),
            role_id=role_id,
            **{k: v for k, v in payload.items() if v is not None},
        )
        db.add(user)
        await db.flush()
        # reload with role
        return await UserService.get_user(db, user.id) or user

    @staticmethod
    async def update_user(db: AsyncSession, user: User, payload: Dict[str, Any]) -> User:
        # 特殊字段
        role_id_raw = payload.pop("role_id", None)
        role_code = payload.pop("role_code", None)
        if role_id_raw is not None or role_code is not None:
            user.role_id = await UserService._resolve_role_id(db, role_id_raw, role_code)
        new_pwd = payload.pop("password", None)
        if new_pwd:
            user.password_hash = hash_password(new_pwd)
        for k, v in payload.items():
            if v is not None:
                setattr(user, k, v)
        await db.flush()
        return await UserService.get_user(db, user.id) or user

    @staticmethod
    async def delete_user(db: AsyncSession, user: User) -> None:
        if user.username == "admin":
            raise ValueError("默认 admin 账户不可删除")
        await db.delete(user)
        await db.flush()

    @staticmethod
    async def batch_delete_users(db: AsyncSession, ids: List[uuid.UUID]) -> int:
        if not ids:
            return 0
        res = await db.execute(
            delete(User).where(User.id.in_(ids), User.username != "admin")
        )
        return int(res.rowcount or 0)

    @staticmethod
    async def change_password(db: AsyncSession, user: User, old_password: str, new_password: str) -> None:
        if not verify_password(old_password, user.password_hash):
            raise ValueError("原密码错误")
        user.password_hash = hash_password(new_password)
        await db.flush()

    @staticmethod
    async def authenticate(db: AsyncSession, username: str, password: str) -> Optional[User]:
        user = await UserService.get_user_by_username(db, username)
        if not user:
            return None
        if user.status != "active":
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    @staticmethod
    async def update_last_login(db: AsyncSession, user: User, ip: Optional[str]) -> None:
        user.last_login = datetime.utcnow()
        user.last_login_ip = ip
        await db.flush()


# ==================== OperationLog ====================
class LogService:
    @staticmethod
    async def create_log(db: AsyncSession, payload: Dict[str, Any]) -> OperationLog:
        log = OperationLog(**{k: v for k, v in payload.items() if v is not None})
        db.add(log)
        await db.flush()
        return log

    @staticmethod
    async def list_logs(
        db: AsyncSession,
        *,
        username: Optional[str] = None,
        module: Optional[str] = None,
        status: Optional[str] = None,
        action: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        keyword: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[OperationLog], int]:
        stmt = select(OperationLog)
        filters = []
        if username:
            filters.append(OperationLog.username == username)
        if module:
            filters.append(OperationLog.module == module)
        if status:
            filters.append(OperationLog.status == status)
        if action:
            filters.append(OperationLog.action.ilike(f"%{action}%"))
        if start_time:
            filters.append(OperationLog.created_at >= start_time)
        if end_time:
            filters.append(OperationLog.created_at <= end_time)
        if keyword:
            kw = f"%{keyword}%"
            filters.append(or_(
                OperationLog.action.ilike(kw),
                OperationLog.path.ilike(kw),
                OperationLog.username.ilike(kw),
            ))
        if filters:
            stmt = stmt.where(and_(*filters))
        total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        stmt = stmt.order_by(OperationLog.created_at.desc()).offset(skip).limit(limit)
        res = await db.execute(stmt)
        return list(res.scalars().all()), int(total)

    @staticmethod
    async def delete_log(db: AsyncSession, log_id: uuid.UUID) -> bool:
        res = await db.execute(delete(OperationLog).where(OperationLog.id == log_id))
        return (res.rowcount or 0) > 0

    @staticmethod
    async def batch_delete_logs(db: AsyncSession, ids: List[uuid.UUID]) -> int:
        if not ids:
            return 0
        res = await db.execute(delete(OperationLog).where(OperationLog.id.in_(ids)))
        return int(res.rowcount or 0)

    @staticmethod
    async def clear_before(db: AsyncSession, before: datetime) -> int:
        res = await db.execute(delete(OperationLog).where(OperationLog.created_at < before))
        return int(res.rowcount or 0)
