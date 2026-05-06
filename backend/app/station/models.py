"""
SQLAlchemy ORM Models
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, JSON, Float, Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from geoalchemy2 import Geometry
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Station(Base):
    """监测站点表"""
    __tablename__ = "stations"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    station_code = Column(String(64), unique=True, nullable=False, comment="站点编码")
    station_name = Column(String(128), nullable=False, comment="站点名称")
    station_type = Column(String(32), nullable=False, comment="站点类型")
    region = Column(String(64), comment="所属区域")
    address = Column(Text, comment="详细地址")
    longitude = Column(Float, comment="经度")
    latitude = Column(Float, comment="纬度")
    geom = Column(Geometry("POINT", srid=4326), comment="空间坐标")
    status = Column(String(16), default="active", comment="状态")
    config = Column(JSON, default=dict, comment="站点配置")
    deleted_at = Column(DateTime(timezone=True), nullable=True, comment="软删除时间")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 关系
    metrics = relationship("StationMetric", back_populates="station", cascade="all, delete-orphan")
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "station_code": self.station_code,
            "station_name": self.station_name,
            "station_type": self.station_type,
            "region": self.region,
            "address": self.address,
            "longitude": self.longitude,
            "latitude": self.latitude,
            "status": self.status,
            "config": self.config,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class StationMetric(Base):
    """站点监测指标配置表"""
    __tablename__ = "station_metrics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    station_id = Column(UUID(as_uuid=True), ForeignKey("stations.id", ondelete="CASCADE"), nullable=False)
    metric_code = Column(String(32), nullable=False, comment="指标编码")
    metric_name = Column(String(64), nullable=False, comment="指标名称")
    unit = Column(String(16), comment="单位")
    upper_limit = Column(Float, comment="上限阈值")
    lower_limit = Column(Float, comment="下限阈值")
    standard_limit = Column(Float, comment="标准限值")
    is_enabled = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # 关系
    station = relationship("Station", back_populates="metrics")
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": str(self.id),
            "station_id": str(self.station_id),
            "metric_code": self.metric_code,
            "metric_name": self.metric_name,
            "unit": self.unit,
            "upper_limit": self.upper_limit,
            "lower_limit": self.lower_limit,
            "standard_limit": self.standard_limit,
            "is_enabled": self.is_enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MetricCatalog(Base):
    """指标目录表（全局水质指标字典）"""
    __tablename__ = "metrics_catalog"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    metric_code = Column(String(32), unique=True, nullable=False, comment="指标编码")
    metric_name = Column(String(64), nullable=False, comment="指标名称")
    category = Column(String(32), comment="分类：物理/化学/生物/重金属")
    unit = Column(String(16), comment="计量单位")
    description = Column(Text, comment="指标说明")
    upper_limit = Column(Float, comment="默认上限阈值")
    lower_limit = Column(Float, comment="默认下限阈值")
    standard_limit = Column(Float, comment="国标限值")
    standard_code = Column(String(64), comment="执行标准代码，例：GB3838-II类")
    is_active = Column(Boolean, default=True, comment="是否启用")
    display_order = Column(Float, default=0, comment="显示顺序")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": str(self.id),
            "metric_code": self.metric_code,
            "metric_name": self.metric_name,
            "category": self.category,
            "unit": self.unit,
            "description": self.description,
            "upper_limit": self.upper_limit,
            "lower_limit": self.lower_limit,
            "standard_limit": self.standard_limit,
            "standard_code": self.standard_code,
            "is_active": bool(self.is_active),
            "display_order": self.display_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class MapFeature(Base):
    """地图要素表（河流标注/流域边界/污染标记/POI 等地图叠加图层）"""
    __tablename__ = "map_features"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_type = Column(String(32), nullable=False, comment="要素类型：river/watershed/station/poi/pollution……")
    name = Column(String(128), nullable=False, comment="名称")
    description = Column(Text, comment="描述")
    geometry_type = Column(String(16), default="Point", comment="几何类型：Point/LineString/Polygon")
    coordinates = Column(JSON, comment="GeoJSON coordinates")
    properties = Column(JSON, default=dict, comment="属性键值对")
    style = Column(JSON, default=dict, comment="样式（color/icon/weight/opacity）")
    is_active = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": str(self.id),
            "feature_type": self.feature_type,
            "name": self.name,
            "description": self.description,
            "geometry_type": self.geometry_type,
            "coordinates": self.coordinates,
            "properties": self.properties or {},
            "style": self.style or {},
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
