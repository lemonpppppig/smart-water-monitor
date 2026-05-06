"""
业务逻辑层
"""
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from shapely.geometry import Point

from app.station.models import Station, StationMetric


class StationService:
    """站点服务"""
    
    @staticmethod
    async def create_station(db: AsyncSession, station_data: dict) -> Station:
        """创建站点"""
        # 如果有坐标，创建几何对象
        if station_data.get("longitude") and station_data.get("latitude"):
            lon = station_data["longitude"]
            lat = station_data["latitude"]
            # GeoAlchemy2 使用 WKT 格式
            station_data["geom"] = f"SRID=4326;POINT({lon} {lat})"
        
        station = Station(**station_data)
        db.add(station)
        await db.flush()
        await db.refresh(station)
        return station
    
    @staticmethod
    async def get_station_by_id(db: AsyncSession, station_id: UUID) -> Optional[Station]:
        """根据ID获取站点（过滤已软删除）"""
        result = await db.execute(
            select(Station).where(and_(Station.id == station_id, Station.deleted_at.is_(None)))
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_station_by_code(db: AsyncSession, station_code: str) -> Optional[Station]:
        """根据编码获取站点（过滤已软删除）"""
        result = await db.execute(
            select(Station).where(and_(Station.station_code == station_code, Station.deleted_at.is_(None)))
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_stations(
        db: AsyncSession,
        station_type: Optional[str] = None,
        region: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Station], int]:
        """获取站点列表"""
        # 构建查询条件
        conditions = [Station.deleted_at.is_(None)]
        if station_type:
            conditions.append(Station.station_type == station_type)
        if region:
            conditions.append(Station.region.ilike(f"%{region}%"))
        if status:
            conditions.append(Station.status == status)
        
        # 查询总数
        count_query = select(func.count()).select_from(Station)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar()
        
        # 查询数据
        query = select(Station).order_by(Station.created_at.desc())
        if conditions:
            query = query.where(and_(*conditions))
        query = query.offset(skip).limit(limit)
        
        result = await db.execute(query)
        stations = result.scalars().all()
        
        return list(stations), total
    
    @staticmethod
    async def update_station(db: AsyncSession, station: Station, update_data: dict) -> Station:
        """更新站点"""
        # 如果有坐标更新，更新几何对象
        if "longitude" in update_data and "latitude" in update_data:
            lon = update_data["longitude"]
            lat = update_data["latitude"]
            if lon is not None and lat is not None:
                update_data["geom"] = f"SRID=4326;POINT({lon} {lat})"
        
        for key, value in update_data.items():
            if value is not None and hasattr(station, key):
                setattr(station, key, value)
        
        await db.flush()
        await db.refresh(station)
        return station
    
    @staticmethod
    async def delete_station(db: AsyncSession, station: Station):
        """软删除站点（标记 deleted_at）"""
        station.deleted_at = datetime.utcnow()
        await db.flush()

    @staticmethod
    async def restore_station(db: AsyncSession, station_id: UUID) -> Optional[Station]:
        """恢复被软删除的站点"""
        result = await db.execute(select(Station).where(Station.id == station_id))
        station = result.scalar_one_or_none()
        if station and station.deleted_at is not None:
            station.deleted_at = None
            await db.flush()
        return station

    @staticmethod
    async def hard_delete_station(db: AsyncSession, station: Station):
        """硬删除站点（谨慎使用）"""
        await db.delete(station)
        await db.flush()
    
    @staticmethod
    async def get_nearby_stations(
        db: AsyncSession,
        longitude: float,
        latitude: float,
        radius_meters: float = 5000,
        limit: int = 10
    ) -> List[Station]:
        """获取附近站点"""
        # 创建点几何
        point = f"SRID=4326;POINT({longitude} {latitude})"
        
        # 查询附近站点（使用PostGIS的ST_DWithin）
        # 注意：4326坐标系的单位是度，需要转换
        # 简化处理：这里使用度作为近似（1度约111km）
        radius_degrees = radius_meters / 111000.0
        
        result = await db.execute(
            select(Station)
            .where(
                and_(
                    Station.geom.isnot(None),
                    Station.status == "active",
                    Station.deleted_at.is_(None),
                )
            )
            .order_by(
                func.ST_Distance(Station.geom, func.ST_GeomFromEWKT(point))
            )
            .limit(limit)
        )
        
        stations = result.scalars().all()
        # 过滤实际距离
        nearby = []
        for station in stations:
            if station.longitude and station.latitude:
                dist = ((station.longitude - longitude) ** 2 + 
                       (station.latitude - latitude) ** 2) ** 0.5
                if dist <= radius_degrees:
                    nearby.append(station)
        
        return nearby


class StationMetricService:
    """站点指标服务"""
    
    @staticmethod
    async def create_metric(db: AsyncSession, metric_data: dict) -> StationMetric:
        """创建指标配置"""
        metric = StationMetric(**metric_data)
        db.add(metric)
        await db.flush()
        await db.refresh(metric)
        return metric
    
    @staticmethod
    async def get_metrics_by_station(db: AsyncSession, station_id: UUID) -> List[StationMetric]:
        """获取站点的所有指标配置"""
        result = await db.execute(
            select(StationMetric)
            .where(StationMetric.station_id == station_id)
            .order_by(StationMetric.metric_code)
        )
        return list(result.scalars().all())
    
    @staticmethod
    async def get_metric_by_code(db: AsyncSession, station_id: UUID, metric_code: str) -> Optional[StationMetric]:
        """获取指定指标配置"""
        result = await db.execute(
            select(StationMetric)
            .where(
                and_(
                    StationMetric.station_id == station_id,
                    StationMetric.metric_code == metric_code
                )
            )
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def update_metric(db: AsyncSession, metric: StationMetric, update_data: dict) -> StationMetric:
        """更新指标配置"""
        for key, value in update_data.items():
            if value is not None and hasattr(metric, key):
                setattr(metric, key, value)
        
        await db.flush()
        await db.refresh(metric)
        return metric
    
    @staticmethod
    async def delete_metric(db: AsyncSession, metric: StationMetric):
        """删除指标配置"""
        await db.delete(metric)
    
    @staticmethod
    async def batch_create_metrics(db: AsyncSession, station_id: UUID, metrics: List[dict]):
        """批量创建指标配置"""
        for metric_data in metrics:
            metric_data["station_id"] = station_id
            metric = StationMetric(**metric_data)
            db.add(metric)
        await db.flush()


class MetricCatalogService:
    """指标目录服务"""

    @staticmethod
    async def list_catalog(
        db: AsyncSession,
        keyword: Optional[str] = None,
        category: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> List:
        from app.station.models import MetricCatalog
        stmt = select(MetricCatalog)
        conditions = []
        if keyword:
            kw = f"%{keyword}%"
            conditions.append(or_(MetricCatalog.metric_code.ilike(kw), MetricCatalog.metric_name.ilike(kw)))
        if category:
            conditions.append(MetricCatalog.category == category)
        if is_active is not None:
            conditions.append(MetricCatalog.is_active == is_active)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(MetricCatalog.display_order, MetricCatalog.metric_code)
        res = await db.execute(stmt)
        return list(res.scalars().all())

    @staticmethod
    async def get_catalog(db: AsyncSession, catalog_id: UUID):
        from app.station.models import MetricCatalog
        res = await db.execute(select(MetricCatalog).where(MetricCatalog.id == catalog_id))
        return res.scalar_one_or_none()

    @staticmethod
    async def get_by_code(db: AsyncSession, metric_code: str):
        from app.station.models import MetricCatalog
        res = await db.execute(select(MetricCatalog).where(MetricCatalog.metric_code == metric_code))
        return res.scalar_one_or_none()

    @staticmethod
    async def create_catalog(db: AsyncSession, data: dict):
        from app.station.models import MetricCatalog
        existed = await MetricCatalogService.get_by_code(db, data["metric_code"])
        if existed:
            raise ValueError(f"指标编码 {data['metric_code']} 已存在")
        item = MetricCatalog(**data)
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def update_catalog(db: AsyncSession, item, data: dict):
        for k, v in data.items():
            if v is not None and hasattr(item, k):
                setattr(item, k, v)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def delete_catalog(db: AsyncSession, item):
        await db.delete(item)
        await db.flush()

    @staticmethod
    async def bootstrap_defaults(db: AsyncSession) -> None:
        """写入默认水质指标字典"""
        from app.station.models import MetricCatalog
        defaults = [
            {"metric_code": "pH", "metric_name": "pH 值", "category": "物理", "unit": "", "upper_limit": 9.0, "lower_limit": 6.0, "standard_limit": 7.5, "standard_code": "GB3838", "display_order": 1},
            {"metric_code": "DO", "metric_name": "溶解氧", "category": "化学", "unit": "mg/L", "lower_limit": 5.0, "standard_limit": 6.0, "standard_code": "GB3838-II类", "display_order": 2},
            {"metric_code": "COD", "metric_name": "化学需氧量", "category": "化学", "unit": "mg/L", "upper_limit": 20.0, "standard_limit": 15.0, "standard_code": "GB3838-III类", "display_order": 3},
            {"metric_code": "BOD5", "metric_name": "五日生化需氧量", "category": "化学", "unit": "mg/L", "upper_limit": 4.0, "standard_limit": 4.0, "standard_code": "GB3838-III类", "display_order": 4},
            {"metric_code": "NH3N", "metric_name": "氨氮", "category": "化学", "unit": "mg/L", "upper_limit": 1.0, "standard_limit": 1.0, "standard_code": "GB3838-III类", "display_order": 5},
            {"metric_code": "TP", "metric_name": "总磷", "category": "化学", "unit": "mg/L", "upper_limit": 0.2, "standard_limit": 0.2, "standard_code": "GB3838-III类", "display_order": 6},
            {"metric_code": "TN", "metric_name": "总氮", "category": "化学", "unit": "mg/L", "upper_limit": 1.0, "standard_limit": 1.0, "standard_code": "GB3838-III类", "display_order": 7},
            {"metric_code": "TUR", "metric_name": "浊度", "category": "物理", "unit": "NTU", "upper_limit": 10.0, "display_order": 8},
            {"metric_code": "TEMP", "metric_name": "水温", "category": "物理", "unit": "℃", "lower_limit": 0.0, "upper_limit": 35.0, "display_order": 9},
            {"metric_code": "EC", "metric_name": "电导率", "category": "物理", "unit": "μS/cm", "display_order": 10},
        ]
        for d in defaults:
            existed = await MetricCatalogService.get_by_code(db, d["metric_code"])
            if existed is None:
                db.add(MetricCatalog(**d))
        await db.flush()


class MapFeatureService:
    """地图要素服务"""

    @staticmethod
    async def list_features(
        db: AsyncSession,
        feature_type: Optional[str] = None,
        keyword: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> List:
        from app.station.models import MapFeature
        stmt = select(MapFeature)
        conditions = []
        if feature_type:
            conditions.append(MapFeature.feature_type == feature_type)
        if keyword:
            conditions.append(MapFeature.name.ilike(f"%{keyword}%"))
        if is_active is not None:
            conditions.append(MapFeature.is_active == is_active)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(MapFeature.created_at.desc())
        res = await db.execute(stmt)
        return list(res.scalars().all())

    @staticmethod
    async def get_feature(db: AsyncSession, feature_id: UUID):
        from app.station.models import MapFeature
        res = await db.execute(select(MapFeature).where(MapFeature.id == feature_id))
        return res.scalar_one_or_none()

    @staticmethod
    async def create_feature(db: AsyncSession, data: dict):
        from app.station.models import MapFeature
        item = MapFeature(**data)
        db.add(item)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def update_feature(db: AsyncSession, item, data: dict):
        for k, v in data.items():
            if v is not None and hasattr(item, k):
                setattr(item, k, v)
        await db.flush()
        await db.refresh(item)
        return item

    @staticmethod
    async def delete_feature(db: AsyncSession, item):
        await db.delete(item)
        await db.flush()
