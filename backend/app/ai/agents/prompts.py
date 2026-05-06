"""
Prompt模板库 - 统一管理LLM提示词
"""
from typing import Dict

# ==================== Prompt模板配置 ====================
PROMPTS: Dict[str, str] = {
    # Part 2: 异常模式推理（结构化推理链）
    "anomaly_reasoning": """你是水环境AI智能体，请根据以下监测数据进行异常模式分析。

站点：{station}
异常指标：{anomaly_details}
LSTM时序异常分数：{lstm_score}
警报等级：{severity}

请严格按以下格式输出分析（每项一行）：
异常模式：根据异常指标组合，识别属于哪种污染模式（如有机污染、重金属污染等）
可能原因：基于指标组合推断最可能的污染来源
风险评估：当前异常的紧急程度和对下游的潜在影响
建议动作：下一步应采取的具体措施""",
    
    # Part 3: 多假设溯源推理
    "trace_reasoning": """你是水环境AI智能体，请根据溯源数据进行多假设推理分析。

异常站点：{station}
异常指标：{anomaly_details}
上游站点列表：
{sources_detail}

请严格按以下格式输出推理（每项一行）：
假设排列：按可能性从高到低列出每个上游站点作为污染源的假设及理由
证据分析：距离、置信度、指标特征等支持/反对各假设的证据
最终判断：综合推理得出最可能的源头及判断依据
下游预警：是否需要通知下游站点，给出理由""",
    
    # Part 4: 综合处置决策推理（跨环节关联）
    "decision_reasoning": """你是水环境AI智能体，请综合全链路信息生成处置决策。

【异常数据】{anomaly_details}
【溯源结果】{source_info}
【污染研判】{pollution_type}（置信度{confidence}%）
【历史案例】
{case_details}
【应急预案】措施：{actions}

请严格按以下格式输出决策（每项一行）：
态势研判：综合异常数据、溯源结果、污染类型的总体判断
案例参考：历史案例的处置效果评估，哪些经验可借鉴、哪些教训需避免
处置方案：推荐措施及优先级排序，说明选择理由
预期效果：参考历史案例，预估恢复周期和成功率"""
}


# ==================== 核心方法：获取Prompt ====================
def get_prompt(key: str, **kwargs) -> str:
    """获取并填充Prompt模板"""
    if key not in PROMPTS:
        raise KeyError(f"Prompt template '{key}' not found")
    return PROMPTS[key].format(**kwargs)
