"""
Pydantic Schema Definitions
"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


# 站点相关Schema
class StationBase(BaseModel):
    """站点基础Schema"""
    station_code: str = Field(..., description="站点编码", max_length=64)
    station_name: str = Field(..., description="站点名称", max_length=128)
    station_type: str = Field(..., description="站点类型: water_source, industrial_park, boundary_section, rural_water")
    region: Optional[str] = Field(None, description="所属区域", max_length=64)
    address: Optional[str] = Field(None, description="详细地址", max_length=256)
    longitude: Optional[float] = Field(None, description="经度", ge=-180, le=180)
    latitude: Optional[float] = Field(None, description="纬度", ge=-90, le=90)
    status: str = Field("active", description="状态: active, inactive, maintenance")
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, description="站点配置")


class StationCreate(StationBase):
    """创建站点请求"""
    pass


class StationUpdate(BaseModel):
    """更新站点请求"""
    station_name: Optional[str] = Field(None, max_length=128)
    region: Optional[str] = Field(None, max_length=64)
    address: Optional[str] = Field(None, max_length=256)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    status: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class StationResponse(BaseModel):
    """站点响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    station_code: str
    station_name: str
    station_type: str
    region: Optional[str]
    address: Optional[str]
    longitude: Optional[float]
    latitude: Optional[float]
    status: str
    config: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class StationListResponse(BaseModel):
    """站点列表响应"""
    total: int
    items: List[StationResponse]


# 指标配置相关Schema
class StationMetricBase(BaseModel):
    """指标配置基础Schema"""
    metric_code: str = Field(..., description="指标编码", max_length=32)
    metric_name: str = Field(..., description="指标名称", max_length=64)
    unit: Optional[str] = Field(None, description="单位", max_length=16)
    upper_limit: Optional[float] = Field(None, description="上限阈值")
    lower_limit: Optional[float] = Field(None, description="下限阈值")
    standard_limit: Optional[float] = Field(None, description="标准限值")
    is_enabled: bool = Field(True, description="是否启用")


class StationMetricCreate(StationMetricBase):
    """创建指标配置请求"""
    pass


class StationMetricUpdate(BaseModel):
    """更新指标配置请求"""
    metric_name: Optional[str] = Field(None, max_length=64)
    unit: Optional[str] = Field(None, max_length=16)
    upper_limit: Optional[float] = None
    lower_limit: Optional[float] = None
    standard_limit: Optional[float] = None
    is_enabled: Optional[bool] = None


class StationMetricResponse(BaseModel):
    """指标配置响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    station_id: UUID
    metric_code: str
    metric_name: str
    unit: Optional[str]
    upper_limit: Optional[float]
    lower_limit: Optional[float]
    standard_limit: Optional[float]
    is_enabled: bool
    created_at: datetime


class StationWithMetrics(StationResponse):
    """站点详情（含指标）"""
    metrics: List[StationMetricResponse] = []


# 查询相关Schema
class NearbyQuery(BaseModel):
    """附近站点查询"""
    longitude: float = Field(..., description="经度", ge=-180, le=180)
    latitude: float = Field(..., description="纬度", ge=-90, le=90)
    radius: float = Field(5000, description="半径(米)", gt=0)
    limit: int = Field(10, description="返回数量", ge=1, le=100)


class StationTypeStats(BaseModel):
    """站点类型统计"""
    station_type: str
    count: int


class RegionStats(BaseModel):
    """区域统计"""
    region: str
    count: int


# ==================== 指标目录 ====================
class MetricCatalogBase(BaseModel):
    metric_code: str = Field(..., max_length=32)
    metric_name: str = Field(..., max_length=64)
    category: Optional[str] = Field(None, max_length=32)
    unit: Optional[str] = Field(None, max_length=16)
    description: Optional[str] = None
    upper_limit: Optional[float] = None
    lower_limit: Optional[float] = None
    standard_limit: Optional[float] = None
    standard_code: Optional[str] = Field(None, max_length=64)
    is_active: bool = True
    display_order: float = 0


class MetricCatalogCreate(MetricCatalogBase):
    pass


class MetricCatalogUpdate(BaseModel):
    metric_name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    description: Optional[str] = None
    upper_limit: Optional[float] = None
    lower_limit: Optional[float] = None
    standard_limit: Optional[float] = None
    standard_code: Optional[str] = None
    is_active: Optional[bool] = None
    display_order: Optional[float] = None


class MetricCatalogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    metric_code: str
    metric_name: str
    category: Optional[str] = None
    unit: Optional[str] = None
    description: Optional[str] = None
    upper_limit: Optional[float] = None
    lower_limit: Optional[float] = None
    standard_limit: Optional[float] = None
    standard_code: Optional[str] = None
    is_active: bool = True
    display_order: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ==================== 地图要素 ====================
class MapFeatureBase(BaseModel):
    feature_type: str = Field(..., max_length=32)
    name: str = Field(..., max_length=128)
    description: Optional[str] = None
    geometry_type: str = Field("Point", max_length=16)
    coordinates: Optional[Any] = None
    properties: Optional[Dict[str, Any]] = None
    style: Optional[Dict[str, Any]] = None
    is_active: bool = True


class MapFeatureCreate(MapFeatureBase):
    pass


class MapFeatureUpdate(BaseModel):
    feature_type: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    geometry_type: Optional[str] = None
    coordinates: Optional[Any] = None
    properties: Optional[Dict[str, Any]] = None
    style: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class MapFeatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    feature_type: str
    name: str
    description: Optional[str] = None
    geometry_type: Optional[str] = None
    coordinates: Optional[Any] = None
    properties: Optional[Dict[str, Any]] = None
    style: Optional[Dict[str, Any]] = None
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
