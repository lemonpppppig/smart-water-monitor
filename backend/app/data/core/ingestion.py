"""
数据接入服务
- MQTT数据订阅
- HJ212协议解析
- 模块化传感器数据解析
- 数据入库
"""
import json
import logging
import threading
from collections import deque
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
import paho.mqtt.client as mqtt
import asyncio

from app.data.config import settings
from app.data.db.tdengine import get_tdengine_client
from app.data.core.processor import DataProcessor
from app.data.core.sensor_parser import SensorDataParser

logger = logging.getLogger(__name__)


class HJ212Parser:
    """HJ212环保协议解析器"""
    
    # HJ212字段映射到系统字段
    FIELD_MAPPING = {
        "w01001": "ph",           # pH值
        "w01006": "nh3_n",        # 氨氮
        "w01009": "do",           # 溶解氧
        "w01010": "codmn",        # 高锰酸盐指数
        "w01003": "turbidity",    # 浊度
        "w01014": "conductivity", # 电导率
        "w19011": "chlorophyll",  # 叶绿素
        "w19012": "blue_green_algae",  # 蓝绿藻
        "w20111": "total_n",      # 总氮
        "w20113": "total_p",      # 总磷
        "w01018": "codcr",        # 化学需氧量
    }
    
    @classmethod
    def parse(cls, data: str) -> Optional[Dict[str, Any]]:
        """解析HJ212格式的数据包"""
        try:
            # HJ212数据包格式解析（简化版）
            # 实际实现需要完整解析HJ212协议
            result = {
                "station_id": "",
                "ts": datetime.now(),
                "raw_data": data
            }
            
            # 尝试JSON解析
            try:
                json_data = json.loads(data)
                result["station_id"] = json_data.get("MN", "")
                
                # 解析数据时间
                data_time = json_data.get("DataTime", "")
                if data_time:
                    result["ts"] = datetime.strptime(data_time, "%Y%m%d%H%M%S")
                
                # 解析监测数据
                cp_data = json_data.get("CP", {})
                for hj_code, value in cp_data.items():
                    field_name = cls.FIELD_MAPPING.get(hj_code)
                    if field_name:
                        try:
                            result[field_name] = float(value)
                        except (ValueError, TypeError):
                            pass
                
                return result
                
            except json.JSONDecodeError:
                # 非JSON格式，可能是原始HJ212格式
                # 这里简化处理，实际需要完整实现HJ212协议解析
                logger.warning(f"Non-JSON HJ212 data: {data[:100]}")
                return result
                
        except Exception as e:
            logger.error(f"Failed to parse HJ212 data: {e}")
            return None


