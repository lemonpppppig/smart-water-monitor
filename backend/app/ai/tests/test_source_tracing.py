"""
Part 3 测试：图引擎溯源分析
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
from app.ai.engines.graph import GraphEngine
from app.ai.agents.output_generator import AgentProcessor


# 模拟数据（Neo4j不可用或数据未初始化时使用）
MOCK_SOURCES = [
    {"station_id": "S002", "station_name": "清河上游", "distance": 12, "confidence": 0.76},
    {"station_id": "S003", "station_name": "工业园区排口", "distance": 17, "confidence": 0.66},
    {"station_id": "S004", "station_name": "源头站", "distance": 25, "confidence": 0.50}
]


def format_human_output(station_name: str, sources: List[Dict], agent_result: Dict) -> str:
    """格式化人类可读输出"""
    if not sources:
        return f"""
┌─────────────────────────────────────────────────────────────┐
│  【溯源分析】{station_name}                                   │
│  • 分析结果：未找到上游站点                                   │
│  • 建议操作：请进行人工现场调查                              │
└─────────────────────────────────────────────────────────────┘"""
    
    top = sources[0]
    machine = agent_result["machine"]
    alert_status = "是" if machine.get("alert") else "否"
    
    # 解析推理链
    reasoning = agent_result['human']
    reasoning_lines = reasoning.split('\n')
    reasoning_text = "\n".join([f"│  • {line}" for line in reasoning_lines])
    
    return f"""
┌─────────────────────────────────────────────────────────────┐
│  【溯源分析报告】{station_name}                               │
├─────────────────────────────────────────────────────────────┤
│  【引擎溯源结果】                                               │
│  • 最可能源头：{top['station_name']}（置信度{top['confidence']*100:.0f}%）         │
│  • 传播距离：{top['distance']}km                                 │
├─────────────────────────────────────────────────────────────┤
│  【智能体推理】                                               │
{reasoning_text}
├─────────────────────────────────────────────────────────────┤
│  • 是否预警下游：{alert_status}                                      │
│  • 建议操作：[生成处置方案] [查看历史数据] [导出报告]          │
└─────────────────────────────────────────────────────────────┘"""


async def test_source_tracing():
    """测试溯源分析（引擎 + 智能体双输出）"""
    print("\n" + "="*60)
    print("Part 3: 图引擎溯源分析")
    print("="*60)
    
    # 模拟Part 2的输出
    part2_output = {
        "station_id": "S001",
        "station_name": "清河中游监测站",
        "is_anomaly": True,
        "anomalies": [
            {"metric": "do", "name": "溶解氧", "value": 1.5},
            {"metric": "nh3_n", "name": "氨氮", "value": 3.8}
        ],
        "severity": "high",
        "action": "trace_source"
    }
    
    station_id = part2_output["station_id"]
    station_name = part2_output["station_name"]
    
    # ===== 1. 引擎层：trace_upstream_core =====
    print("\n【引擎层】GraphEngine.trace_upstream_core()")
    
    use_mock = False
    try:
        engine = GraphEngine()
        sources = engine.trace_upstream_core(station_id)
        print(f"站点: {station_id}")
        
        if sources:
            print(f"引擎输出（真实数据）: {sources}")
        else:
            print(f"引擎输出: [] (Neo4j连接成功但数据未初始化)")
            print(f"提示: 请运行 Neo4j 初始化脚本: infrastructure/docker/neo4j/init/01_knowledge_graph.cypher")
            use_mock = True
            sources = MOCK_SOURCES
            print(f"使用模拟数据: {sources}")
    except Exception as e:
        print(f"Neo4j连接失败: {e}")
        use_mock = True
        sources = MOCK_SOURCES
        print(f"使用模拟数据: {sources}")
    
    # ===== 2. 智能体层：decide_trace_action =====
    print("\n【智能体层】AgentProcessor.decide_trace_action()")
    agent = AgentProcessor(llm_client=None)
    agent_result = await agent.decide_trace_action(sources, station_name, anomalies=part2_output["anomalies"])
    print(f"智能体输出: {agent_result}")
    
    # ===== 3. 双输出 =====
    print("\n" + "="*60)
    print("【双输出结果】")
    print("="*60)
    
    # 机器输出（给Part 4使用）
    machine_output = {
        "target_station": station_id,
        "target_name": station_name,
        "sources": sources,
        "top_source": sources[0] if sources else None,
        **agent_result["machine"],
        "anomalies": part2_output["anomalies"],
        "next_action": "generate_plan" if sources else "manual_investigate"
    }
    
    print("\n--- 机器输出（给Part 4使用）---")
    print(machine_output)
    
    # 人类输出
    human_output = format_human_output(station_name, sources, agent_result)
    print("\n--- 人类输出（给用户看）---")
    print(human_output)
    
    return machine_output


if __name__ == "__main__":
    asyncio.run(test_source_tracing())
