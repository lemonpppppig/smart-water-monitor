"""
决策建议 Agent
负责生成处置建议、决策支持
"""
import asyncio
import logging
from typing import Dict, Any, List
from datetime import datetime

from app.ai.engines.knowledge import KnowledgeEngine
from app.ai.agents.alert_levels import calculate_alert_level

logger = logging.getLogger(__name__)


class DecisionAgent:
    """决策建议Agent"""
    
    def __init__(self, coordinator):
        self.name = "decision_agent"
        self.coordinator = coordinator
        # KnowledgeEngine 需要 neo4j_client 与 pg_pool，这里延迟从共享单例获取
        self.knowledge_engine: KnowledgeEngine | None = None
        self._running = False

    async def _get_knowledge_engine(self) -> KnowledgeEngine:
        """复用 api/ai.py 中的 KnowledgeEngine 单例（首次访问时初始化）"""
        if self.knowledge_engine is None:
            from app.ai.api.ai import get_knowledge_engine
            self.knowledge_engine = await get_knowledge_engine()
        return self.knowledge_engine
    
    async def start(self):
        """启动Agent"""
        self._running = True
        self.coordinator.register_agent(
            self.name,
            "decision",
            ["decision_support", "emergency_response"]
        )
        
        logger.info("DecisionAgent started")
        
        # 启动任务处理循环
        while self._running:
            try:
                await self._process_tasks()
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Task processing error: {e}")
    
    async def _process_tasks(self):
        """处理任务"""
        # 获取决策任务
        task = self.coordinator.get_next_task(["decision_support"])
        
        if task is None:
            return
        
        # 分配任务
        if not self.coordinator.assign_task(task.task_id, self.name):
            return
        
        self.coordinator.update_agent_state(self.name, "busy", task.task_id)
        
        try:
            if task.task_type == "decision_support":
                result = await self._generate_decision(task.payload)
            else:
                result = {"error": "Unknown task type"}
            
            # 完成任务
            self.coordinator.complete_task(task.task_id, result)
            
        except Exception as e:
            logger.error(f"Task {task.task_id} failed: {e}")
            self.coordinator.complete_task(task.task_id, {"error": str(e)})
        
        self.coordinator.update_agent_state(self.name, "online")
    
    async def _generate_decision(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """生成决策建议"""
        station_id = payload.get("station_id")
        data = payload.get("data", {})
        anomalies = payload.get("anomalies", [])
        
        engine = await self._get_knowledge_engine()
        # 1. 识别污染类型
        pollution_result = await engine.identify_pollution_type(data)
        pollution_type = pollution_result.get("pollution_type", "unknown")
        
        # 2. 获取应急处置预案
        emergency_plan = await engine.get_emergency_plan(pollution_type)
        
        # 3. 生成决策报告
        decision_report = {
            "station_id": station_id,
            "timestamp": datetime.now().isoformat(),
            "situation_assessment": {
                "pollution_type": pollution_type,
                "pollution_name": pollution_result.get("pollution_name"),
                "confidence": pollution_result.get("confidence"),
                "anomalies": anomalies
            },
            "recommended_actions": emergency_plan["actions"],
            "responsible_departments": emergency_plan["departments"],
            "priority": self._calculate_priority(anomalies, pollution_result),
            "timeline": self._generate_timeline(emergency_plan["actions"])
        }
        
        logger.info(f"Decision report generated for station {station_id}")
        
        return {
            "analysis_type": "decision_support",
            "station_id": station_id,
            "decision_report": decision_report,
            "timestamp": datetime.now().isoformat()
        }
    
    def _calculate_priority(self, anomalies: List[Dict], 
                           pollution_result: Dict) -> str:
        """计算优先级"""
        # 使用统一分级策略
        return calculate_alert_level(len(anomalies), pollution_result.get("confidence", 0))
    
    def _generate_timeline(self, actions: List[str]) -> List[Dict]:
        """生成处置时间线"""
        timeline = []
        base_time = datetime.now()
        
        # 紧急措施（0-1小时）
        timeline.append({
            "phase": "immediate",
            "time": "0-1小时",
            "actions": actions[:2] if len(actions) >= 2 else actions,
            "deadline": (base_time + timedelta(hours=1)).isoformat()
        })
        
        # 短期措施（1-4小时）
        if len(actions) > 2:
            timeline.append({
                "phase": "short_term",
                "time": "1-4小时",
                "actions": actions[2:4],
                "deadline": (base_time + timedelta(hours=4)).isoformat()
            })
        
        # 后续措施（4-24小时）
        if len(actions) > 4:
            timeline.append({
                "phase": "follow_up",
                "time": "4-24小时",
                "actions": actions[4:],
                "deadline": (base_time + timedelta(hours=24)).isoformat()
            })
        
        return timeline
    
    def stop(self):
        """停止Agent"""
        self._running = False
        self.coordinator.update_agent_state(self.name, "offline")
        logger.info("DecisionAgent stopped")
