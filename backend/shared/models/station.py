"""
监测站点数据模型
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


class StationBase(BaseModel):
    """站点基础模型"""
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
    """创建站点请求模型"""
    pass


class StationUpdate(BaseModel):
    """更新站点请求模型"""
    station_name: Optional[str] = Field(None, max_length=128)
    region: Optional[str] = Field(None, max_length=64)
    address: Optional[str] = Field(None, max_length=256)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    status: Optional[str] = Field(None)
    config: Optional[Dict[str, Any]] = None


class StationResponse(StationBase):
    """站点响应模型"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    created_at: datetime
    updated_at: datetime


class StationListResponse(BaseModel):
    """站点列表响应"""
    total: int
    items: List[StationResponse]


class StationMetricBase(BaseModel):
    """站点监测指标基础模型"""
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


class StationMetricResponse(StationMetricBase):
    """指标配置响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    station_id: UUID
    created_at: datetime


class StationWithMetrics(StationResponse):
    """站点详情（含指标配置）"""
    metrics: List[StationMetricResponse] = []
