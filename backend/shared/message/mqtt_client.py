"""
MQTT消息队列封装（基于EMQX）
"""
from typing import Optional, Callable, Dict, Any, List
import json
import asyncio
import threading
import paho.mqtt.client as mqtt
import os
import logging

logger = logging.getLogger(__name__)

# MQTT配置
MQTT_BROKER_HOST = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))

# 预定义Topic（使用MQTT层级格式）
TOPICS = {
    "water/quality_data": "水质原始数据",
    "water/anomaly_detected": "异常检测结果",
    "water/analysis_task": "AI分析任务",
    "water/analysis_result": "分析结果",
    "water/alert_generated": "预警事件",
    "water/agent_state": "智能体状态",
    "water/agent_command": "智能体命令",
}


class MqttClient:
    """MQTT客户端管理"""
    
    def __init__(self, broker_host: str = MQTT_BROKER_HOST,
                 broker_port: int = MQTT_BROKER_PORT,
                 client_id: str = None):
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.client_id = client_id or f"water_client_{id(self)}"
        self._client: Optional[mqtt.Client] = None
    
    def get_client(self) -> mqtt.Client:
        """获取MQTT客户端"""
        if self._client is None:
            self._client = mqtt.Client(
                client_id=self.client_id,
                protocol=mqtt.MQTTv311
            )
        return self._client
    
    def connect(self):
        """建立连接"""
        client = self.get_client()
        client.connect(self.broker_host, self.broker_port, keepalive=60)
        logger.info(f"Connected to MQTT broker at {self.broker_host}:{self.broker_port}")
    
    def disconnect(self):
        """断开连接"""
        if self._client:
            self._client.disconnect()
            self._client = None
            logger.info("Disconnected from MQTT broker")


class MqttPublisher:
    """MQTT发布者封装"""
    
    def __init__(self, broker_host: str = MQTT_BROKER_HOST,
                 broker_port: int = MQTT_BROKER_PORT,
                 client_id: str = None):
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.client_id = client_id or f"water_pub_{id(self)}"
        self._client: Optional[mqtt.Client] = None
    
    def connect(self):
        """建立连接"""
        if self._client is None:
            self._client = mqtt.Client(
                client_id=self.client_id,
                protocol=mqtt.MQTTv311
            )
            self._client.connect(self.broker_host, self.broker_port, keepalive=60)
            self._client.loop_start()
            logger.info(f"MQTT publisher connected to {self.broker_host}:{self.broker_port}")
    
    def close(self):
        """关闭连接"""
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._client = None
    
    def send(self, topic: str, value: Dict[str, Any], qos: int = 1):
        """发送消息"""
        self.connect()
        payload = json.dumps(value, default=str).encode('utf-8')
        result = self._client.publish(topic, payload, qos=qos)
        return result
    
    def send_async(self, topic: str, value: Dict[str, Any],
                   callback: Callable = None, qos: int = 1):
        """异步发送消息"""
        self.connect()
        payload = json.dumps(value, default=str).encode('utf-8')
        result = self._client.publish(topic, payload, qos=qos)
        if callback:
            callback(result)
    
    def flush(self):
        """兼容接口（MQTT无需flush）"""
        pass
    
    # 业务方法
    def send_water_quality_data(self, data: Dict[str, Any]):
        """发送水质数据"""
        return self.send("water/quality_data", data)
    
    def send_anomaly_detected(self, alert_data: Dict[str, Any]):
        """发送异常检测事件"""
        return self.send("water/anomaly_detected", alert_data)
    
    def send_analysis_task(self, task: Dict[str, Any]):
        """发送分析任务"""
        return self.send("water/analysis_task", task)
    
    def send_alert_generated(self, alert: Dict[str, Any]):
        """发送预警事件"""
        return self.send("water/alert_generated", alert)
    
    def send_agent_state(self, agent_state: Dict[str, Any]):
        """发送Agent状态"""
        return self.send("water/agent_state", agent_state)


class MqttSubscriber:
    """MQTT订阅者封装"""
    
    def __init__(self, topics: List[str], client_id: str = None,
                 broker_host: str = MQTT_BROKER_HOST,
                 broker_port: int = MQTT_BROKER_PORT,
                 qos: int = 1):
        self.topics = topics
        self.client_id = client_id or f"water_sub_{id(self)}"
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.qos = qos
        self._client: Optional[mqtt.Client] = None
        self._running = False
        self._handler: Optional[Callable] = None
    
    def connect(self):
        """建立连接"""
        if self._client is None:
            self._client = mqtt.Client(
                client_id=self.client_id,
                protocol=mqtt.MQTTv311
            )
            self._client.on_message = self._on_message
            self._client.on_connect = self._on_connect
            self._client.connect(self.broker_host, self.broker_port, keepalive=60)
    
    def _on_connect(self, client, userdata, flags, rc):
        """连接成功回调，订阅Topic"""
        if rc == 0:
            for topic in self.topics:
                client.subscribe(topic, qos=self.qos)
                logger.info(f"Subscribed to topic: {topic}")
        else:
            logger.error(f"MQTT connection failed with code: {rc}")
    
    def _on_message(self, client, userdata, msg):
        """消息接收回调"""
        if self._handler:
            try:
                payload = json.loads(msg.payload.decode('utf-8'))
                self._handler(payload)
            except Exception as e:
                logger.error(f"Error processing MQTT message: {e}")
    
    def close(self):
        """关闭连接"""
        self._running = False
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._client = None
    
    def consume(self, handler: Callable[[Dict[str, Any]], None]):
        """同步消费消息（阻塞）"""
        self.connect()
        self._handler = handler
        self._running = True
        
        try:
            self._client.loop_forever()
        except KeyboardInterrupt:
            pass
        finally:
            self.close()
    
    async def consume_async(self, handler: Callable[[Dict[str, Any]], None]):
        """异步消费消息（非阻塞，在后台线程运行MQTT loop）"""
        self.connect()
        self._handler = handler
        self._running = True
        self._client.loop_start()
        
        try:
            while self._running:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            self.close()
    
    def start(self, handler: Callable[[Dict[str, Any]], None]):
        """启动后台消费（非阻塞）"""
        self.connect()
        self._handler = handler
        self._running = True
        self._client.loop_start()
        logger.info(f"MQTT subscriber started for topics: {self.topics}")
    
    def stop(self):
        """停止消费"""
        self._running = False
        self.close()
