"""
站点API路由
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.station.database import get_db
from app.station.services import StationService, StationMetricService
from app.station.schemas import (
    StationCreate, StationUpdate, StationResponse, StationListResponse,
    StationMetricCreate, StationMetricUpdate, StationMetricResponse,
    StationWithMetrics, NearbyQuery
)

router = APIRouter(prefix="/stations", tags=["stations"])


class BatchDeleteRequest(BaseModel):
    ids: List[UUID] = Field(..., min_length=1)


@router.post("/batch-delete")
async def batch_delete_stations(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除站点"""
    deleted = 0
    for sid in payload.ids:
        station = await StationService.get_station_by_id(db, sid)
        if station:
            await StationService.delete_station(db, station)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "total": len(payload.ids)}


@router.post("", response_model=StationResponse, status_code=201)
async def create_station(
    station: StationCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建监测站点"""
    # 检查站点编码是否已存在
    existing = await StationService.get_station_by_code(db, station.station_code)
    if existing:
        raise HTTPException(status_code=400, detail="Station code already exists")
    
    station_data = station.model_dump()
    new_station = await StationService.create_station(db, station_data)
    return new_station


@router.get("", response_model=StationListResponse)
async def list_stations(
    station_type: Optional[str] = Query(None, description="站点类型"),
    region: Optional[str] = Query(None, description="所属区域"),
    status: Optional[str] = Query(None, description="状态"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取站点列表"""
    stations, total = await StationService.list_stations(
        db, station_type, region, status, skip, limit
    )
    return {
        "total": total,
        "items": [s.to_dict() for s in stations]
    }


@router.get("/{station_id}", response_model=StationResponse)
async def get_station(
    station_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取站点详情"""
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    return station.to_dict()


@router.get("/{station_id}/detail", response_model=StationWithMetrics)
async def get_station_with_metrics(
    station_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取站点详情（含指标配置）"""
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    metrics = await StationMetricService.get_metrics_by_station(db, station_id)
    
    return {
        **station.to_dict(),
        "metrics": [m.to_dict() for m in metrics]
    }


@router.put("/{station_id}", response_model=StationResponse)
async def update_station(
    station_id: UUID,
    station_update: StationUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新站点信息"""
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    update_data = station_update.model_dump(exclude_unset=True)
    updated_station = await StationService.update_station(db, station, update_data)
    return updated_station.to_dict()


@router.delete("/{station_id}", status_code=204)
async def delete_station(
    station_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除站点"""
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    await StationService.delete_station(db, station)
    return None


@router.post("/{station_id}/restore", response_model=StationResponse)
async def restore_station(
    station_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """恢复被软删除的站点"""
    station = await StationService.restore_station(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found or not deleted")
    return station.to_dict()


@router.get("/code/{station_code}", response_model=StationResponse)
async def get_station_by_code(
    station_code: str,
    db: AsyncSession = Depends(get_db)
):
    """根据编码获取站点"""
    station = await StationService.get_station_by_code(db, station_code)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    return station.to_dict()


@router.post("/nearby", response_model=List[StationResponse])
async def get_nearby_stations(
    query: NearbyQuery,
    db: AsyncSession = Depends(get_db)
):
    """获取附近站点"""
    stations = await StationService.get_nearby_stations(
        db, query.longitude, query.latitude, query.radius, query.limit
    )
    return [s.to_dict() for s in stations]


# 指标配置相关接口
@router.post("/{station_id}/metrics", response_model=StationMetricResponse, status_code=201)
async def create_station_metric(
    station_id: UUID,
    metric: StationMetricCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建站点指标配置"""
    # 检查站点是否存在
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    # 检查指标是否已存在
    existing = await StationMetricService.get_metric_by_code(
        db, station_id, metric.metric_code
    )
    if existing:
        raise HTTPException(status_code=400, detail="Metric code already exists for this station")
    
    metric_data = metric.model_dump()
    metric_data["station_id"] = station_id
    new_metric = await StationMetricService.create_metric(db, metric_data)
    return new_metric.to_dict()


@router.get("/{station_id}/metrics", response_model=List[StationMetricResponse])
async def list_station_metrics(
    station_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取站点所有指标配置"""
    station = await StationService.get_station_by_id(db, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    metrics = await StationMetricService.get_metrics_by_station(db, station_id)
    return [m.to_dict() for m in metrics]


@router.put("/{station_id}/metrics/{metric_id}", response_model=StationMetricResponse)
async def update_station_metric(
    station_id: UUID,
    metric_id: UUID,
    metric_update: StationMetricUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新指标配置"""
    # 这里简化处理，实际应该通过metric_id查询
    from sqlalchemy import select
    from app.station.models import StationMetric
    
    result = await db.execute(
        select(StationMetric).where(
            StationMetric.id == metric_id,
            StationMetric.station_id == station_id
        )
    )
    metric = result.scalar_one_or_none()
    
    if not metric:
        raise HTTPException(status_code=404, detail="Metric not found")
    
    update_data = metric_update.model_dump(exclude_unset=True)
    updated_metric = await StationMetricService.update_metric(db, metric, update_data)
    return updated_metric.to_dict()


@router.delete("/{station_id}/metrics/{metric_id}", status_code=204)
async def delete_station_metric(
    station_id: UUID,
    metric_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除指标配置"""
    from sqlalchemy import select
    from app.station.models import StationMetric
    
    result = await db.execute(
        select(StationMetric).where(
            StationMetric.id == metric_id,
            StationMetric.station_id == station_id
        )
    )
    metric = result.scalar_one_or_none()
    
    if not metric:
        raise HTTPException(status_code=404, detail="Metric not found")
    
    await StationMetricService.delete_metric(db, metric)
    return None
