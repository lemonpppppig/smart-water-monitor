"""
MQTT连接管理API
"""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import paho.mqtt.client as mqtt
import threading
import time

from app.data.models.mqtt_connection import (
    MqttConnectionConfig,
    MqttConnectionCreate,
    MqttConnectionUpdate,
    MqttConnectionStore,
    ConnectionStatus,
    get_connection_store,
)
from app.data.core.ingestion import get_ingestion_service
from app.data.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mqtt", tags=["MQTT管理"])


@router.get("/connections")
async def get_connections():
    """获取所有MQTT连接配置"""
    store = get_connection_store()
    connections = store.get_all()
    return {"connections": [conn.model_dump() for conn in connections]}


@router.post("/connections")
async def create_connection(data: MqttConnectionCreate, session: AsyncSession = Depends(get_db)):
    """新增MQTT连接配置"""
    store = get_connection_store()
    conn = await store.create(data, session)
    return {"connection": conn.model_dump(), "message": "连接配置已创建"}


@router.get("/connections/by-station/{station_id}")
async def get_connections_by_station(station_id: str):
    """获取某站点绑定的MQTT连接"""
    store = get_connection_store()
    matched = store.get_by_station(station_id)
    return {"connections": [conn.model_dump() for conn in matched]}


@router.get("/connections/{conn_id}")
async def get_connection(conn_id: str):
    """获取单个连接配置"""
    store = get_connection_store()
    conn = store.get(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")
    return {"connection": conn.model_dump()}


@router.put("/connections/{conn_id}")
async def update_connection(conn_id: str, data: MqttConnectionUpdate, session: AsyncSession = Depends(get_db)):
    """更新连接配置"""
    store = get_connection_store()
    conn = await store.update(conn_id, data, session)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")
    return {"connection": conn.model_dump(), "message": "连接配置已更新"}


@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: str, session: AsyncSession = Depends(get_db)):
    """删除连接配置"""
    store = get_connection_store()
    # 先停止订阅
    ingestion = get_ingestion_service()
    ingestion.stop_external_subscriber(conn_id)
    # 删除配置
    success = await store.delete(conn_id, session)
    if not success:
        raise HTTPException(status_code=404, detail="连接配置不存在")
    return {"message": "连接配置已删除"}


@router.post("/connections/{conn_id}/test")
async def test_connection(conn_id: str):
    """测试MQTT连接"""
    store = get_connection_store()
    conn = store.get(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")

    # 尝试连接
    result = {"success": False, "message": ""}
    connected_event = threading.Event()

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            result["success"] = True
            result["message"] = "连接成功"
        else:
            result["message"] = f"连接失败，错误码: {rc}"
        connected_event.set()

    try:
        test_client = mqtt.Client(
            client_id=f"test_{conn.id}",
            protocol=mqtt.MQTTv311
        )
        if conn.username:
            test_client.username_pw_set(conn.username, conn.password)
        test_client.on_connect = on_connect
        test_client.connect(conn.broker_host, conn.broker_port, keepalive=10)
        test_client.loop_start()

        # 等待连接结果（最多5秒）
        connected_event.wait(timeout=5)
        if not connected_event.is_set():
            result["message"] = "连接超时"

        test_client.loop_stop()
        test_client.disconnect()
    except Exception as e:
        result["message"] = f"连接异常: {str(e)}"

    return result


@router.post("/connections/{conn_id}/start")
async def start_connection(conn_id: str):
    """启动MQTT订阅"""
    store = get_connection_store()
    conn = store.get(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")

    if conn.status == ConnectionStatus.CONNECTED:
        return {"message": "连接已在运行中"}

    ingestion = get_ingestion_service()
    try:
        ingestion.start_external_subscriber(conn)
        store.update_status(conn_id, ConnectionStatus.CONNECTED)
        return {"message": "订阅已启动"}
    except Exception as e:
        store.update_status(conn_id, ConnectionStatus.ERROR, str(e))
        raise HTTPException(status_code=500, detail=f"启动失败: {str(e)}")


@router.post("/connections/{conn_id}/stop")
async def stop_connection(conn_id: str):
    """停止MQTT订阅"""
    store = get_connection_store()
    conn = store.get(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")

    ingestion = get_ingestion_service()
    ingestion.stop_external_subscriber(conn_id)
    store.update_status(conn_id, ConnectionStatus.DISCONNECTED)
    return {"message": "订阅已停止"}


@router.get("/connections/{conn_id}/status")
async def get_connection_status(conn_id: str):
    """获取连接实时状态"""
    store = get_connection_store()
    conn = store.get(conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="连接配置不存在")

    ingestion = get_ingestion_service()
    stats = ingestion.get_subscriber_stats(conn_id)

    return {
        "id": conn.id,
        "status": conn.status,
        "last_active_at": conn.last_active_at,
        "error_message": conn.error_message,
        "statistics": stats,
    }


# ========= 数据查看API =========

@router.get("/data/latest")
async def get_latest_data(limit: int = 50):
    """获取最近接收到的原始消息"""
    ingestion = get_ingestion_service()
    messages = ingestion.get_recent_messages(limit)
    return {"messages": messages, "total": len(messages)}


@router.get("/data/history")
async def get_history_data(
    module_type: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = 100,
):
    """查询历史数据"""
    ingestion = get_ingestion_service()
    messages = ingestion.get_recent_messages(limit)

    # 按模块类型过滤
    if module_type:
        messages = [
            m for m in messages
            if module_type in m.get("module_types", [])
        ]

    return {"messages": messages, "total": len(messages)}


@router.get("/data/statistics")
async def get_data_statistics():
    """获取数据接收统计"""
    ingestion = get_ingestion_service()
    stats = ingestion.get_global_stats()
    return stats
