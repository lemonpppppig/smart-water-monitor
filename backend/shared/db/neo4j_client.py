"""
Neo4j图数据库连接封装
"""
from typing import Optional, List, Dict, Any
from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession
import os

# Neo4j配置（优先读 env，缺省 fallback 到本地 docker-compose 依赖的默认账号）
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "water123")


class Neo4jClient:
    """Neo4j图数据库客户端"""
    
    def __init__(self, uri: str = NEO4J_URI, user: str = NEO4J_USER, password: str = NEO4J_PASSWORD):
        self.uri = uri
        self.user = user
        self.password = password
        self._driver: Optional[AsyncDriver] = None
    
    async def connect(self):
        """建立连接"""
        if self._driver is None:
            self._driver = AsyncGraphDatabase.driver(
                self.uri,
                auth=(self.user, self.password)
            )
    
    async def close(self):
        """关闭连接"""
        if self._driver:
            await self._driver.close()
            self._driver = None
    
    async def verify_connectivity(self) -> bool:
        """验证连接"""
        try:
            await self.connect()
            await self._driver.verify_connectivity()
            return True
        except Exception:
            return False
    
    async def run_query(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """执行Cypher查询"""
        await self.connect()
        async with self._driver.session() as session:
            result = await session.run(query, parameters or {})
            records = await result.data()
            return records
    
    async def execute_write(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """执行写操作"""
        await self.connect()
        async with self._driver.session() as session:
            result = await session.execute_write(self._do_write, query, parameters or {})
            return result
    
    @staticmethod
    async def _do_write(tx, query: str, parameters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """写事务处理"""
        result = await tx.run(query, parameters)
        return await result.data()
    
    # 水系图相关操作
    async def create_station_node(self, station_id: str, name: str, station_type: str, 
                                   longitude: float, latitude: float, **properties):
        """创建站点节点"""
        query = """
        MERGE (s:Station {station_id: $station_id})
        SET s.name = $name,
            s.station_type = $station_type,
            s.longitude = $longitude,
            s.latitude = $latitude,
            s.updated_at = datetime()
        SET s += $properties
        RETURN s
        """
        params = {
            "station_id": station_id,
            "name": name,
            "station_type": station_type,
            "longitude": longitude,
            "latitude": latitude,
            "properties": properties
        }
        return await self.execute_write(query, params)
    
    async def create_upstream_relationship(self, upstream_id: str, downstream_id: str, 
                                           distance: float = None, travel_time: float = None):
        """创建上下游关系（上游 -> 下游）。

        与初始化脚本一致：关系名 UPSTREAM_OF，属性 distance_km / travel_hours。
        """
        query = """
        MATCH (upstream:Station {station_id: $upstream_id})
        MATCH (downstream:Station {station_id: $downstream_id})
        MERGE (upstream)-[r:UPSTREAM_OF]->(downstream)
        SET r.distance_km = $distance,
            r.travel_hours = $travel_time,
            r.updated_at = datetime()
        RETURN r
        """
        params = {
            "upstream_id": upstream_id,
            "downstream_id": downstream_id,
            "distance": distance,
            "travel_time": travel_time
        }
        return await self.execute_write(query, params)
    
    async def get_upstream_stations(self, station_id: str, depth: int = 3) -> List[Dict[str, Any]]:
        """获取上游站点（溯源）"""
        # 变长路径长度必须为字面量，不能通过参数传入
        depth = int(depth)
        query = f"""
        MATCH path = (upstream:Station)-[:UPSTREAM_OF*1..{depth}]->(target:Station {{station_id: $station_id}})
        RETURN upstream.station_id as station_id,
               upstream.name as name,
               upstream.station_type as station_type,
               length(path) as distance_steps,
               reduce(dist = 0.0, r in relationships(path) | dist + coalesce(r.distance_km, 0.0)) as total_distance,
               reduce(time = 0.0, r in relationships(path) | time + coalesce(r.travel_hours, 0.0)) as total_travel_time
        ORDER BY total_distance
        """
        return await self.run_query(query, {"station_id": station_id})
    
    async def get_downstream_stations(self, station_id: str, depth: int = 3) -> List[Dict[str, Any]]:
        """获取下游站点（扩散）"""
        depth = int(depth)
        query = f"""
        MATCH path = (source:Station {{station_id: $station_id}})-[:UPSTREAM_OF*1..{depth}]->(downstream:Station)
        RETURN downstream.station_id as station_id,
               downstream.name as name,
               downstream.station_type as station_type,
               length(path) as distance_steps,
               reduce(dist = 0.0, r in relationships(path) | dist + coalesce(r.distance_km, 0.0)) as total_distance,
               reduce(time = 0.0, r in relationships(path) | time + coalesce(r.travel_hours, 0.0)) as total_travel_time
        ORDER BY distance_steps
        """
        return await self.run_query(query, {"station_id": station_id})
    
    async def get_all_stations(self) -> List[Dict[str, Any]]:
        """获取所有站点"""
        query = """
        MATCH (s:Station)
        RETURN s.station_id as station_id,
               s.name as name,
               s.station_type as station_type,
               s.longitude as longitude,
               s.latitude as latitude
        """
        return await self.run_query(query)
    
    # ==============================================
    # 知识图谱相关操作
    # ==============================================
    
    async def get_pollution_rules(self, pollution_type: str = None) -> List[Dict[str, Any]]:
        """获取污染类型及其规则"""
        if pollution_type:
            query = """
            MATCH (p:PollutionType {type_id: $type_id})-[:HAS_RULE]->(r:Rule)
            RETURN p.type_id as pollution_type,
                   p.name as pollution_name,
                   p.description as description,
                   p.judgment_basis as judgment_basis,
                   collect({
                       metric: r.metric,
                       min_value: r.min_value,
                       max_value: r.max_value,
                       weight: r.weight,
                       description: r.description
                   }) as rules
            """
            return await self.run_query(query, {"type_id": pollution_type})
        else:
            query = """
            MATCH (p:PollutionType)-[:HAS_RULE]->(r:Rule)
            RETURN p.type_id as pollution_type,
                   p.name as pollution_name,
                   p.description as description,
                   p.judgment_basis as judgment_basis,
                   p.indicators as indicators,
                   collect({
                       metric: r.metric,
                       min_value: r.min_value,
                       max_value: r.max_value,
                       weight: r.weight,
                       description: r.description
                   }) as rules
            """
            return await self.run_query(query)
    
    async def get_emergency_plan(self, pollution_type: str) -> Dict[str, Any]:
        """获取应急预案及负责部门"""
        query = """
        MATCH (p:PollutionType {type_id: $type_id})-[:HAS_PLAN]->(plan:EmergencyPlan)
        OPTIONAL MATCH (plan)-[:INVOLVES]->(d:Department)
        RETURN p.type_id as pollution_type,
               p.name as pollution_name,
               plan.plan_id as plan_id,
               plan.name as plan_name,
               plan.actions as actions,
               plan.priority as priority,
               plan.response_time as response_time,
               collect({
                   dept_id: d.dept_id,
                   name: d.name,
                   phone: d.phone,
                   responsibility: d.responsibility
               }) as departments
        """
        results = await self.run_query(query, {"type_id": pollution_type})
        return results[0] if results else None
    
    async def get_pollution_sources(self, pollution_type: str = None) -> List[Dict[str, Any]]:
        """获取污染源信息"""
        if pollution_type:
            query = """
            MATCH (s:PollutionSource)-[:CAUSES]->(p:PollutionType {type_id: $type_id})
            RETURN s.source_id as source_id,
                   s.name as source_name,
                   s.type as source_type,
                   p.type_id as pollution_type,
                   p.name as pollution_name
            """
            return await self.run_query(query, {"type_id": pollution_type})
        else:
            query = """
            MATCH (s:PollutionSource)-[:CAUSES]->(p:PollutionType)
            RETURN s.source_id as source_id,
                   s.name as source_name,
                   s.type as source_type,
                   collect(p.type_id) as causes
            """
            return await self.run_query(query)
    
    async def get_full_knowledge_chain(self, pollution_type: str) -> Dict[str, Any]:
        """获取完整知识链：污染类型 -> 规则 -> 预案 -> 部门"""
        query = """
        MATCH (p:PollutionType {type_id: $type_id})
        OPTIONAL MATCH (p)-[:HAS_RULE]->(r:Rule)
        OPTIONAL MATCH (p)-[:HAS_PLAN]->(plan:EmergencyPlan)
        OPTIONAL MATCH (plan)-[:INVOLVES]->(d:Department)
        OPTIONAL MATCH (src:PollutionSource)-[:CAUSES]->(p)
        RETURN p.type_id as pollution_type,
               p.name as pollution_name,
               p.description as description,
               p.judgment_basis as judgment_basis,
               p.severity as severity,
               collect(DISTINCT {
                   metric: r.metric,
                   min_value: r.min_value,
                   max_value: r.max_value,
                   weight: r.weight
               }) as rules,
               plan.actions as actions,
               plan.priority as priority,
               plan.response_time as response_time,
               collect(DISTINCT d.name) as departments,
               collect(DISTINCT src.name) as possible_sources
        """
        results = await self.run_query(query, {"type_id": pollution_type})
        return results[0] if results else None

    async def get_upstream_pollution_sources(self, station_id: str, anomaly_metrics: List[str] = None) -> List[Dict[str, Any]]:
        """获取站点上游的潜在污染源
        
        Args:
            station_id: 目标站点ID
            anomaly_metrics: 异常指标列表，用于筛选匹配的污染源
        
        Returns:
            上游污染源列表，按距离排序
        """
        if anomaly_metrics:
            # 根据异常指标筛选匹配的污染源
            query = """
            MATCH (source:PollutionSourceEntity)-[rel:UPSTREAM_OF]->(target:Station {station_id: $station_id})
            WHERE ANY(p IN source.pollutants WHERE p IN $metrics)
            RETURN source.source_id as source_id,
                   source.name as name,
                   source.source_type as source_type,
                   labels(source)[1] as category,
                   source.pollutants as pollutants,
                   source.risk_level as risk_level,
                   source.river_id as river_id,
                   source.district_code as district_code,
                   rel.distance_km as distance_km,
                   rel.travel_hours as travel_hours,
                   size([p IN source.pollutants WHERE p IN $metrics]) as match_count
            ORDER BY match_count DESC, rel.distance_km ASC
            """
            return await self.run_query(query, {"station_id": station_id, "metrics": anomaly_metrics})
        else:
            # 获取所有上游污染源
            query = """
            MATCH (source:PollutionSourceEntity)-[rel:UPSTREAM_OF]->(target:Station {station_id: $station_id})
            RETURN source.source_id as source_id,
                   source.name as name,
                   source.source_type as source_type,
                   labels(source)[1] as category,
                   source.pollutants as pollutants,
                   source.risk_level as risk_level,
                   source.river_id as river_id,
                   source.district_code as district_code,
                   rel.distance_km as distance_km,
                   rel.travel_hours as travel_hours
            ORDER BY rel.distance_km ASC
            """
            return await self.run_query(query, {"station_id": station_id})


# 全局Neo4j客户端实例
_neo4j_client: Optional[Neo4jClient] = None


def get_neo4j_client() -> Neo4jClient:
    """获取Neo4j客户端实例（单例）"""
    global _neo4j_client
    if _neo4j_client is None:
        _neo4j_client = Neo4jClient()
    return _neo4j_client
