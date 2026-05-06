"""
TDengine时序数据库连接封装
"""
import re
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
import taosws
import logging

from app.data.config import settings

logger = logging.getLogger(__name__)

# 允许的字段白名单
ALLOWED_FIELDS = {
    "ts", "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
    "chlorophyll", "blue_green_algae", "total_n", "total_p", "codcr",
    "transparency", "orp", "water_temperature",
    "tds", "sal", "flow_speed", "flow_rate", "water_level"
}

# 环境数据允许字段
ALLOWED_ENV_FIELDS = {
    "ts", "air_pressure", "illuminance", "temperature", "humidity"
}

# 站点ID验证正则：只允许字母、数字、下划线和连字符
STATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _validate_identifier(name: str) -> str:
    """验证标识符是否安全（防止SQL注入）"""
    if not name or not STATION_ID_PATTERN.match(name):
        raise ValueError(f"Invalid identifier: {name}. Only alphanumeric, underscore and hyphen allowed.")
    return name


def _safe_table_name(station_id: str) -> str:
    """将 station_id 转为 TDengine 合法的子表名（连字符替换为下划线）"""
    return station_id.replace("-", "_")


def _validate_fields(fields: List[str]) -> List[str]:
    """验证字段列表是否在白名单中"""
    if not fields:
        return list(ALLOWED_FIELDS)
    invalid_fields = set(fields) - ALLOWED_FIELDS
    if invalid_fields:
        raise ValueError(f"Invalid fields: {invalid_fields}. Allowed fields: {ALLOWED_FIELDS}")
    return fields


