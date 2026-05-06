"""
协调中枢 Agent
负责任务编排、状态同步、冲突消解
"""
import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class AgentTask:
    """Agent任务"""
    task_id: str
    task_type: str
    priority: int  # 1-10
    payload: Dict[str, Any]
    assigned_to: Optional[str] = None
    status: str = "pending"  # pending, running, completed, failed
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None


@dataclass
class AgentState:
    """Agent状态"""
    agent_name: str
    agent_type: str
    status: str  # online, offline, busy, error
    current_task: Optional[str] = None
    last_heartbeat: datetime = field(default_factory=datetime.now)
    capabilities: List[str] = field(default_factory=list)


class CoordinatorAgent:
    """协调中枢Agent - 多智能体协调集群的核心"""
    
    def __init__(self):
        self.agents: Dict[str, AgentState] = {}
        self.tasks: Dict[str, AgentTask] = {}
        self.shared_state: Dict[str, Any] = {
            "system_mode": "normal",  # normal, alert, emergency
            "active_alerts": [],
            "monitoring_stations": set()
        }
        self._running = False
    
    def register_agent(self, agent_name: str, agent_type: str, 
                       capabilities: List[str]) -> bool:
        """注册Agent"""
        if agent_name in self.agents:
            logger.warning(f"Agent {agent_name} already registered")
            return False
        
        self.agents[agent_name] = AgentState(
            agent_name=agent_name,
            agent_type=agent_type,
            status="online",
            capabilities=capabilities
        )
        logger.info(f"Agent {agent_name} ({agent_type}) registered")
        return True
    
    def update_agent_state(self, agent_name: str, status: str, 
                           current_task: str = None):
        """更新Agent状态"""
        if agent_name not in self.agents:
            logger.warning(f"Unknown agent: {agent_name}")
            return
        
        agent = self.agents[agent_name]
        agent.status = status
        agent.current_task = current_task
        agent.last_heartbeat = datetime.now()
    
    def submit_task(self, task_type: str, payload: Dict[str, Any],
                    priority: int = 5) -> str:
        """提交任务"""
        task_id = f"task_{datetime.now().strftime('%Y%m%d%H%M%S')}_{len(self.tasks)}"
        
        task = AgentTask(
            task_id=task_id,
            task_type=task_type,
            priority=priority,
            payload=payload
        )
        self.tasks[task_id] = task
        
        logger.info(f"Task {task_id} submitted (type: {task_type}, priority: {priority})")
        return task_id
    
    def assign_task(self, task_id: str, agent_name: str) -> bool:
        """分配任务给Agent"""
        if task_id not in self.tasks:
            return False
        
        if agent_name not in self.agents:
            return False
        
        task = self.tasks[task_id]
        agent = self.agents[agent_name]
        
        if agent.status == "busy":
            logger.warning(f"Agent {agent_name} is busy")
            return False
        
        task.assigned_to = agent_name
        task.status = "running"
        task.started_at = datetime.now()
        
        agent.status = "busy"
        agent.current_task = task_id
        
        logger.info(f"Task {task_id} assigned to {agent_name}")
        return True
    
    def complete_task(self, task_id: str, result: Dict[str, Any]) -> bool:
        """完成任务"""
        if task_id not in self.tasks:
            return False
        
        task = self.tasks[task_id]
        task.status = "completed"
        task.completed_at = datetime.now()
        task.result = result
        
        # 释放Agent
        if task.assigned_to and task.assigned_to in self.agents:
            agent = self.agents[task.assigned_to]
            agent.status = "online"
            agent.current_task = None
        
        logger.info(f"Task {task_id} completed")
        return True
    
    def get_next_task(self, agent_capabilities: List[str]) -> Optional[AgentTask]:
        """获取下一个待处理任务"""
        pending_tasks = [
            t for t in self.tasks.values()
            if t.status == "pending"
        ]
        
        if not pending_tasks:
            return None
        
        # 按优先级排序
        pending_tasks.sort(key=lambda t: t.priority, reverse=True)
        
        return pending_tasks[0]
    
    def get_shared_state(self) -> Dict[str, Any]:
        """获取共享状态"""
        return self.shared_state.copy()
    
    def update_shared_state(self, key: str, value: Any):
        """更新共享状态"""
        self.shared_state[key] = value
    
    def add_active_alert(self, alert_id: str):
        """添加活跃预警"""
        if alert_id not in self.shared_state["active_alerts"]:
            self.shared_state["active_alerts"].append(alert_id)
            self.shared_state["system_mode"] = "alert"
    
    def remove_active_alert(self, alert_id: str):
        """移除活跃预警"""
        if alert_id in self.shared_state["active_alerts"]:
            self.shared_state["active_alerts"].remove(alert_id)
        
        if not self.shared_state["active_alerts"]:
            self.shared_state["system_mode"] = "normal"
    
    def get_system_status(self) -> Dict[str, Any]:
        """获取系统状态"""
        return {
            "system_mode": self.shared_state["system_mode"],
            "active_agents": len([a for a in self.agents.values() if a.status != "offline"]),
            "total_agents": len(self.agents),
            "pending_tasks": len([t for t in self.tasks.values() if t.status == "pending"]),
            "running_tasks": len([t for t in self.tasks.values() if t.status == "running"]),
            "active_alerts": len(self.shared_state["active_alerts"])
        }
