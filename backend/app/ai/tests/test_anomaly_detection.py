"""
Part 2 测试：时序引擎异常检测
使用模块调用方式：引擎核心方法 + 智能体决策方法
"""
import os
import sys
import asyncio
from datetime import datetime
from typing import Dict, Any, List

# 设置环境变量（避免Pydantic配置验证失败）
os.environ.setdefault("TDENGINE_HOST", "localhost")
os.environ.setdefault("TDENGINE_PORT", "6041")
os.environ.setdefault("TDENGINE_USER", "root")
os.environ.setdefault("TDENGINE_PASSWORD", "taosdata")
os.environ.setdefault("TDENGINE_DATABASE", "water_quality")
os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "password")
os.environ.setdefault("MQTT_BROKER_HOST", "localhost")
os.environ.setdefault("MQTT_BROKER_PORT", "1883")

# 添加项目路径
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# 导入引擎和智能体
from app.ai.engines.time_series import TimeSeriesEngine
from app.ai.agents.output_generator import AgentProcessor


def format_human_output(station_name: str, engine_result: Dict, agent_result: Dict) -> str:
    """格式化人类可读输出"""
    detection_time = datetime.now()
    severity = agent_result["machine"]["severity"]
    action = agent_result["machine"]["action"]
    
    if not engine_result["is_anomaly"]:
        return f"""
┌─────────────────────────────────────────────────────────────┐
│  【监测正常】{station_name}                                   │
│  • 各项指标均在正常范围内                                     │
│  • 检测时间：{detection_time.strftime('%H:%M')}              │
└─────────────────────────────────────────────────────────────┘"""
    
    anomaly_lines = []
    for a in engine_result["anomalies"]:
        anomaly_lines.append(f"│    - {a['name']}：{a['value']}")
    anomaly_text = "\n".join(anomaly_lines) if anomaly_lines else "│    (无)"
    
    # 解析推理链
    reasoning = agent_result['human']
    reasoning_lines = reasoning.split('\n')
    reasoning_text = "\n".join([f"│  • {line}" for line in reasoning_lines])
    
    return f"""
┌─────────────────────────────────────────────────────────────┐
│  【异常通知】{station_name} - {severity}级                    │
├─────────────────────────────────────────────────────────────┤
│  • LSTM异常分数：{engine_result['lstm_score']}               │
│  • 异常指标：                                                │
{anomaly_text}
├─────────────────────────────────────────────────────────────┤
│  【智能体推理】                                               │
{reasoning_text}
├─────────────────────────────────────────────────────────────┤
│  • 下一步动作：{action}                                      │
│  • 建议操作：[查看溯源分析] [加密监测] [暂时忽略]              │
└─────────────────────────────────────────────────────────────┘"""


async def test_anomaly_detection():
    """测试异常检测（引擎 + 智能体双输出）"""
    print("\n" + "="*60)
    print("Part 2: 时序引擎异常检测")
    print("="*60)
    
    station_id = "S001"
    station_name = "清河中游监测站"
    
    # ===== 测试数据 =====
    data = {
        "ph": 7.2,
        "do": 1.5,      # 异常：溶解氧过低
        "nh3_n": 3.8,   # 异常：氨氮超标
        "codmn": 12.0
    }
    # 模拟历史数据（用于LSTM）
    history = [7.0, 7.1, 7.2, 7.0, 6.9, 7.1, 7.2, 7.3, 7.1, 7.0] * 2
    
    # ===== 1. 引擎层：detect_anomaly_core =====
    print("\n【引擎层】TimeSeriesEngine.detect_anomaly_core()")
    engine = TimeSeriesEngine()
    engine_result = engine.detect_anomaly_core(data, history=history, model=None)
    print(f"输入数据: {data}")
    print(f"引擎输出: {engine_result}")
    
    # ===== 2. 智能体层：decide_anomaly_action =====
    print("\n【智能体层】AgentProcessor.decide_anomaly_action()")
    agent = AgentProcessor(llm_client=None)  # 无LLM时返回规则推理
    agent_result = await agent.decide_anomaly_action(engine_result, station_name, data=data)
    print(f"智能体输出: {agent_result}")
    
    # ===== 3. 双输出 =====
    print("\n" + "="*60)
    print("【双输出结果】")
    print("="*60)
    
    # 机器输出（给Part 3使用）
    machine_output = {
        "station_id": station_id,
        "station_name": station_name,
        "detection_time": datetime.now().isoformat(),
        **engine_result,
        **agent_result["machine"],
        "data": data
    }
    
    print("\n--- 机器输出（给Part 3使用）---")
    print(machine_output)
    
    # 人类输出
    human_output = format_human_output(station_name, engine_result, agent_result)
    print("\n--- 人类输出（给用户看）---")
    print(human_output)
    
    return machine_output


if __name__ == "__main__":
    asyncio.run(test_anomaly_detection())
