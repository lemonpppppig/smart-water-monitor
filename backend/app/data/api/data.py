"""
数据API路由
"""
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks

from app.data.db.tdengine import get_tdengine_client, TDengineClient
from app.data.core.processor import DataProcessor
from app.data.core.ingestion import get_ingestion_service
from app.data.schemas import (
    WaterQualityData, WaterQualityBatch, DataQuery, DataResponse,
    StatisticsQuery, StatisticsResponse, IngestResponse
)

router = APIRouter(prefix="/data", tags=["data"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest_data(
    data: WaterQualityData,
    background_tasks: BackgroundTasks
):
    """接入单条水质数据"""
    ingestion = get_ingestion_service()
    
    data_dict = data.model_dump()
    success = ingestion.ingest_data(data_dict)
    
    return {
        "success": success,
        "message": "Data ingested successfully" if success else "Failed to ingest data"
    }


@router.post("/ingest/batch", response_model=IngestResponse)
async def ingest_batch(
    batch: WaterQualityBatch,
    background_tasks: BackgroundTasks
):
    """批量接入水质数据"""
    ingestion = get_ingestion_service()
    
    data_list = [item.model_dump() for item in batch.items]
    success_count, failed_count = ingestion.ingest_batch(data_list)
    
    return {
        "success": failed_count == 0,
        "message": f"Ingested {success_count} records, {failed_count} failed",
        "success_count": success_count,
        "failed_count": failed_count
    }


@router.get("/stations/{station_id}/latest")
async def get_latest_data(
    station_id: str,
    tdengine: TDengineClient = Depends(get_tdengine_client)
):
    """获取站点最新数据"""
    try:
        data = tdengine.query_latest(station_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        # TDengine 未连接等情况，返回空数据而非报错
        return {"station_id": station_id, "data": None, "message": "数据源暂不可用"}
    
    if not data:
        return {"station_id": station_id, "data": None, "message": "暂无数据"}
    
    return data


@router.get("/stations/{station_id}/history")
async def get_history_data(
    station_id: str,
    start_time: Optional[datetime] = Query(None, description="开始时间"),
    end_time: Optional[datetime] = Query(None, description="结束时间"),
    hours: Optional[int] = Query(None, ge=1, le=24 * 30, description="快捷时间窗（小时），与 start/end 二选一"),
    limit: Optional[int] = Query(None, ge=1, le=10000, description="最大返回条数"),
    fields: Optional[str] = Query(None, description="查询字段，逗号分隔"),
    metric_code: Optional[str] = Query(None, description="单一指标码（等同于 fields=<code>）"),
    tdengine: TDengineClient = Depends(get_tdengine_client)
):
    """获取站点历史数据

    时间范围解析优先级：start_time/end_time > hours > 默认最近 24 小时。
    """
    # 时间范围兼容处理
    now = datetime.utcnow()
    if start_time is None and end_time is None:
        window_hours = hours if hours is not None else 24
        end_time = now
        start_time = now - timedelta(hours=window_hours)
    elif end_time is None:
        end_time = now
    elif start_time is None:
        window_hours = hours if hours is not None else 24
        start_time = end_time - timedelta(hours=window_hours)

    # 解析字段列表（fields 优先于 metric_code）
    field_list = None
    if fields:
        field_list = [f.strip() for f in fields.split(",") if f.strip()]
    elif metric_code:
        field_list = [metric_code.strip()]

    try:
        data = tdengine.query_water_quality(station_id, start_time, end_time, field_list)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if limit and len(data) > limit:
        data = data[-limit:]

    return {
        "station_id": station_id,
        "start_time": start_time,
        "end_time": end_time,
        "count": len(data),
        "data": data
    }


@router.post("/stations/{station_id}/query")
async def query_data(
    station_id: str,
    query: DataQuery,
    tdengine: TDengineClient = Depends(get_tdengine_client)
):
    """查询站点数据（POST方式）"""
    try:
        data = tdengine.query_water_quality(
            station_id, 
            query.start_time, 
            query.end_time,
            query.fields
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # 如果需要聚合
    if query.aggregation:
        import pandas as pd
        df = pd.DataFrame(data)
        if not df.empty:
            processor = DataProcessor()
            df = processor.aggregate_data(df, freq=query.aggregation)
            data = df.to_dict("records")
    
    return {
        "station_id": station_id,
        "query": query.model_dump(),
        "count": len(data),
        "data": data
    }


@router.get("/stations/{station_id}/statistics")
async def get_statistics(
    station_id: str,
    field: str = Query(..., description="统计字段"),
    start_time: datetime = Query(..., description="开始时间"),
    end_time: datetime = Query(..., description="结束时间"),
    tdengine: TDengineClient = Depends(get_tdengine_client)
):
    """获取数据统计信息"""
    try:
        stats = tdengine.query_statistics(station_id, field, start_time, end_time)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if not stats:
        raise HTTPException(status_code=404, detail="No data found for statistics")
    
    return {
        "station_id": station_id,
        "field": field,
        "start_time": start_time,
        "end_time": end_time,
        "statistics": stats
    }


@router.get("/stations")
async def get_stations_with_data(
    tdengine: TDengineClient = Depends(get_tdengine_client)
):
    """获取有数据的站点列表"""
    stations = tdengine.get_stations_with_data()
    return {"stations": stations, "count": len(stations)}


@router.post("/process")
async def process_data(
    data: WaterQualityData
):
    """测试数据预处理（不存储）"""
    processor = DataProcessor()
    data_dict = data.model_dump()
    
    processed, errors = processor.process_data_point(data_dict)
    
    return {
        "original": data_dict,
        "processed": processed,
        "errors": errors,
        "valid": len(errors) == 0
    }


@router.post("/process/validate")
async def validate_data_batch(
    batch: WaterQualityBatch
):
    """批量验证数据"""
    processor = DataProcessor()
    
    results = []
    for item in batch.items:
        data_dict = item.model_dump()
        is_valid, errors = processor.validate_data(data_dict)
        results.append({
            "station_id": data_dict.get("station_id"),
            "valid": is_valid,
            "errors": errors
        })
    
    valid_count = sum(1 for r in results if r["valid"])
    
    return {
        "total": len(results),
        "valid": valid_count,
        "invalid": len(results) - valid_count,
        "results": results
    }
