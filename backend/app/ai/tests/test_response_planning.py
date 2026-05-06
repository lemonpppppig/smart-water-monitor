"""
Part 4 测试：知识引擎匹配
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
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/water_quality")

# 添加项目路径
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# 导入智能体和引擎
from app.ai.agents.output_generator import AgentProcessor

# 尝试导入数据库客户端（可能失败）
try:
    from app.ai.engines.knowledge import KnowledgeEngine
    from shared.db.neo4j_client import Neo4jClient
    import asyncpg
    HAS_DB_SUPPORT = True
except ImportError:
    HAS_DB_SUPPORT = False


# 模拟知识引擎输出（数据库不可用时使用）
MOCK_KNOWLEDGE_RESULT = {
    "pollution": {
        "type": "domestic_sewage",
        "name": "生活污水污染",
        "score": 0.72
    },
    "cases": [
        {
            "case_code": "CASE-2024-001",
            "pollution_type": "domestic_sewage",
            "description": "2024年3月清河污染事件",
            "cause": "生活污水直排",
            "outcome": "已处置",
            "recovery_days": 3
        },
        {
            "case_code": "CASE-2023-015",
            "pollution_type": "domestic_sewage",
            "description": "2023年12月河口污染事件",
            "cause": "雨污混流",
            "outcome": "已处置",
            "recovery_days": 5
        }
    ],
    "plan": {
        "actions": ["启动应急监测", "通知下游站点", "排查污染源", "加强巡检"],
        "departments": ["生态环境局", "水务局"],
        "priority": "high"
    }
}


def format_human_output(station_name: str, knowledge: Dict, agent_result: Dict) -> str:
    """格式化人类可读输出"""
    pollution = knowledge["pollution"]
    plan = knowledge.get("plan") or {}
    cases = knowledge.get("cases", [])
    machine = agent_result["machine"]
    
    actions_text = "\n".join([f"│    {i}. {a}" for i, a in enumerate(machine.get("actions", []), 1)])
    
    # 解析推理链
    reasoning = agent_result['human']
    reasoning_lines = reasoning.split('\n')
    reasoning_text = "\n".join([f"│  • {line}" for line in reasoning_lines])
    
    # 构建多案例展示
    case_section = ""
    if cases:
        case_lines = ["\n├─────────────────────────────────────────────────────────────┤"]
        case_lines.append(f"│  【相似案例】共{len(cases)}条                                           │")
        for i, case in enumerate(cases, 1):
            case_lines.append(f"│  {i}. {case['case_code']}: {case.get('description', '')}")
            if case.get('recovery_days'):
                case_lines.append(f"│     恢复天数: {case['recovery_days']}天")
        case_section = "\n".join(case_lines)
    
    return f"""
┌─────────────────────────────────────────────────────────────┐
│  【处置方案】{station_name} - {machine['priority']}优先级          │
├─────────────────────────────────────────────────────────────┤
│  【引擎研判结果】                                               │
│  • 污染类型：{pollution['name']}（置信度{pollution['score']*100:.0f}%）        │
├─────────────────────────────────────────────────────────────┤
│  【智能体综合研判】                                           │
{reasoning_text}
├─────────────────────────────────────────────────────────────┤
│  【处置措施】                                                  │
{actions_text}
{case_section}
├─────────────────────────────────────────────────────────────┤
│  • 责任部门：{machine['dept']}                                  │
│  • 建议操作：[处置下发] [通知责任人] [生成报告]               │
└─────────────────────────────────────────────────────────────┘"""


async def test_response_planning():
    """测试响应方案生成（引擎 + 智能体双输出）"""
    print("\n" + "="*60)
    print("Part 4: 知识引擎匹配")
    print("="*60)
    
    # 模拟Part 3的输出
    part3_output = {
        "target_station": "S001",
        "target_name": "清河中游监测站",
        "top_source": {
            "station_id": "S002",
            "station_name": "清河上游",
            "distance": 12,
            "confidence": 0.76
        },
        "anomalies": [
            {"metric": "do", "name": "溶解氧", "value": 1.5},
            {"metric": "nh3_n", "name": "氨氮", "value": 3.8}
        ],
        "severity": "high"
    }
    
    station_name = part3_output["target_name"]
    severity = part3_output["severity"]
    
    # ===== 1. 引擎层：analyze_knowledge_core =====
    print("\n【引擎层】KnowledgeEngine.analyze_knowledge_core()")
    
    use_mock = True
    knowledge_result = None
    
    # 尝试使用真实数据库
    if HAS_DB_SUPPORT:
        try:
            neo4j = Neo4jClient()
            await neo4j.connect()
            
            # 尝试连接 PostgreSQL
            pg_pool = await asyncpg.create_pool(
                host=os.environ.get("POSTGRES_HOST", "localhost"),
                port=int(os.environ.get("POSTGRES_PORT", 5432)),
                user=os.environ.get("POSTGRES_USER", "postgres"),
                password=os.environ.get("POSTGRES_PASSWORD", "postgres"),
                database=os.environ.get("POSTGRES_DB", "water_quality"),
                min_size=1, max_size=2
            )
            
            engine = KnowledgeEngine(neo4j, pg_pool)
            
            # 构建测试数据
            test_data = {"nh3_n": 3.8, "do": 1.5, "codmn": 12.0, "ph": 7.2}
            knowledge_result = await engine.analyze_knowledge_core(test_data)
            
            if knowledge_result and knowledge_result.get("pollution", {}).get("type") != "unknown":
                print(f"引擎输出（真实数据）: {knowledge_result}")
                use_mock = False
            else:
                print(f"引擎输出: {knowledge_result} (数据库连接成功但知识库未初始化)")
            
            await pg_pool.close()
            await neo4j.close()
        except Exception as e:
            print(f"数据库连接失败: {e}")
    else:
        print("注：数据库客户端未导入")
    
    if use_mock:
        knowledge_result = MOCK_KNOWLEDGE_RESULT
        print(f"使用模拟数据: {knowledge_result}")
    
    # ===== 2. 智能体层：decide_response =====
    print("\n【智能体层】AgentProcessor.decide_response()")
    agent = AgentProcessor(llm_client=None)
    agent_result = await agent.decide_response(
        knowledge_result, severity,
        anomalies=part3_output["anomalies"],
        source_info=part3_output.get("top_source")
    )
    print(f"智能体输出: {agent_result}")
    
    # ===== 3. 双输出 =====
    print("\n" + "="*60)
    print("【双输出结果】")
    print("="*60)
    
    # 机器输出
    machine_output = {
        "station_id": part3_output["target_station"],
        "station_name": station_name,
        "pollution": knowledge_result["pollution"],
        "similar_cases": knowledge_result.get("cases", []),
        **agent_result["machine"],
        "source_station": part3_output["top_source"]["station_name"] if part3_output.get("top_source") else None
    }
    
    print("\n--- 机器输出 ---")
    print(machine_output)
    
    # 人类输出
    human_output = format_human_output(station_name, knowledge_result, agent_result)
    print("\n--- 人类输出（给用户看）---")
    print(human_output)
    
    return machine_output


if __name__ == "__main__":
    asyncio.run(test_response_planning())