class DataIngestionService:
    """数据接入服务"""
    
    # 环形缓冲区大小
    MESSAGE_BUFFER_SIZE = 500
    
    def __init__(self):
        self.processor = DataProcessor()
        self.tdengine = get_tdengine_client()
        self._mqtt_client: Optional[mqtt.Client] = None
        self._running = False
        self._callback: Optional[Callable] = None
        # 外部MQTT订阅者管理
        self._external_subscribers: Dict[str, mqtt.Client] = {}
        # 消息环形缓冲区
        self._message_buffer: deque = deque(maxlen=self.MESSAGE_BUFFER_SIZE)
        self._buffer_lock = threading.Lock()
        # 统计信息
        self._stats = {
            "total_messages": 0,
            "total_water_quality_records": 0,
            "total_environment_records": 0,
            "last_receive_time": None,
            "errors": 0,
        }
        self._subscriber_stats: Dict[str, Dict] = {}
    
    def set_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """设置数据接收回调"""
        self._callback = callback
    
    def start_mqtt_subscriber(self, topics: list = None, client_id: str = None):
        """启动MQTT订阅者"""
        if topics is None:
            topics = ["water/quality_data"]
        
        if client_id is None:
            client_id = settings.MQTT_CLIENT_ID
        
        try:
            self._mqtt_client = mqtt.Client(
                client_id=client_id,
                protocol=mqtt.MQTTv311
            )
            self._mqtt_client.on_connect = self._on_connect
            self._mqtt_client.on_message = self._on_message
            self._subscribe_topics = topics
            
            self._mqtt_client.connect(
                settings.MQTT_BROKER_HOST,
                settings.MQTT_BROKER_PORT,
                keepalive=60
            )
            
            self._running = True
            self._mqtt_client.loop_start()
            logger.info(f"MQTT subscriber started for topics: {topics}")
            
        except Exception as e:
            logger.error(f"Failed to start MQTT subscriber: {e}")
    
    def _on_connect(self, client, userdata, flags, rc):
        """连接成功回调，订阅Topic"""
        if rc == 0:
            for topic in self._subscribe_topics:
                client.subscribe(topic, qos=1)
                logger.info(f"Subscribed to topic: {topic}")
        else:
            logger.error(f"MQTT connection failed with code: {rc}")
    
    def _on_message(self, client, userdata, msg):
        """消息接收回调"""
        try:
            message = json.loads(msg.payload.decode('utf-8'))
            logger.info(f"[FLOW] mqtt_received: topic={msg.topic}, payload_size={len(msg.payload)} bytes")
            self.process_message(message)
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")
    
    def process_message(self, message: Dict[str, Any]):
        """处理单条消息"""
        # 解析数据（如果是HJ212格式）
        if isinstance(message.get("data"), str):
            parsed = HJ212Parser.parse(message["data"])
            if parsed:
                message.update(parsed)
        
        # 数据预处理
        processed_data, errors = self.processor.process_data_point(message)
        
        if errors:
            logger.warning(f"Data validation errors: {errors}")
        
        # 存储到TDengine
        if processed_data.get("station_id"):
            success = self.tdengine.insert_water_quality(processed_data)
            if success:
                logger.info(f"[FLOW] water_quality_to_tdengine: station={processed_data['station_id']}, pH={processed_data.get('ph')}, DO={processed_data.get('do')}")
            else:
                logger.error(f"Failed to store data for station {processed_data['station_id']}")
        
        # 调用回调
        if self._callback:
            self._callback(processed_data)
    
    def stop(self):
        """停止服务"""
        self._running = False
        if self._mqtt_client:
            self._mqtt_client.loop_stop()
            self._mqtt_client.disconnect()
            self._mqtt_client = None
            logger.info("MQTT subscriber stopped")
        # 停止所有外部订阅者
        for conn_id in list(self._external_subscribers.keys()):
            self.stop_external_subscriber(conn_id)
    
    # ========= 外部MQTT订阅管理 =========
    
    def start_external_subscriber(self, conn_config):
        """启动外部MQTT订阅者"""
        conn_id = conn_config.id
        
        if conn_id in self._external_subscribers:
            logger.warning(f"Subscriber {conn_id} already running, stopping first")
            self.stop_external_subscriber(conn_id)
        
        try:
            client_id = conn_config.client_id or f"water_ext_{conn_id}"
            client = mqtt.Client(
                client_id=client_id,
                protocol=mqtt.MQTTv311
            )
            
            # 设置认证
            if conn_config.username:
                client.username_pw_set(conn_config.username, conn_config.password)
            
            # 回调闭包，携带conn_id信息
            topic = conn_config.topic
            qos = conn_config.qos
            
            def on_connect(c, userdata, flags, rc):
                if rc == 0:
                    c.subscribe(topic, qos=qos)
                    logger.info(f"External subscriber [{conn_id}] connected, subscribed to: {topic}")
                else:
                    logger.error(f"External subscriber [{conn_id}] connection failed: rc={rc}")
            
            def on_message(c, userdata, msg):
                self._handle_external_message(conn_id, msg, conn_config)
            
            def on_disconnect(c, userdata, rc):
                if rc != 0:
                    logger.warning(f"External subscriber [{conn_id}] unexpected disconnect: rc={rc}")
            
            client.on_connect = on_connect
            client.on_message = on_message
            client.on_disconnect = on_disconnect
            
            client.connect(conn_config.broker_host, conn_config.broker_port, keepalive=60)
            client.loop_start()
            
            self._external_subscribers[conn_id] = client
            self._subscriber_stats[conn_id] = {
                "messages_received": 0,
                "last_message_time": None,
                "errors": 0,
            }
            
            logger.info(f"External subscriber [{conn_id}] started: {conn_config.broker_host}:{conn_config.broker_port}")
            
        except Exception as e:
            logger.error(f"Failed to start external subscriber [{conn_id}]: {e}")
            raise
    
    def stop_external_subscriber(self, conn_id: str):
        """停止外部MQTT订阅者"""
        client = self._external_subscribers.pop(conn_id, None)
        if client:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception as e:
                logger.error(f"Error stopping external subscriber [{conn_id}]: {e}")
            logger.info(f"External subscriber [{conn_id}] stopped")
    
    def _handle_external_message(self, conn_id: str, msg, conn_config=None):
        """处理外部MQTT消息"""
        try:
            payload = msg.payload.decode('utf-8')
            raw_message = json.loads(payload)
            receive_time = datetime.now()
            
            # 更新统计
            self._stats["total_messages"] += 1
            self._stats["last_receive_time"] = receive_time.isoformat()
            if conn_id in self._subscriber_stats:
                self._subscriber_stats[conn_id]["messages_received"] += 1
                self._subscriber_stats[conn_id]["last_message_time"] = receive_time.isoformat()
            
            # 使用模块化解析器
            station_id = (conn_config.station_id if conn_config and hasattr(conn_config, 'station_id') and conn_config.station_id else conn_id)
            parsed = SensorDataParser.parse(raw_message, station_id, receive_time)
            
            # 存入环形缓冲区
            buffer_entry = {
                "conn_id": conn_id,
                "station_id": station_id,
                "receive_time": receive_time.isoformat(),
                "topic": msg.topic,
                "module_types": parsed["module_types"],
                "raw": raw_message,
                "water_quality_count": len(parsed["water_quality"]),
                "environment_count": len(parsed["environment"]),
            }
            with self._buffer_lock:
                self._message_buffer.append(buffer_entry)
            
            # 存储水质数据
            for record in parsed["water_quality"]:
                self.tdengine.insert_water_quality(record)
                self._stats["total_water_quality_records"] += 1
            
            # 存储环境数据
            for record in parsed["environment"]:
                self.tdengine.insert_environment_data(record)
                self._stats["total_environment_records"] += 1
            
            logger.info(f"[FLOW] external_mqtt_received: conn=[{conn_id}], station={station_id}, modules={parsed['module_types']}, wq={len(parsed['water_quality'])}, env={len(parsed['environment'])}")
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error from [{conn_id}]: {e}")
            self._stats["errors"] += 1
        except Exception as e:
            logger.error(f"Error processing external message from [{conn_id}]: {e}")
            self._stats["errors"] += 1
    
    def get_recent_messages(self, limit: int = 50) -> List[Dict[str, Any]]:
        """获取最近的消息"""
        with self._buffer_lock:
            messages = list(self._message_buffer)
        # 最新的在前面
        messages.reverse()
        return messages[:limit]
    
    def get_subscriber_stats(self, conn_id: str) -> Dict[str, Any]:
        """获取指定订阅者的统计信息"""
        return self._subscriber_stats.get(conn_id, {})
    
    def get_global_stats(self) -> Dict[str, Any]:
        """获取全局统计信息"""
        return {
            **self._stats,
            "buffer_size": len(self._message_buffer),
            "active_subscribers": len(self._external_subscribers),
        }
    
    def ingest_data(self, data: Dict[str, Any]) -> bool:
        """直接接入单条数据"""
        try:
            # 预处理
            processed_data, errors = self.processor.process_data_point(data)
            
            if errors:
                logger.warning(f"Data validation errors: {errors}")
            
            # 存储
            success = self.tdengine.insert_water_quality(processed_data)
            return success
            
        except Exception as e:
            logger.error(f"Data ingestion failed: {e}")
            return False
    
    def ingest_batch(self, data_list: list) -> tuple:
        """批量接入数据"""
        success_count = 0
        failed_count = 0
        
        for data in data_list:
            if self.ingest_data(data):
                success_count += 1
            else:
                failed_count += 1
        
        return success_count, failed_count


# 全局服务实例
_ingestion_service: Optional[DataIngestionService] = None


def get_ingestion_service() -> DataIngestionService:
    """获取数据接入服务实例（单例）"""
    global _ingestion_service
    if _ingestion_service is None:
        _ingestion_service = DataIngestionService()
    return _ingestion_service
