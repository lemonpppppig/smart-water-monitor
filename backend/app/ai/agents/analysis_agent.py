"""
分析预测 Agent
负责风险预测、溯源分析
"""
import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from app.ai.engines.time_series import TimeSeriesEngine
from app.ai.engines.graph import GraphEngine

logger = logging.getLogger(__name__)


class AnalysisAgent:
    """分析预测Agent"""
    
    def __init__(self, coordinator):
        self.name = "analysis_agent"
        self.coordinator = coordinator
        self.time_series_engine = TimeSeriesEngine()
        self.graph_engine = GraphEngine()
        self._running = False
    
    async def start(self):
        """启动Agent"""
        self._running = True
        self.coordinator.register_agent(
            self.name,
            "analysis",
            ["risk_prediction", "source_tracing"]
        )
        
        logger.info("AnalysisAgent started")
        
        # 启动任务处理循环
        while self._running:
            try:
                await self._process_tasks()
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Task processing error: {e}")
    
    async def _process_tasks(self):
        """处理任务"""
        # 获取下一个任务
        task = self.coordinator.get_next_task(["risk_prediction", "source_tracing"])
        
        if task is None:
            return
        
        # 分配任务给自己
        if not self.coordinator.assign_task(task.task_id, self.name):
            return
        
        self.coordinator.update_agent_state(self.name, "busy", task.task_id)
        
        try:
            # 根据任务类型执行
            if task.task_type == "risk_prediction":
                result = await self._predict_risk(task.payload)
            elif task.task_type == "source_tracing":
                result = await self._trace_source(task.payload)
            elif task.task_type == "anomaly_analysis":
                result = await self._analyze_anomaly(task.payload)
            else:
                result = {"error": "Unknown task type"}
            
            # 完成任务
            self.coordinator.complete_task(task.task_id, result)
            
        except Exception as e:
            logger.error(f"Task {task.task_id} failed: {e}")
            self.coordinator.complete_task(task.task_id, {"error": str(e)})
        
        self.coordinator.update_agent_state(self.name, "online")
    
    async def _predict_risk(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """预测风险"""
        station_id = payload.get("station_id")
        metric = payload.get("metric", "ph")
        hours = payload.get("hours", 72)
        
        # 使用Prophet进行预测
        # 简化实现，实际需要获取历史数据
        prediction = self.time_series_engine.predict(station_id, metric, hours)
        
        # 分析风险
        risk_level = "low"
        risk_probability = 0.0
        
        if "predictions" in prediction:
            # 检查是否有超标风险
            for pred in prediction["predictions"]:
                value = pred.get("value", 0)
                # 简化判断
                if metric == "ph" and (value < 6.0 or value > 9.0):
                    risk_level = "high"
                    risk_probability = 0.8
                    break
        
        return {
            "analysis_type": "risk_prediction",
            "station_id": station_id,
            "metric": metric,
            "risk_level": risk_level,
            "risk_probability": risk_probability,
            "prediction": prediction,
            "timestamp": datetime.now().isoformat()
        }
    
    async def _trace_source(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """溯源分析"""
        station_id = payload.get("station_id")
        detection_time = payload.get("detection_time", datetime.now())
        
        if isinstance(detection_time, str):
            detection_time = datetime.fromisoformat(detection_time)
        
        # 使用图引擎进行溯源
        result = self.graph_engine.trace_pollution_source(
            station_id, detection_time
        )
        
        # 分析扩散趋势
        spread = self.graph_engine.analyze_spread(
            station_id, detection_time, forecast_hours=24
        )
        
        return {
            "analysis_type": "source_tracing",
            "station_id": station_id,
            "source_analysis": result,
            "spread_analysis": spread,
            "timestamp": datetime.now().isoformat()
        }
    
    async def _analyze_anomaly(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """分析异常"""
        station_id = payload.get("station_id")
        anomalies = payload.get("anomalies", [])
        data = payload.get("data", {})
        
        # 提交决策任务
        self.coordinator.submit_task(
            "decision_support",
            {
                "station_id": station_id,
                "anomalies": anomalies,
                "data": data,
                "requires_decision": True
            },
            priority=9
        )
        
        return {
            "analysis_type": "anomaly_analysis",
            "station_id": station_id,
            "anomalies_count": len(anomalies),
            "status": "submitted_for_decision",
            "timestamp": datetime.now().isoformat()
        }
    
    def stop(self):
        """停止Agent"""
        self._running = False
        self.graph_engine.close()
        self.coordinator.update_agent_state(self.name, "offline")
        logger.info("AnalysisAgent stopped")