class TDengineClient:
    """TDengine客户端"""
    
    def __init__(self, host: str = None, port: int = None, 
                 user: str = None, password: str = None, database: str = None):
        self.host = host or settings.TDENGINE_HOST
        self.port = port or settings.TDENGINE_PORT
        self.user = user or settings.TDENGINE_USER
        self.password = password or settings.TDENGINE_PASSWORD
        self.database = database or settings.TDENGINE_DATABASE
        self._conn = None
    
    def connect(self):
        """建立连接（含断线重连）"""
        try:
            # 尝试检测旧连接是否仍然有效
            if self._conn is not None:
                try:
                    self._conn.query("SELECT SERVER_VERSION()")
                    return  # 连接有效，直接返回
                except Exception:
                    logger.warning("TDengine connection lost, reconnecting...")
                    try:
                        self._conn.close()
                    except Exception:
                        pass
                    self._conn = None

            # 建立新连接
            self._conn = taosws.connect(
                f"taosws://{self.user}:{self.password}@{self.host}:{self.port}"
            )
            # 确保数据库存在
            self._ensure_database()
            logger.info(f"Connected to TDengine at {self.host}:{self.port}")
        except Exception as e:
            logger.error(f"Failed to connect to TDengine: {e}")
            self._conn = None
            raise
    
    def close(self):
        """关闭连接"""
        if self._conn:
            self._conn.close()
            self._conn = None
    
    def _ensure_database(self):
        """确保数据库和超级表存在"""
        try:
            # 创建数据库
            self._conn.execute(f"CREATE DATABASE IF NOT EXISTS {self.database}")
            self._conn.execute(f"USE {self.database}")
            
            # 检查 water_quality 超级表是否需要重建（列缺失时重建）
            need_recreate = False
            try:
                result = self._conn.query("DESCRIBE water_quality")
                existing_cols = {row[0] for row in result}
                required_cols = {"tds", "sal", "flow_speed", "flow_rate", "water_level"}
                if not required_cols.issubset(existing_cols):
                    missing = required_cols - existing_cols
                    logger.warning(f"water_quality 缺少列: {missing}，尝试 ALTER 补充")
                    for col in missing:
                        try:
                            self._conn.execute(f"ALTER STABLE water_quality ADD COLUMN {col} FLOAT")
                            logger.info(f"ALTER STABLE: 已添加列 '{col}'")
                        except Exception as e:
                            logger.warning(f"ALTER STABLE ADD COLUMN {col} 失败: {e}，将重建超级表")
                            need_recreate = True
                            break
            except Exception:
                # 表不存在，正常创建即可
                pass
            
            if need_recreate:
                logger.warning("重建 water_quality 超级表（旧数据将丢失）")
                try:
                    self._conn.execute("DROP STABLE IF EXISTS water_quality")
                except Exception as e:
                    logger.error(f"DROP STABLE water_quality 失败: {e}")
            
            # 创建水质数据超级表
            self._conn.execute("""
                CREATE STABLE IF NOT EXISTS water_quality (
                    ts TIMESTAMP,
                    ph FLOAT,
                    do FLOAT,
                    nh3_n FLOAT,
                    codmn FLOAT,
                    turbidity FLOAT,
                    conductivity FLOAT,
                    chlorophyll FLOAT,
                    blue_green_algae FLOAT,
                    total_n FLOAT,
                    total_p FLOAT,
                    codcr FLOAT,
                    transparency FLOAT,
                    orp FLOAT,
                    water_temperature FLOAT,
                    tds FLOAT,
                    sal FLOAT,
                    flow_speed FLOAT,
                    flow_rate FLOAT,
                    water_level FLOAT
                ) TAGS (
                    station_id VARCHAR(64),
                    station_type VARCHAR(32),
                    region VARCHAR(64)
                )
            """)
            
            # 创建环境数据超级表（气象/环境参数）
            self._conn.execute("""
                CREATE STABLE IF NOT EXISTS environment_data (
                    ts TIMESTAMP,
                    air_pressure FLOAT,
                    illuminance FLOAT,
                    temperature FLOAT,
                    humidity FLOAT
                ) TAGS (
                    station_id VARCHAR(64),
                    station_type VARCHAR(32),
                    region VARCHAR(64)
                )
            """)
            
            logger.info("TDengine database and stables initialized")
        except Exception as e:
            logger.error(f"Failed to initialize TDengine schema: {e}")
            raise
    
    def insert_water_quality(self, data: Dict[str, Any]) -> bool:
        """插入单条水质数据"""
        self.connect()
        
        try:
            # 构建插入SQL
            tags = {
                "station_id": data.get("station_id", ""),
                "station_type": data.get("station_type", ""),
                "region": data.get("region", "")
            }
            
            # 验证站点ID
            _validate_identifier(tags['station_id'])
            
            # 检查子表是否存在，不存在则创建（UUID连字符转下划线）
            sub_table = f"wq_{_safe_table_name(tags['station_id'])}"
            self._conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {sub_table} 
                USING water_quality TAGS ('{tags['station_id']}', '{tags['station_type']}', '{tags['region']}')
            """)
            
            # 插入数据
            fields = [
                "ts", "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
                "chlorophyll", "blue_green_algae", "total_n", "total_p", 
                "codcr", "transparency", "orp", "water_temperature",
                "tds", "sal", "flow_speed", "flow_rate", "water_level"
            ]
            
            values = []
            for field in fields:
                val = data.get(field)
                if val is None:
                    values.append("NULL")
                elif field == "ts":
                    values.append(f"'{val}'")
                else:
                    values.append(str(val))
            
            sql = f"INSERT INTO {sub_table} ({', '.join(fields)}) VALUES ({', '.join(values)})"
            self._conn.execute(sql)
            logger.info(f"[FLOW] tdengine_insert_wq: table={sub_table}, pH={data.get('ph')}, DO={data.get('do')}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to insert water quality data: {e}")
            return False
    
    def insert_batch(self, data_list: List[Dict[str, Any]]) -> Tuple[int, int]:
        """批量插入水质数据"""
        self.connect()
        
        success_count = 0
        failed_count = 0
        
        for data in data_list:
            if self.insert_water_quality(data):
                success_count += 1
            else:
                failed_count += 1
        
        return success_count, failed_count
    
    def insert_environment_data(self, data: Dict[str, Any]) -> bool:
        """插入环境数据（气压/光照/温湿度）"""
        self.connect()
        
        try:
            station_id = data.get("station_id", "default")
            _validate_identifier(station_id)
            
            sub_table = f"env_{_safe_table_name(station_id)}"
            self._conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {sub_table}
                USING environment_data TAGS ('{station_id}', '', '')
            """)
            
            fields = ["ts", "air_pressure", "illuminance", "temperature", "humidity"]
            values = []
            for field in fields:
                val = data.get(field)
                if val is None:
                    values.append("NULL")
                elif field == "ts":
                    values.append(f"'{val}'")
                else:
                    values.append(str(val))
            
            sql = f"INSERT INTO {sub_table} ({', '.join(fields)}) VALUES ({', '.join(values)})"
            self._conn.execute(sql)
            logger.info(f"[FLOW] tdengine_insert_env: table={sub_table}, temp={data.get('temperature')}, humidity={data.get('humidity')}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to insert environment data: {e}")
            return False
    
    def query_water_quality(
        self,
        station_id: str,
        start_time: datetime,
        end_time: datetime,
        fields: List[str] = None
    ) -> List[Dict[str, Any]]:
        """查询水质数据"""
        self.connect()
        
        try:
            # 验证站点ID
            _validate_identifier(station_id)
            
            # 验证字段列表
            fields = _validate_fields(fields)
            
            # 构建查询
            sub_table = f"wq_{_safe_table_name(station_id)}"
            fields_str = ", ".join(fields)
            
            sql = f"""
                SELECT {fields_str} FROM {sub_table}
                WHERE ts >= '{start_time.strftime('%Y-%m-%d %H:%M:%S')}'
                AND ts <= '{end_time.strftime('%Y-%m-%d %H:%M:%S')}'
                ORDER BY ts
            """
            
            result = self._conn.query(sql)
            
            # 转换为字典列表
            data = []
            for row in result:
                row_dict = {}
                for i, field in enumerate(fields):
                    row_dict[field] = row[i]
                data.append(row_dict)
            
            return data
            
        except Exception as e:
            logger.error(f"Failed to query water quality data: {e}")
            return []
    
    def query_latest(self, station_id: str) -> Optional[Dict[str, Any]]:
        """查询最新数据"""
        self.connect()
        
        try:
            # 验证站点ID
            _validate_identifier(station_id)
            sub_table = f"wq_{_safe_table_name(station_id)}"
            sql = f"SELECT * FROM {sub_table} ORDER BY ts DESC LIMIT 1"
            result = self._conn.query(sql)
            
            if result and len(result) > 0:
                row = result[0]
                columns = ["ts", "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
                          "chlorophyll", "blue_green_algae", "total_n", "total_p",
                          "codcr", "transparency", "orp", "water_temperature"]
                return {col: row[i] for i, col in enumerate(columns)}
            return None
            
        except Exception as e:
            logger.error(f"Failed to query latest data: {e}")
            return None
    
    def query_statistics(
        self,
        station_id: str,
        field: str,
        start_time: datetime,
        end_time: datetime
    ) -> Dict[str, Any]:
        """查询统计信息"""
        self.connect()
        
        try:
            # 验证站点ID和字段
            _validate_identifier(station_id)
            _validate_fields([field])
            sub_table = f"wq_{_safe_table_name(station_id)}"
            sql = f"""
                SELECT 
                    COUNT({field}) as count,
                    AVG({field}) as avg,
                    MIN({field}) as min,
                    MAX({field}) as max,
                    STDDEV({field}) as std
                FROM {sub_table}
                WHERE ts >= '{start_time.strftime('%Y-%m-%d %H:%M:%S')}'
                AND ts <= '{end_time.strftime('%Y-%m-%d %H:%M:%S')}'
            """
            
            result = self._conn.query(sql)
            
            if result and len(result) > 0:
                row = result[0]
                return {
                    "count": row[0],
                    "avg": row[1],
                    "min": row[2],
                    "max": row[3],
                    "std": row[4]
                }
            return {}
            
        except Exception as e:
            logger.error(f"Failed to query statistics: {e}")
            return {}
    
    def get_stations_with_data(self) -> List[str]:
        """获取有数据的站点列表"""
        self.connect()
        
        try:
            sql = "SELECT DISTINCT station_id FROM water_quality"
            result = self._conn.query(sql)
            return [row[0] for row in result]
        except Exception as e:
            logger.error(f"Failed to get stations: {e}")
            return []


# 全局客户端实例
_tdengine_client: Optional[TDengineClient] = None


def get_tdengine_client() -> TDengineClient:
    """获取TDengine客户端实例（单例）"""
    global _tdengine_client
    if _tdengine_client is None:
        _tdengine_client = TDengineClient()
    return _tdengine_client
