"""角色管理 API"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.system.database import get_db
from app.system.schemas import RoleCreate, RoleResponse, RoleUpdate
from app.system.services import ALL_PERMISSIONS, RoleService


router = APIRouter(prefix="/system/roles", tags=["角色权限"])


@router.get("")
async def list_roles(db: AsyncSession = Depends(get_db)):
    roles = await RoleService.list_roles(db)
    return {"items": [r.to_dict() for r in roles], "total": len(roles)}


@router.get("/permissions")
async def list_permissions():
    """返回所有可用权限清单，供前端渲染权限矩阵"""
    modules = {
        "station": "监测站点",
        "data": "监测数据",
        "alert": "预警管理",
        "report": "报告管理",
        "ai": "AI 分析",
        "notification": "通知中心",
        "system": "系统管理",
    }
    grouped: dict = {}
    for perm in ALL_PERMISSIONS:
        mod = perm.split(":", 1)[0]
        grouped.setdefault(mod, {"module": mod, "module_name": modules.get(mod, mod), "permissions": []})
        grouped[mod]["permissions"].append(perm)
    return {
        "all": ALL_PERMISSIONS,
        "groups": list(grouped.values()),
    }


@router.post("", response_model=RoleResponse)
async def create_role(payload: RoleCreate, db: AsyncSession = Depends(get_db)):
    try:
        role = await RoleService.create_role(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return RoleResponse.model_validate(role)


@router.get("/{role_id}", response_model=RoleResponse)
async def get_role(role_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    role = await RoleService.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    return RoleResponse.model_validate(role)


@router.put("/{role_id}", response_model=RoleResponse)
async def update_role(role_id: uuid.UUID, payload: RoleUpdate, db: AsyncSession = Depends(get_db)):
    role = await RoleService.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    role = await RoleService.update_role(db, role, payload.model_dump(exclude_unset=True))
    return RoleResponse.model_validate(role)


@router.delete("/{role_id}")
async def delete_role(role_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    role = await RoleService.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    try:
        await RoleService.delete_role(db, role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "已删除"}
