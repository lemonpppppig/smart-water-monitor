"""
水质数据模型
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class MetricValue(BaseModel):
    """单个指标值"""
    metric_code: str = Field(..., description="指标编码")
    value: float = Field(..., description="数值")
    unit: Optional[str] = Field(None, description="单位")
    is_valid: bool = Field(True, description="是否有效")


class WaterQualityData(BaseModel):
    """水质数据点"""
    station_id: str = Field(..., description="站点ID")
    timestamp: datetime = Field(..., description="采集时间")
    ph: Optional[float] = Field(None, description="pH值")
    do: Optional[float] = Field(None, description="溶解氧(mg/L)")
    nh3_n: Optional[float] = Field(None, description="氨氮(mg/L)")
    codmn: Optional[float] = Field(None, description="高锰酸盐指数(mg/L)")
    turbidity: Optional[float] = Field(None, description="浊度(NTU)")
    conductivity: Optional[float] = Field(None, description="电导率(μS/cm)")
    # 扩展指标
    chlorophyll: Optional[float] = Field(None, description="叶绿素a(μg/L)")
    blue_green_algae: Optional[float] = Field(None, description="蓝绿藻密度(cells/mL)")
    total_n: Optional[float] = Field(None, description="总氮(mg/L)")
    total_p: Optional[float] = Field(None, description="总磷(mg/L)")
    codcr: Optional[float] = Field(None, description="化学需氧量(mg/L)")
    transparency: Optional[float] = Field(None, description="透明度(cm)")
    orp: Optional[float] = Field(None, description="氧化还原电位(mV)")
    water_temperature: Optional[float] = Field(None, description="水温(°C)")
    # 原始数据存储
    raw_data: Optional[Dict[str, Any]] = Field(None, description="原始数据")


class WaterQualityBatch(BaseModel):
    """批量水质数据"""
    items: List[WaterQualityData]


class TimeSeriesQuery(BaseModel):
    """时序数据查询条件"""
    station_ids: List[str] = Field(..., description="站点ID列表")
    start_time: datetime = Field(..., description="开始时间")
    end_time: datetime = Field(..., description="结束时间")
    metric_codes: Optional[List[str]] = Field(None, description="指标编码列表")
    aggregation: Optional[str] = Field(None, description="聚合方式: raw, hour, day")


class TimeSeriesPoint(BaseModel):
    """时序数据点"""
    timestamp: datetime
    station_id: str
    values: Dict[str, Optional[float]]


class TimeSeriesResponse(BaseModel):
    """时序数据响应"""
    station_id: str
    metric_code: str
    data: List[Dict[str, Any]]


class StatisticsResult(BaseModel):
    """统计结果"""
    station_id: str
    metric_code: str
    count: int
    mean: Optional[float]
    min: Optional[float]
    max: Optional[float]
    std: Optional[float]
    last_value: Optional[float]
    last_time: Optional[datetime]
