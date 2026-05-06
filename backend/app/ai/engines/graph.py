"""
图计算引擎
- 基于Neo4j的溯源分析
- 上下游关系分析
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from neo4j import GraphDatabase

from app.ai.config import settings

logger = logging.getLogger(__name__)


class GraphEngine:
    """图计算引擎"""
    
    # ==================== 本地拓扑配置（Neo4j不可用时的备用） ====================
    LOCAL_TOPOLOGY = {
        "S001": ("S002", 12, 1.5, "清河中游"), "S002": ("S003", 8, 1.0, "清河上游"),
        "S003": (None, 0, 0, "源头")
    }
    
    def __init__(self):
        self.driver = None
        self._connect()
    
    def _connect(self):
        """连接Neo4j"""
        try:
            self.driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
            )
            logger.info("Connected to Neo4j")
            self._migrate_legacy_relations()
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")

    def _migrate_legacy_relations(self):
        """幂等迁移：早期误写的 LOCATED_ON 关系合并到规范的 ON_RIVER。
        初始化脚本定义的是 Station-[:ON_RIVER]->River，后端早期误用了 LOCATED_ON，
        此方法将两种关系并到 ON_RIVER，避免画布加载时遗漏。每次启动幂等，
        没有历史数据时影响可忽略。
        """
        try:
            with self.driver.session() as session:
                result = session.run(
                    """
                    MATCH (s:Station)-[rel:LOCATED_ON]->(r:River)
                    MERGE (s)-[:ON_RIVER]->(r)
                    DELETE rel
                    RETURN count(rel) as migrated
                    """
                )
                record = result.single()
                migrated = int(record["migrated"]) if record else 0
                if migrated:
                    logger.info(f"[graph-migrate] merged {migrated} LOCATED_ON rels into ON_RIVER")
        except Exception as e:
            logger.warning(f"[graph-migrate] skip legacy relation migration: {e}")
    
    def close(self):
        """关闭连接"""
        if self.driver:
            self.driver.close()
    
    def create_station_node(self, station_id: str, name: str, station_type: str,
                           longitude: float, latitude: float, **properties) -> bool:
        """创建站点节点"""
        try:
            with self.driver.session() as session:
                session.run("""
                    MERGE (s:Station {station_id: $station_id})
                    SET s.name = $name,
                        s.station_type = $station_type,
                        s.longitude = $longitude,
                        s.latitude = $latitude,
                        s.updated_at = datetime()
                    SET s += $properties
                """, station_id=station_id, name=name, station_type=station_type,
                    longitude=longitude, latitude=latitude, properties=properties)
            return True
        except Exception as e:
            logger.error(f"Failed to create station node: {e}")
            return False
    
    def create_flow_relationship(self, upstream_id: str, downstream_id: str,
                                  distance: float = None, travel_time: float = None) -> bool:
        """创建水流关系（上游 -> 下游）

        与初始化脚本对齐：关系名 UPSTREAM_OF，属性 distance_km / travel_hours。
        使用 MERGE 确保站点不存在时自动补建。
        """
        try:
            with self.driver.session() as session:
                session.run("""
                    MERGE (upstream:Station {station_id: $upstream_id})
                    MERGE (downstream:Station {station_id: $downstream_id})
                    MERGE (upstream)-[r:UPSTREAM_OF]->(downstream)
                    SET r.distance_km = $distance,
                        r.travel_hours = $travel_time,
                        r.updated_at = datetime()
                """, upstream_id=upstream_id, downstream_id=downstream_id,
                    distance=distance, travel_time=travel_time)
            return True
        except Exception as e:
            logger.error(f"Failed to create flow relationship: {e}")
            return False
    
    def get_upstream_stations(self, station_id: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        """获取上游站点（溯源）

        Neo4j 中流向关系为 (upstream)-[:UPSTREAM_OF]->(downstream)，
        属性使用 distance_km / travel_hours，与初始化脚本一致。
        """
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH path = (upstream:Station)-[:UPSTREAM_OF*1..%d]->(target:Station {station_id: $station_id})
                    RETURN upstream.station_id as station_id,
                           upstream.name as name,
                           upstream.station_type as station_type,
                           length(path) as depth,
                           reduce(dist = 0.0, r in relationships(path) | dist + coalesce(r.distance_km, 0.0)) as total_distance,
                           reduce(time = 0.0, r in relationships(path) | time + coalesce(r.travel_hours, 0.0)) as total_travel_time
                    ORDER BY total_distance
                """ % max_depth, station_id=station_id)
                
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get upstream stations: {e}")
            return []
    
    def find_pollution_sources_on_upstream_path(self, station_id: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        """查询目标站点及其上游路径所经河流上挂载的污染源实体。

        河流级关联：PollutionSourceEntity.river_id == Station.river_id
        排序：risk_level(high>medium>low) + source_id
        """
        try:
            with self.driver.session() as session:
                result = session.run(
                    """
                    MATCH (target:Station {station_id: $sid})
                    OPTIONAL MATCH (up:Station)-[:UPSTREAM_OF*1..%d]->(target)
                    WITH collect(DISTINCT target.river_id) + collect(DISTINCT up.river_id) AS river_ids_raw
                    WITH [x IN river_ids_raw WHERE x IS NOT NULL] AS river_ids
                    MATCH (p:PollutionSourceEntity)
                    WHERE p.river_id IN river_ids
                    RETURN p.source_id          AS source_id,
                           p.name               AS name,
                           p.source_type        AS source_type,
                           p.category           AS category,
                           [l IN labels(p) WHERE l <> 'PollutionSourceEntity'][0] AS entity_label,
                           p.river_id           AS river_id,
                           p.district_code      AS district_code,
                           p.longitude          AS longitude,
                           p.latitude           AS latitude,
                           p.pollutants         AS pollutants,
                           p.risk_level         AS risk_level
                    ORDER BY CASE p.risk_level
                                WHEN 'high'   THEN 1
                                WHEN 'medium' THEN 2
                                ELSE 3 END,
                             p.source_id
                    LIMIT 50
                    """ % max_depth,
                    sid=station_id,
                )
                return [dict(r) for r in result]
        except Exception as e:
            logger.error(f"Failed to find pollution sources on upstream path: {e}")
            return []

    def get_downstream_stations(self, station_id: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        """获取下游站点（扩散）"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH path = (source:Station {station_id: $station_id})-[:UPSTREAM_OF*1..%d]->(downstream:Station)
                    RETURN downstream.station_id as station_id,
                           downstream.name as name,
                           downstream.station_type as station_type,
                           length(path) as depth,
                           reduce(dist = 0.0, r in relationships(path) | dist + coalesce(r.distance_km, 0.0)) as total_distance,
                           reduce(time = 0.0, r in relationships(path) | time + coalesce(r.travel_hours, 0.0)) as total_travel_time
                    ORDER BY total_distance
                """ % max_depth, station_id=station_id)
                
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get downstream stations: {e}")
            return []
    
    def trace_pollution_source(self, station_id: str, 
                               detection_time: datetime,
                               lookback_hours: int = 24) -> Dict[str, Any]:
        """污染溯源分析"""
        try:
            logger.info(f"[FLOW] trace_source_start: target={station_id}, lookback={lookback_hours}h")
            # 获取上游站点
            upstream_stations = self.get_upstream_stations(station_id, max_depth=3)
            # 上游路径所经河流上的污染源实体（来自污染图谱）
            pollution_entities = self.find_pollution_sources_on_upstream_path(station_id, max_depth=3)
            
            if not upstream_stations:
                return {
                    "target_station": station_id,
                    "detection_time": detection_time.isoformat(),
                    "sources": [],
                    "pollution_sources": pollution_entities,
                    "total_sources": 0,
                    "total_pollution_entities": len(pollution_entities),
                    "confidence": 0.0,
                    "message": "未找到上游站点" if not pollution_entities else "未找到上游站点，仅返回同河污染源"
                }
            
            # 计算各上游站点的可能性（基于水力停留时间）
            sources = []
            for station in upstream_stations:
                # 优先使用图中 travel_hours 累加；缺失时按 depth*2 小时估算（与扩散预测一致）
                travel_time = station.get("total_travel_time") or 0
                if not travel_time or travel_time <= 0:
                    travel_time = max(1, station.get("depth", 1)) * 2

                # 估算污染发生时间窗口
                estimated_start = detection_time - timedelta(hours=travel_time + 2)
                estimated_end = detection_time - timedelta(hours=max(0, travel_time - 2))

                # 计算置信度（距离越近置信度越高）
                distance = station.get("total_distance") or 0
                # distance 单位为 km；10km 内置信度接近 1，50km 以外兜底 0.3
                confidence = max(0.3, 1.0 - (distance / 50.0))

                sources.append({
                    "station_id": station["station_id"],
                    "station_name": station["name"],
                    "station_type": station["station_type"],
                    "distance": distance,
                    "travel_time": travel_time,
                    "estimated_pollution_time": {
                        "start": estimated_start.isoformat(),
                        "end": estimated_end.isoformat()
                    },
                    "confidence": round(confidence, 2)
                })
            
            # 按置信度排序
            sources.sort(key=lambda x: x["confidence"], reverse=True)
            logger.info(f"[FLOW] trace_source_done: target={station_id}, sources={len(sources)}, top_confidence={sources[0]['confidence'] if sources else 0}")
            
            return {
                "target_station": station_id,
                "detection_time": detection_time.isoformat(),
                "sources": sources[:5],  # 返回前5个可能来源
                "pollution_sources": pollution_entities,  # 图谱中匹配的污染源实体
                "total_sources": len(sources),
                "total_pollution_entities": len(pollution_entities),
                "confidence": sources[0]["confidence"] if sources else 0.0
            }
            
        except Exception as e:
            logger.error(f"Failed to trace pollution source: {e}")
            return {
                "target_station": station_id,
                "detection_time": detection_time.isoformat(),
                "sources": [],
                "pollution_sources": [],
                "total_sources": 0,
                "total_pollution_entities": 0,
                "confidence": 0.0,
                "error": str(e)
            }
    
    def get_flow_path(self, start_station: str, end_station: str) -> List[Dict[str, Any]]:
        """获取两个站点间的水流路径"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH path = shortestPath(
                        (start:Station {station_id: $start})-[:UPSTREAM_OF*]->(end:Station {station_id: $end})
                    )
                    RETURN [node in nodes(path) | {
                        station_id: node.station_id,
                        name: node.name,
                        station_type: node.station_type
                    }] as path_nodes,
                    reduce(dist = 0.0, r in relationships(path) | dist + coalesce(r.distance_km, 0.0)) as total_distance
                """, start=start_station, end=end_station)
                
                record = result.single()
                if record:
                    return {
                        "path": record["path_nodes"],
                        "total_distance": record["total_distance"]
                    }
                return {"path": [], "total_distance": 0}
                
        except Exception as e:
            logger.error(f"Failed to get flow path: {e}")
            return {"path": [], "total_distance": 0}
    
    def analyze_spread(self, station_id: str, 
                       detection_time: datetime,
                       forecast_hours: int = 24) -> Dict[str, Any]:
        """分析污染扩散趋势"""
        try:
            logger.info(f"[FLOW] spread_analysis_start: source={station_id}, forecast={forecast_hours}h")
            # 获取下游站点
            downstream = self.get_downstream_stations(station_id, max_depth=3)
            
            spread_prediction = []
            for station in downstream:
                travel_time = station.get("total_travel_time", station.get("depth", 1) * 2)
                estimated_arrival = detection_time + timedelta(hours=travel_time)
                
                spread_prediction.append({
                    "station_id": station["station_id"],
                    "station_name": station["name"],
                    "distance": station.get("total_distance", 0),
                    "estimated_arrival": estimated_arrival.isoformat(),
                    "hours_from_now": round(travel_time, 1)
                })
            
            # 只返回在预测时间窗口内的
            cutoff_time = detection_time + timedelta(hours=forecast_hours)
            spread_prediction = [
                s for s in spread_prediction 
                if datetime.fromisoformat(s["estimated_arrival"]) <= cutoff_time
            ]
            
            logger.info(f"[FLOW] spread_analysis_done: source={station_id}, affected={len(spread_prediction)} stations")
            return {
                "source_station": station_id,
                "detection_time": detection_time.isoformat(),
                "forecast_hours": forecast_hours,
                "affected_stations": spread_prediction,
                "total_affected": len(spread_prediction)
            }
            
        except Exception as e:
            logger.error(f"Failed to analyze spread: {e}")
            return {
                "source_station": station_id,
                "detection_time": detection_time.isoformat(),
                "affected_stations": [],
                "error": str(e)
            }
    
    # ==================== 图谱数据查询接口 ====================
    
    def get_all_rivers(self) -> List[Dict[str, Any]]:
        """获取所有河流数据"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (r:River)
                    OPTIONAL MATCH (r)-[rel:FLOWS_INTO]->(downstream:River)
                    RETURN r.river_id as river_id,
                           r.name as name,
                           r.level as level,
                           r.system as system,
                           r.sub_system as sub_system,
                           r.length_km as length_km,
                           r.basin_area_km2 as basin_area_km2,
                           r.type as type,
                           downstream.river_id as downstream_river_id,
                           downstream.name as downstream_river_name
                    ORDER BY r.level, r.name
                """)
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get all rivers: {e}")
            return []
    
    def get_river_topology(self) -> Dict[str, Any]:
        """获取河流拓扑关系（用于可视化）"""
        try:
            with self.driver.session() as session:
                # 获取所有河流节点
                rivers_result = session.run("""
                    MATCH (r:River)
                    RETURN r.river_id as id,
                           r.name as name,
                           r.level as level,
                           r.system as system,
                           r.sub_system as sub_system,
                           r.length_km as length_km
                    ORDER BY r.level
                """)
                rivers = [dict(record) for record in rivers_result]
                
                # 获取河流汇入关系
                relations_result = session.run("""
                    MATCH (upstream:River)-[rel:FLOWS_INTO]->(downstream:River)
                    RETURN upstream.river_id as source,
                           downstream.river_id as target,
                           rel.distance_km as distance_km,
                           rel.confluence_id as confluence_id
                """)
                relations = [dict(record) for record in relations_result]
                
                return {"rivers": rivers, "relations": relations}
        except Exception as e:
            logger.error(f"Failed to get river topology: {e}")
            return {"rivers": [], "relations": []}
    
    def get_all_pollution_sources(self, source_type: str = None, 
                                   district_code: str = None,
                                   risk_level: str = None) -> List[Dict[str, Any]]:
        """获取所有污染源数据（支持过滤）"""
        try:
            with self.driver.session() as session:
                # 构建动态过滤条件
                where_clauses = []
                params = {}
                
                if source_type:
                    where_clauses.append("s.source_type = $source_type")
                    params["source_type"] = source_type
                if district_code:
                    where_clauses.append("s.district_code = $district_code")
                    params["district_code"] = district_code
                if risk_level:
                    where_clauses.append("s.risk_level = $risk_level")
                    params["risk_level"] = risk_level
                
                where_clause = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
                
                query = f"""
                    MATCH (s:PollutionSourceEntity)
                    {where_clause}
                    OPTIONAL MATCH (s)-[:DISCHARGES_TO]->(r:River)
                    OPTIONAL MATCH (s)-[:UPSTREAM_OF]->(st:Station)
                    RETURN s.source_id as source_id,
                           s.name as name,
                           labels(s)[1] as category,
                           s.source_type as source_type,
                           s.river_id as river_id,
                           r.name as river_name,
                           s.district_code as district_code,
                           s.longitude as longitude,
                           s.latitude as latitude,
                           s.pollutants as pollutants,
                           s.risk_level as risk_level,
                           s.river_km as river_km,
                           s.discharge_volume as discharge_volume,
                           s.capacity as capacity,
                           s.livestock_count as livestock_count,
                           s.area_km2 as area_km2,
                           collect(DISTINCT st.station_id) as affected_stations
                    ORDER BY s.risk_level DESC, s.name
                """
                result = session.run(query, params)
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get pollution sources: {e}")
            return []
    
    def get_pollution_source_detail(self, source_id: str) -> Dict[str, Any]:
        """获取单个污染源详情"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (s:PollutionSourceEntity {source_id: $source_id})
                    OPTIONAL MATCH (s)-[:DISCHARGES_TO]->(r:River)
                    OPTIONAL MATCH (s)-[rel:UPSTREAM_OF]->(st:Station)
                    OPTIONAL MATCH (s)-[:MAY_CAUSE]->(pt:PollutionType)
                    RETURN s.source_id as source_id,
                           s.name as name,
                           labels(s)[1] as category,
                           s.source_type as source_type,
                           s.river_id as river_id,
                           r.name as river_name,
                           s.district_code as district_code,
                           s.longitude as longitude,
                           s.latitude as latitude,
                           s.pollutants as pollutants,
                           s.risk_level as risk_level,
                           s.discharge_volume as discharge_volume,
                           s.capacity as capacity,
                           s.livestock_count as livestock_count,
                           s.area_km2 as area_km2,
                           collect(DISTINCT {station_id: st.station_id, name: st.name, distance_km: rel.distance_km}) as affected_stations,
                           collect(DISTINCT {type_id: pt.type_id, name: pt.name}) as pollution_types
                """, source_id=source_id)
                record = result.single()
                return dict(record) if record else None
        except Exception as e:
            logger.error(f"Failed to get pollution source detail: {e}")
            return None
    
    def get_all_confluences(self) -> List[Dict[str, Any]]:
        """获取所有交汇点数据"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (c:Confluence)
                    OPTIONAL MATCH (d:District {code: c.district_code})
                    RETURN c.confluence_id as confluence_id,
                           c.name as name,
                           c.longitude as longitude,
                           c.latitude as latitude,
                           c.district_code as district_code,
                           d.name as district_name,
                           c.priority as priority,
                           c.description as description,
                           c.is_boundary as is_boundary,
                           c.river_km as river_km,
                           c.confluence_type as confluence_type,
                           c.through_river_id as through_river_id
                    ORDER BY c.priority DESC
                """)
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get confluences: {e}")
            return []
    
    def get_all_districts(self) -> List[Dict[str, Any]]:
        """获取所有行政区数据"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (d:District)
                    RETURN d.code as code,
                           d.name as name,
                           d.level as level,
                           d.parent_code as parent_code
                    ORDER BY d.code
                """)
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Failed to get districts: {e}")
            return []
    
    def get_graph_statistics(self) -> Dict[str, Any]:
        """获取图谱统计数据"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (r:River) WITH count(r) as rivers
                    MATCH (s:Station) WITH rivers, count(s) as stations
                    MATCH (c:Confluence) WITH rivers, stations, count(c) as confluences
                    MATCH (p:PollutionSourceEntity) WITH rivers, stations, confluences, count(p) as pollution_sources
                    MATCH (d:District) WITH rivers, stations, confluences, pollution_sources, count(d) as districts
                    MATCH (ind:IndustrialSource) WITH rivers, stations, confluences, pollution_sources, districts, count(ind) as industrial
                    MATCH (agr:AgriculturalSource) WITH rivers, stations, confluences, pollution_sources, districts, industrial, count(agr) as agricultural
                    MATCH (mun:MunicipalSource) WITH rivers, stations, confluences, pollution_sources, districts, industrial, agricultural, count(mun) as municipal
                    RETURN rivers, stations, confluences, pollution_sources, districts, industrial, agricultural, municipal
                """)
                record = result.single()
                if record:
                    return {
                        "rivers": record["rivers"],
                        "stations": record["stations"],
                        "confluences": record["confluences"],
                        "pollution_sources": record["pollution_sources"],
                        "districts": record["districts"],
                        "by_category": {
                            "industrial": record["industrial"],
                            "agricultural": record["agricultural"],
                            "municipal": record["municipal"]
                        }
                    }
                return {}
        except Exception as e:
            logger.error(f"Failed to get graph statistics: {e}")
            return {}
    
    # ==================== 核心方法：溯源查询（8行） ====================
    def trace_upstream_core(self, station_id: str) -> List[Dict]:
        """溯源核心：Neo4j查询上游 + 计算置信度"""
        try:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH path = (up:Station)-[:UPSTREAM_OF*1..3]->(t:Station {station_id: $sid})
                    RETURN up.station_id AS id, up.name AS name,
                           reduce(d=0.0, r IN relationships(path) | d + coalesce(r.distance_km, 0.0)) AS distance
                """, sid=station_id)
                return [{"station_id": r["id"], "station_name": r["name"], "distance": r["distance"],
                         "confidence": round(max(0.3, 1 - r["distance"]/50), 2)} for r in result]
        except Exception as e:
            logger.error(f"trace_upstream_core failed: {e}")
            return []

    # ==================== 图谱节点 CUD 方法（供 graph_admin 调用） ====================
    # ---------- River ----------
    def upsert_river(self, river_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        with self.driver.session() as session:
            result = session.run(
                """
                MERGE (r:River {river_id: $river_id})
                SET r += $properties,
                    r.updated_at = datetime()
                RETURN r {.*} as r
                """,
                river_id=river_id, properties=properties,
            )
            record = result.single()
            return dict(record["r"]) if record else {}

    def get_river(self, river_id: str) -> Optional[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (r:River {river_id: $rid}) RETURN r {.*} as r",
                rid=river_id,
            )
            record = result.single()
            return dict(record["r"]) if record else None

    def delete_river(self, river_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:River {river_id: $rid})
                DETACH DELETE r
                RETURN count(r) as deleted
                """,
                rid=river_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def create_river_flows_into(self, upstream_id: str, downstream_id: str,
                                 distance_km: Optional[float] = None,
                                 confluence_id: Optional[str] = None) -> bool:
        with self.driver.session() as session:
            session.run(
                """
                MATCH (u:River {river_id: $u})
                MATCH (d:River {river_id: $d})
                MERGE (u)-[rel:FLOWS_INTO]->(d)
                SET rel.distance_km = $dist,
                    rel.confluence_id = $cid,
                    rel.updated_at = datetime()
                """,
                u=upstream_id, d=downstream_id, dist=distance_km, cid=confluence_id,
            )
            return True

    def delete_river_flows_into(self, upstream_id: str, downstream_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:River {river_id: $u})-[rel:FLOWS_INTO]->(d:River {river_id: $d})
                DELETE rel
                RETURN count(rel) as deleted
                """,
                u=upstream_id, d=downstream_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    # ---------- PollutionSource ----------
    def upsert_pollution_source(self, source_id: str, category: str,
                                 properties: Dict[str, Any]) -> Dict[str, Any]:
        """升级/新建污染源节点；多标签 PollutionSourceEntity:<category>"""
        valid_categories = {"IndustrialSource", "AgriculturalSource", "MunicipalSource"}
        if category not in valid_categories:
            raise ValueError(f"category must be one of {valid_categories}")
        with self.driver.session() as session:
            # MERGE 后添加分类标签
            session.run(
                f"""
                MERGE (s:PollutionSourceEntity {{source_id: $sid}})
                SET s:{category}
                SET s += $properties,
                    s.updated_at = datetime()
                """,
                sid=source_id, properties=properties,
            )
            result = session.run(
                """
                MATCH (s:PollutionSourceEntity {source_id: $sid})
                RETURN s {.*, category: labels(s)[1]} as s
                """,
                sid=source_id,
            )
            record = result.single()
            return dict(record["s"]) if record else {}

    def delete_pollution_source(self, source_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (s:PollutionSourceEntity {source_id: $sid})
                DETACH DELETE s
                RETURN count(s) as deleted
                """,
                sid=source_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def link_pollution_to_river(self, source_id: str, river_id: str) -> bool:
        with self.driver.session() as session:
            session.run(
                """
                MATCH (s:PollutionSourceEntity {source_id: $sid})
                MATCH (r:River {river_id: $rid})
                MERGE (s)-[rel:DISCHARGES_TO]->(r)
                SET rel.updated_at = datetime()
                """,
                sid=source_id, rid=river_id,
            )
            return True

    def unlink_pollution_from_river(self, source_id: str, river_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (s:PollutionSourceEntity {source_id: $sid})-[rel:DISCHARGES_TO]->(r:River {river_id: $rid})
                DELETE rel RETURN count(rel) as deleted
                """,
                sid=source_id, rid=river_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def unlink_pollution_from_all_rivers(self, source_id: str) -> int:
        """解绑污染源与所有河流的 DISCHARGES_TO 关系，用于改绑事务"""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (s:PollutionSourceEntity {source_id: $sid})-[rel:DISCHARGES_TO]->(:River)
                DELETE rel RETURN count(rel) as deleted
                """,
                sid=source_id,
            )
            record = result.single()
            return int(record["deleted"]) if record else 0

    # ---------- Station 拓扑（上下游 + 挂挂河流） ----------
    def delete_station_flow(self, upstream_id: str, downstream_id: str) -> bool:
        """删除站点上下游关系 (Station)-[:UPSTREAM_OF]->(Station)"""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:Station {station_id: $u})-[rel:UPSTREAM_OF]->(d:Station {station_id: $d})
                DELETE rel RETURN count(rel) as deleted
                """,
                u=upstream_id, d=downstream_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def update_station_props(self, station_id: str, **props) -> bool:
        """更新站点节点属性（MERGE 确保不存在时自动创建）。"""
        allowed = {'name', 'station_name', 'station_code', 'river_id', 'river_km',
                   'longitude', 'latitude', 'status', 'district'}
        filtered = {k: v for k, v in props.items() if k in allowed and v is not None}
        if not filtered:
            return True
        set_parts = ', '.join(f's.{k} = ${k}' for k in filtered)
        set_parts += ', s.updated_at = datetime()'
        try:
            with self.driver.session() as session:
                session.run(
                    f"""
                    MERGE (s:Station {{station_id: $station_id}})
                    SET {set_parts}
                    """,
                    station_id=station_id, **filtered,
                )
            return True
        except Exception as e:
            logger.error(f"Failed to update station props: {e}")
            return False

    def link_station_to_river(self, station_id: str, river_id: str) -> bool:
        """站点挂到河流：(Station)-[:ON_RIVER]->(River)。站点节点不存在时 MERGE 补建。关系名与初始化脚本对齐。"""
        with self.driver.session() as session:
            session.run(
                """
                MERGE (s:Station {station_id: $sid})
                WITH s
                MATCH (r:River {river_id: $rid})
                MERGE (s)-[rel:ON_RIVER]->(r)
                SET s.river_id = $rid,
                    rel.updated_at = datetime()
                """,
                sid=station_id, rid=river_id,
            )
            return True

    def unlink_station_from_river(self, station_id: str, river_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (s:Station {station_id: $sid})-[rel:ON_RIVER]->(r:River {river_id: $rid})
                DELETE rel
                WITH s
                REMOVE s.river_id
                RETURN 1 as ok
                """,
                sid=station_id, rid=river_id,
            )
            record = result.single()
            return bool(record)

    # ---------- Confluence ----------
    def link_river_to_confluence(self, river_id: str, confluence_id: str, distance_km: Optional[float] = None) -> bool:
        """河流汇入交汇点：(River)-[:FLOWS_INTO_CONFLUENCE]->(Confluence)。
        要求 River 和 Confluence 节点存在，不存在时返回 False。"""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:River {river_id: $rid}), (c:Confluence {confluence_id: $cid})
                MERGE (r)-[rel:FLOWS_INTO_CONFLUENCE]->(c)
                SET rel.distance_km = coalesce($distance_km, rel.distance_km),
                    rel.updated_at = datetime()
                RETURN 1 as ok
                """,
                rid=river_id, cid=confluence_id, distance_km=distance_km,
            )
            return result.single() is not None

    def unlink_river_from_confluence(self, river_id: str, confluence_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:River {river_id: $rid})-[rel:FLOWS_INTO_CONFLUENCE]->(c:Confluence {confluence_id: $cid})
                DELETE rel RETURN count(rel) as deleted
                """,
                rid=river_id, cid=confluence_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def link_confluence_to_river(self, confluence_id: str, river_id: str, distance_km: Optional[float] = None) -> bool:
        """交汇点下泄为河流：(Confluence)-[:CONFLUENCE_FLOWS_TO]->(River)。"""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (c:Confluence {confluence_id: $cid}), (r:River {river_id: $rid})
                MERGE (c)-[rel:CONFLUENCE_FLOWS_TO]->(r)
                SET rel.distance_km = coalesce($distance_km, rel.distance_km),
                    rel.updated_at = datetime()
                RETURN 1 as ok
                """,
                cid=confluence_id, rid=river_id, distance_km=distance_km,
            )
            return result.single() is not None

    def unlink_confluence_from_river(self, confluence_id: str, river_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (c:Confluence {confluence_id: $cid})-[rel:CONFLUENCE_FLOWS_TO]->(r:River {river_id: $rid})
                DELETE rel RETURN count(rel) as deleted
                """,
                cid=confluence_id, rid=river_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def upsert_confluence(self, confluence_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        with self.driver.session() as session:
            session.run(
                """
                MERGE (c:Confluence {confluence_id: $cid})
                SET c += $properties,
                    c.updated_at = datetime()
                """,
                cid=confluence_id, properties=properties,
            )
            result = session.run(
                "MATCH (c:Confluence {confluence_id: $cid}) RETURN c {.*} as c",
                cid=confluence_id,
            )
            record = result.single()
            return dict(record["c"]) if record else {}

    def delete_confluence(self, confluence_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (c:Confluence {confluence_id: $cid}) DETACH DELETE c RETURN count(c) as deleted",
                cid=confluence_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def get_confluence(self, confluence_id: str) -> Optional[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (c:Confluence {confluence_id: $cid}) RETURN c {.*} as c",
                cid=confluence_id,
            )
            record = result.single()
            return dict(record["c"]) if record else None

    # ---------- District ----------
    def upsert_district(self, code: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        with self.driver.session() as session:
            session.run(
                """
                MERGE (d:District {code: $code})
                SET d += $properties,
                    d.updated_at = datetime()
                """,
                code=code, properties=properties,
            )
            result = session.run(
                "MATCH (d:District {code: $code}) RETURN d {.*} as d",
                code=code,
            )
            record = result.single()
            return dict(record["d"]) if record else {}

    def delete_district(self, code: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (d:District {code: $code}) DETACH DELETE d RETURN count(d) as deleted",
                code=code,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def get_district(self, code: str) -> Optional[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (d:District {code: $code}) RETURN d {.*} as d",
                code=code,
            )
            record = result.single()
            return dict(record["d"]) if record else None

    # ---------- EmergencyPlan ----------
    def upsert_emergency_plan(self, plan_id: str, properties: Dict[str, Any],
                               pollution_types: Optional[List[str]] = None) -> Dict[str, Any]:
        with self.driver.session() as session:
            session.run(
                """
                MERGE (p:EmergencyPlan {plan_id: $pid})
                SET p += $properties,
                    p.updated_at = datetime()
                """,
                pid=plan_id, properties=properties,
            )
            # 重建关联的污染类型
            if pollution_types is not None:
                session.run(
                    "MATCH (p:EmergencyPlan {plan_id: $pid})-[rel:APPLIES_TO]->() DELETE rel",
                    pid=plan_id,
                )
                for ptype in pollution_types:
                    session.run(
                        """
                        MATCH (p:EmergencyPlan {plan_id: $pid})
                        MERGE (t:PollutionType {type_id: $type})
                        MERGE (p)-[:APPLIES_TO]->(t)
                        """,
                        pid=plan_id, type=ptype,
                    )
            result = session.run(
                """
                MATCH (p:EmergencyPlan {plan_id: $pid})
                OPTIONAL MATCH (p)-[:APPLIES_TO]->(t:PollutionType)
                RETURN p {.*, pollution_types: collect(DISTINCT t.type_id)} as p
                """,
                pid=plan_id,
            )
            record = result.single()
            return dict(record["p"]) if record else {}

    def delete_emergency_plan(self, plan_id: str) -> bool:
        with self.driver.session() as session:
            result = session.run(
                "MATCH (p:EmergencyPlan {plan_id: $pid}) DETACH DELETE p RETURN count(p) as deleted",
                pid=plan_id,
            )
            record = result.single()
            return bool(record and record["deleted"] > 0)

    def list_emergency_plans(self) -> List[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (p:EmergencyPlan)
                OPTIONAL MATCH (p)-[:APPLIES_TO]->(t:PollutionType)
                RETURN p {.*, pollution_types: collect(DISTINCT t.type_id)} as p
                ORDER BY p.plan_id
                """
            )
            return [dict(r["p"]) for r in result]

    def get_emergency_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (p:EmergencyPlan {plan_id: $pid})
                OPTIONAL MATCH (p)-[:APPLIES_TO]->(t:PollutionType)
                RETURN p {.*, pollution_types: collect(DISTINCT t.type_id)} as p
                """,
                pid=plan_id,
            )
            record = result.single()
            return dict(record["p"]) if record else None

