"""
指标目录（metrics_catalog）API 路由
独立前缀 /metric-catalog，避免与 /stations/{station_id} 冲突。
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.station.database import get_db
from app.station.services import MetricCatalogService
from app.station.schemas import (
    MetricCatalogCreate,
    MetricCatalogUpdate,
    MetricCatalogResponse,
)

router = APIRouter(prefix="/metric-catalog", tags=["metric-catalog"])


class BatchDeleteRequest(BaseModel):
    ids: List[UUID] = Field(..., min_length=1)


@router.post("/batch-delete")
async def batch_delete_metric_catalog(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除指标"""
    deleted = 0
    for cid in payload.ids:
        item = await MetricCatalogService.get_catalog(db, cid)
        if item:
            await MetricCatalogService.delete_catalog(db, item)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "total": len(payload.ids)}


@router.get("", response_model=dict)
async def list_metric_catalog(
    keyword: Optional[str] = Query(None, description="编码/名称模糊搜索"),
    category: Optional[str] = Query(None, description="类别"),
    is_active: Optional[bool] = Query(None, description="是否启用"),
    db: AsyncSession = Depends(get_db),
):
    """获取指标目录列表"""
    items = await MetricCatalogService.list_catalog(db, keyword, category, is_active)
    data = [MetricCatalogResponse.model_validate(x).model_dump(mode="json") for x in items]
    return {"total": len(data), "items": data}


@router.post("", response_model=MetricCatalogResponse, status_code=201)
async def create_metric_catalog(
    payload: MetricCatalogCreate,
    db: AsyncSession = Depends(get_db),
):
    """新增指标"""
    try:
        item = await MetricCatalogService.create_catalog(db, payload.model_dump())
        await db.commit()
        return MetricCatalogResponse.model_validate(item)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{catalog_id}", response_model=MetricCatalogResponse)
async def get_metric_catalog(
    catalog_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    item = await MetricCatalogService.get_catalog(db, catalog_id)
    if not item:
        raise HTTPException(status_code=404, detail="指标不存在")
    return MetricCatalogResponse.model_validate(item)


@router.put("/{catalog_id}", response_model=MetricCatalogResponse)
async def update_metric_catalog(
    catalog_id: UUID,
    payload: MetricCatalogUpdate,
    db: AsyncSession = Depends(get_db),
):
    item = await MetricCatalogService.get_catalog(db, catalog_id)
    if not item:
        raise HTTPException(status_code=404, detail="指标不存在")
    updated = await MetricCatalogService.update_catalog(
        db, item, payload.model_dump(exclude_unset=True)
    )
    await db.commit()
    return MetricCatalogResponse.model_validate(updated)


@router.delete("/{catalog_id}", status_code=204)
async def delete_metric_catalog(
    catalog_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    item = await MetricCatalogService.get_catalog(db, catalog_id)
    if not item:
        raise HTTPException(status_code=404, detail="指标不存在")
    await MetricCatalogService.delete_catalog(db, item)
    await db.commit()
    return None
