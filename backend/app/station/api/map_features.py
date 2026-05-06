"""
地图要素（map_features）API 路由。
前缀 /map-features，支持 feature_type 过滤，coordinates 使用 GeoJSON 格式。
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.station.database import get_db
from app.station.services import MapFeatureService
from app.station.schemas import (
    MapFeatureCreate,
    MapFeatureUpdate,
    MapFeatureResponse,
)

router = APIRouter(prefix="/map-features", tags=["map-features"])


class BatchDeleteRequest(BaseModel):
    ids: List[UUID] = Field(..., min_length=1)


@router.post("/batch-delete")
async def batch_delete_map_features(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除地图要素"""
    deleted = 0
    for fid in payload.ids:
        item = await MapFeatureService.get_feature(db, fid)
        if item:
            await MapFeatureService.delete_feature(db, item)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "total": len(payload.ids)}


@router.get("", response_model=dict)
async def list_map_features(
    feature_type: Optional[str] = Query(None, description="要素类型过滤"),
    keyword: Optional[str] = Query(None, description="名称模糊搜索"),
    is_active: Optional[bool] = Query(None, description="是否启用"),
    db: AsyncSession = Depends(get_db),
):
    """获取地图要素列表"""
    items = await MapFeatureService.list_features(db, feature_type, keyword, is_active)
    data = [MapFeatureResponse.model_validate(x).model_dump(mode="json") for x in items]
    return {"total": len(data), "items": data}


@router.post("", response_model=MapFeatureResponse, status_code=201)
async def create_map_feature(
    payload: MapFeatureCreate,
    db: AsyncSession = Depends(get_db),
):
    item = await MapFeatureService.create_feature(db, payload.model_dump())
    await db.commit()
    return MapFeatureResponse.model_validate(item)


@router.get("/{feature_id}", response_model=MapFeatureResponse)
async def get_map_feature(
    feature_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    item = await MapFeatureService.get_feature(db, feature_id)
    if not item:
        raise HTTPException(status_code=404, detail="地图要素不存在")
    return MapFeatureResponse.model_validate(item)


@router.put("/{feature_id}", response_model=MapFeatureResponse)
async def update_map_feature(
    feature_id: UUID,
    payload: MapFeatureUpdate,
    db: AsyncSession = Depends(get_db),
):
    item = await MapFeatureService.get_feature(db, feature_id)
    if not item:
        raise HTTPException(status_code=404, detail="地图要素不存在")
    updated = await MapFeatureService.update_feature(
        db, item, payload.model_dump(exclude_unset=True)
    )
    await db.commit()
    return MapFeatureResponse.model_validate(updated)


@router.delete("/{feature_id}", status_code=204)
async def delete_map_feature(
    feature_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    item = await MapFeatureService.get_feature(db, feature_id)
    if not item:
        raise HTTPException(status_code=404, detail="地图要素不存在")
    await MapFeatureService.delete_feature(db, item)
    await db.commit()
    return None
