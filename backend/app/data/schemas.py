"""
Pydantic Schema Definitions
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class WaterQualityData(BaseModel):
    """水质数据"""
    station_id: str = Field(..., description="站点ID")
    ts: Optional[datetime] = Field(default_factory=datetime.now, description="时间戳")
    station_type: Optional[str] = Field(None, description="站点类型")
    region: Optional[str] = Field(None, description="区域")
    
    # 基础六参数
    ph: Optional[float] = Field(None, description="pH值")
    do: Optional[float] = Field(None, description="溶解氧 mg/L")
    nh3_n: Optional[float] = Field(None, description="氨氮 mg/L")
    codmn: Optional[float] = Field(None, description="高锰酸盐指数 mg/L")
    turbidity: Optional[float] = Field(None, description="浊度 NTU")
    conductivity: Optional[float] = Field(None, description="电导率 μS/cm")
    
    # 扩展参数
    chlorophyll: Optional[float] = Field(None, description="叶绿素 μg/L")
    blue_green_algae: Optional[float] = Field(None, description="蓝绿藻 cells/mL")
    total_n: Optional[float] = Field(None, description="总氮 mg/L")
    total_p: Optional[float] = Field(None, description="总磷 mg/L")
    codcr: Optional[float] = Field(None, description="化学需氧量 mg/L")
    transparency: Optional[float] = Field(None, description="透明度 cm")
    orp: Optional[float] = Field(None, description="氧化还原电位 mV")
    water_temperature: Optional[float] = Field(None, description="水温 °C")
    
    # 原始数据
    raw_data: Optional[str] = Field(None, description="原始数据")


class WaterQualityBatch(BaseModel):
    """批量水质数据"""
    items: List[WaterQualityData]


class DataQuery(BaseModel):
    """数据查询条件"""
    start_time: datetime = Field(..., description="开始时间")
    end_time: datetime = Field(..., description="结束时间")
    fields: Optional[List[str]] = Field(None, description="查询字段")
    aggregation: Optional[str] = Field(None, description="聚合频率，如 1H, 1D")


class DataResponse(BaseModel):
    """数据查询响应"""
    station_id: str
    start_time: datetime
    end_time: datetime
    count: int
    data: List[Dict[str, Any]]


class StatisticsQuery(BaseModel):
    """统计查询条件"""
    field: str = Field(..., description="统计字段")
    start_time: datetime = Field(..., description="开始时间")
    end_time: datetime = Field(..., description="结束时间")


class StatisticsResponse(BaseModel):
    """统计响应"""
    station_id: str
    field: str
    count: int
    avg: Optional[float]
    min: Optional[float]
    max: Optional[float]
    std: Optional[float]


class IngestResponse(BaseModel):
    """数据接入响应"""
    success: bool
    message: str
    success_count: Optional[int] = None
    failed_count: Optional[int] = None


class ProcessResponse(BaseModel):
    """数据处理响应"""
    original: Dict[str, Any]
    processed: Dict[str, Any]
    errors: List[str]
    valid: bool


class ValidationResult(BaseModel):
    """验证结果"""
    station_id: str
    valid: bool
    errors: List[str]


class ValidationBatchResponse(BaseModel):
    """批量验证响应"""
    total: int
    valid: int
    invalid: int
    results: List[ValidationResult]
