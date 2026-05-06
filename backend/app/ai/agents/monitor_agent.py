"""
监测诊断 Agent
负责实时数据监测、异常检测、污染识别
"""
import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from app.ai.engines.time_series import TimeSeriesEngine
from app.ai.engines.knowledge import KnowledgeEngine

logger = logging.getLogger(__name__)


class MonitorAgent:
    """监测诊断Agent"""
    
    def __init__(self, coordinator):
        self.name = "monitor_agent"
        self.coordinator = coordinator
        self.time_series_engine = TimeSeriesEngine()
        # KnowledgeEngine 需要 neo4j_client 与 pg_pool，这里延迟从共享单例获取
        self.knowledge_engine: KnowledgeEngine | None = None
        self._running = False
        self.monitoring_stations = set()

    async def _get_knowledge_engine(self) -> KnowledgeEngine:
        """复用 api/ai.py 中的 KnowledgeEngine 单例（首次访问时初始化）"""
        if self.knowledge_engine is None:
            from app.ai.api.ai import get_knowledge_engine
            self.knowledge_engine = await get_knowledge_engine()
        return self.knowledge_engine
    
    async def start(self):
        """启动监测"""
        self._running = True
        self.coordinator.register_agent(
            self.name,
            "monitor",
            ["anomaly_detection", "pollution_identification"]
        )
        
        logger.info("MonitorAgent started")
        
        # 启动监测循环
        while self._running:
            try:
                await self._monitoring_cycle()
                await asyncio.sleep(60)  # 每分钟检查一次
            except Exception as e:
                logger.error(f"Monitoring cycle error: {e}")
    
    async def _monitoring_cycle(self):
        """监测周期"""
        for station_id in self.monitoring_stations:
            try:
                # 1. 获取最新数据
                # TODO: 从数据服务获取
                
                # 2. 异常检测
                await self._detect_anomaly(station_id)
                
                # 3. 更新Agent状态
                self.coordinator.update_agent_state(self.name, "online")
                
            except Exception as e:
                logger.error(f"Error monitoring station {station_id}: {e}")
    
    async def _detect_anomaly(self, station_id: str, data: Dict[str, float] = None):
        """检测异常"""
        if data is None:
            return
        
        # 对关键指标进行异常检测
        metrics = ["ph", "do", "nh3_n", "codmn"]
        anomalies = []
        
        for metric in metrics:
            if metric not in data:
                continue
            
            # 使用LSTM检测异常
            # 简化实现，实际需要历史数据
            if data[metric] is not None:
                # 简单的阈值检查（实际应使用模型）
                is_anomaly = self._simple_threshold_check(metric, data[metric])
                
                if is_anomaly:
                    anomalies.append({
                        "metric": metric,
                        "value": data[metric],
                        "type": "threshold"
                    })
        
        if anomalies:
            # 提交分析任务
            self.coordinator.submit_task(
                "anomaly_analysis",
                {
                    "station_id": station_id,
                    "anomalies": anomalies,
                    "data": data
                },
                priority=8
            )
            
            logger.info(f"Anomaly detected at station {station_id}: {anomalies}")
    
    def _simple_threshold_check(self, metric: str, value: float) -> bool:
        """简单阈值检查"""
        thresholds = {
            "ph": {"min": 6.0, "max": 9.0},
            "do": {"min": 2.0, "max": 20.0},
            "nh3_n": {"min": 0, "max": 5.0},
            "codmn": {"min": 0, "max": 15.0}
        }
        
        if metric not in thresholds:
            return False
        
        threshold = thresholds[metric]
        return value < threshold["min"] or value > threshold["max"]
    
    async def analyze_data(self, station_id: str, data: Dict[str, float]) -> Dict[str, Any]:
        """分析数据"""
        engine = await self._get_knowledge_engine()
        # 1. 污染类型识别
        pollution_result = await engine.identify_pollution_type(data)
        
        # 2. 案例推理
        similar_cases = await engine.case_based_reasoning(data)
        
        return {
            "station_id": station_id,
            "timestamp": datetime.now().isoformat(),
            "pollution_identification": pollution_result,
            "similar_cases": similar_cases
        }
    
    def add_station(self, station_id: str):
        """添加监测站点"""
        self.monitoring_stations.add(station_id)
        logger.info(f"Added station {station_id} to monitoring")
    
    def remove_station(self, station_id: str):
        """移除监测站点"""
        self.monitoring_stations.discard(station_id)
        logger.info(f"Removed station {station_id} from monitoring")
    
    def stop(self):
        """停止监测"""
        self._running = False
        self.coordinator.update_agent_state(self.name, "offline")
        logger.info("MonitorAgent stopped")
