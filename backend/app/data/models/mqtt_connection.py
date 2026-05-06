"""
MQTT连接配置模型 + 数据库存储
"""
import logging
from typing import Optional, Dict, List
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum
import uuid

from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.models.db_models import MqttConnectionORM

logger = logging.getLogger(__name__)


class ConnectionStatus(str, Enum):
    """连接状态"""
    DISCONNECTED = "disconnected"
    CONNECTED = "connected"
    CONNECTING = "connecting"
    ERROR = "error"


class MqttConnectionConfig(BaseModel):
    """MQTT连接配置（Pydantic 视图模型）"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = Field(default="", description="连接名称")
    broker_host: str = Field(..., description="Broker地址")
    broker_port: int = Field(default=1883, description="Broker端口")
    topic: str = Field(..., description="订阅主题")
    module_keys: List[str] = Field(default_factory=list, description="绑定的模块 key 列表")
    username: Optional[str] = Field(default=None, description="用户名")
    password: Optional[str] = Field(default=None, description="密码")
    client_id: Optional[str] = Field(default=None, description="客户端ID")
    qos: int = Field(default=1, description="QoS等级")
    station_id: Optional[str] = Field(default=None, description="绑定站点ID")
    station_name: Optional[str] = Field(default=None, description="绑定站点名称")
    status: ConnectionStatus = Field(default=ConnectionStatus.DISCONNECTED)
    created_at: datetime = Field(default_factory=datetime.now)
    last_active_at: Optional[datetime] = None
    error_message: Optional[str] = None


class MqttConnectionCreate(BaseModel):
    """创建连接请求"""
    name: str = Field(default="", description="连接名称")
    broker_host: str
    broker_port: int = 1883
    topic: str
    module_keys: List[str] = Field(default_factory=list)
    username: Optional[str] = None
    password: Optional[str] = None
    client_id: Optional[str] = None
    qos: int = 1
    station_id: Optional[str] = None
    station_name: Optional[str] = None


class MqttConnectionUpdate(BaseModel):
    """更新连接请求"""
    name: Optional[str] = None
    broker_host: Optional[str] = None
    broker_port: Optional[int] = None
    topic: Optional[str] = None
    module_keys: Optional[List[str]] = None
    username: Optional[str] = None
    password: Optional[str] = None
    client_id: Optional[str] = None
    qos: Optional[int] = None
    station_id: Optional[str] = None
    station_name: Optional[str] = None


def _orm_to_pydantic(row: MqttConnectionORM) -> MqttConnectionConfig:
    """将 ORM 对象转为 Pydantic 模型"""
    raw_keys = getattr(row, "module_keys", None) or ""
    module_keys = [k.strip() for k in raw_keys.split(",") if k.strip()] if raw_keys else []
    return MqttConnectionConfig(
        id=row.id,
        name=row.name or "",
        broker_host=row.broker_host,
        broker_port=row.broker_port,
        topic=row.topic,
        module_keys=module_keys,
        username=row.username,
        password=row.password,
        client_id=row.client_id,
        qos=row.qos,
        station_id=row.station_id,
        station_name=row.station_name,
        status=row.status or ConnectionStatus.DISCONNECTED,
        created_at=row.created_at or datetime.now(),
        last_active_at=row.last_active_at,
        error_message=row.error_message,
    )


class MqttConnectionStore:
    """MQTT连接配置存储（PostgreSQL 数据库）

    注意：运行时状态（status / error_message / last_active_at）
    同时维护在内存缓存中，以便同步代码快速访问。
    配置变更（create/update/delete）写入数据库持久化。
    """

    def __init__(self):
        # 内存缓存，启动时从 DB 加载
        self._cache: Dict[str, MqttConnectionConfig] = {}
        self._loaded = False

    # ---- 初始化（由 lifespan 调用） ----

    async def load_from_db(self, session: AsyncSession):
        """从数据库加载所有连接配置到内存缓存"""
        result = await session.execute(select(MqttConnectionORM))
        rows = result.scalars().all()
        self._cache.clear()
        for row in rows:
            conn = _orm_to_pydantic(row)
            # 重启后状态重置
            conn.status = ConnectionStatus.DISCONNECTED
            conn.error_message = None
            self._cache[conn.id] = conn
        self._loaded = True
        logger.info("已从数据库加载 %d 条 MQTT 连接配置", len(self._cache))

    # ---- 读操作（从缓存） ----

    def get_all(self) -> List[MqttConnectionConfig]:
        return list(self._cache.values())

    def get(self, conn_id: str) -> Optional[MqttConnectionConfig]:
        return self._cache.get(conn_id)

    def get_by_station(self, station_id: str) -> List[MqttConnectionConfig]:
        return [c for c in self._cache.values() if c.station_id == station_id]

    # ---- 写操作（写 DB + 更新缓存） ----

    async def create(self, config: MqttConnectionCreate, session: AsyncSession) -> MqttConnectionConfig:
        conn_id = str(uuid.uuid4())[:8]
        orm_obj = MqttConnectionORM(
            id=conn_id,
            name=config.name,
            broker_host=config.broker_host,
            broker_port=config.broker_port,
            topic=config.topic,
            module_keys=",".join(config.module_keys) if config.module_keys else "",
            username=config.username,
            password=config.password,
            client_id=config.client_id,
            qos=config.qos,
            station_id=config.station_id,
            station_name=config.station_name,
            status=ConnectionStatus.DISCONNECTED,
        )
        session.add(orm_obj)
        await session.flush()  # 获取默认值

        conn = _orm_to_pydantic(orm_obj)
        self._cache[conn.id] = conn
        return conn

    async def update(self, conn_id: str, data: MqttConnectionUpdate, session: AsyncSession) -> Optional[MqttConnectionConfig]:
        update_data = data.model_dump(exclude_unset=True)
        if not update_data:
            return self._cache.get(conn_id)

        # module_keys 列表 -> 逗号字符串
        if "module_keys" in update_data and isinstance(update_data["module_keys"], list):
            update_data["module_keys"] = ",".join(update_data["module_keys"])

        result = await session.execute(
            select(MqttConnectionORM).where(MqttConnectionORM.id == conn_id)
        )
        orm_obj = result.scalar_one_or_none()
        if not orm_obj:
            return None

        for key, value in update_data.items():
            setattr(orm_obj, key, value)
        await session.flush()

        conn = _orm_to_pydantic(orm_obj)
        # 保留运行时状态
        cached = self._cache.get(conn_id)
        if cached:
            conn.status = cached.status
            conn.error_message = cached.error_message
            conn.last_active_at = cached.last_active_at
        self._cache[conn_id] = conn
        return conn

    async def delete(self, conn_id: str, session: AsyncSession) -> bool:
        result = await session.execute(
            delete(MqttConnectionORM).where(MqttConnectionORM.id == conn_id)
        )
        if result.rowcount > 0:
            self._cache.pop(conn_id, None)
            return True
        return False

    # ---- 运行时状态更新（仅内存，不写 DB） ----

    def update_status(self, conn_id: str, status: ConnectionStatus, error_message: str = None):
        conn = self._cache.get(conn_id)
        if conn:
            conn.status = status
            conn.error_message = error_message
            if status == ConnectionStatus.CONNECTED:
                conn.last_active_at = datetime.now()


# 全局存储实例
_connection_store: Optional[MqttConnectionStore] = None


def get_connection_store() -> MqttConnectionStore:
    """获取连接存储单例"""
    global _connection_store
    if _connection_store is None:
        _connection_store = MqttConnectionStore()
    return _connection_store
