"""
智能体处理器 - 规则逻辑 + LLM生成
"""
from typing import Dict, Any, List
from datetime import datetime

from .prompts import get_prompt
from .alert_levels import calculate_alert_level, get_level_info, ALERT_LEVELS


class AgentProcessor:
    """智能体处理器 - 规则判断 + LLM解释"""
    
    def __init__(self, llm_client=None):
        """初始化智能体处理器
        
        Args:
            llm_client: LLM客户端（可选，用于生成自然语言解释）
        """
        self.llm = llm_client
    
    # ==================== 核心方法：异常决策 ====================
    async def decide_anomaly_action(self, engine_result: Dict, station: str, data: Dict = None) -> Dict:
        """异常决策：规则判断 + LLM推理"""
        anomalies = engine_result.get("anomalies", [])
        lstm_score = engine_result.get("lstm_score", 0)
        # 1. 统一分级策略判断严重程度
        has_lstm = lstm_score > 0.1
        severity = calculate_alert_level(len(anomalies), 0.5 if has_lstm else 0.3, has_lstm)
        action = "trace_source" if severity in ["critical", "high"] else "increase_monitor"
        # 2. 构建异常详情上下文
        anomaly_details = ", ".join([f"{a['name']}={a['value']}" for a in anomalies]) if anomalies else "无"
        # 3. LLM结构化推理
        if self.llm:
            prompt = get_prompt("anomaly_reasoning", station=station, anomaly_details=anomaly_details,
                               lstm_score=lstm_score, severity=severity)
            reasoning = await self.llm.chat(prompt)
        else:
            reasoning = self._default_anomaly_reasoning(anomalies, severity, station)
        # 4. 双输出
        return {"machine": {"severity": severity, "action": action}, "human": reasoning}
    
    def _default_anomaly_reasoning(self, anomalies: List, severity: str, station: str) -> str:
        """无LLM时的默认推理（基于规则）"""
        # 指标组合模式识别
        metrics = {a["metric"] for a in anomalies}
        if {"do", "nh3_n"} <= metrics:
            pattern, cause = "溶解氧偏低+氨氮偏高，符合有机污染特征", "上游可能存在生活污水或养殖废水排入"
        elif {"codmn", "ph"} <= metrics:
            pattern, cause = "COD偏高+pH异常，符合工业污染特征", "上游可能存在工业废水排放"
        elif "nh3_n" in metrics:
            pattern, cause = "氨氮单项超标，疑似农业面源污染", "上游可能存在农田径流或施肥污染"
        elif "do" in metrics:
            pattern, cause = "溶解氧异常偏低，水体富营养化风险", "可能存在有机物大量分解耗氧"
        else:
            pattern, cause = f"{len(anomalies)}项指标异常", "需进一步排查确认"
        anomaly_text = ", ".join([f"{a['name']}{a['value']}" for a in anomalies])
        return (f"异常模式：{pattern}\n"
                f"可能原因：{cause}\n"
                f"风险评估：{severity}级，{anomaly_text}超标\n"
                f"建议动作：{'立即启动溯源分析' if severity in ['critical', 'high'] else '加密监测频次'}")
    
    # ==================== 核心方法：溯源决策 ====================
    async def decide_trace_action(self, sources: List[Dict], station: str, anomalies: List[Dict] = None) -> Dict:
        """溯源决策：规则计算 + LLM多假设推理"""
        # 1. 空结果处理
        if not sources:
            return {"machine": {"source": None, "alert": False}, "human": "未找到上游站点"}
        # 2. 规则判断
        top = sources[0]
        alert_downstream = top.get("confidence", 0) > 0.6
        # 3. 构建上下文
        anomaly_details = ", ".join([f"{a['name']}={a['value']}" for a in (anomalies or [])]) or "未提供"
        sources_detail = "\n".join([f"  - {s['station_name']}：距离{s['distance']}km，置信度{s['confidence']*100:.0f}%" for s in sources])
        # 4. LLM多假设推理
        if self.llm:
            prompt = get_prompt("trace_reasoning", station=station, anomaly_details=anomaly_details,
                               sources_detail=sources_detail)
            reasoning = await self.llm.chat(prompt)
        else:
            reasoning = self._default_trace_reasoning(sources, alert_downstream)
        return {"machine": {"source": top["station_id"], "confidence": top.get("confidence"), "alert": alert_downstream}, "human": reasoning}
    
    def _default_trace_reasoning(self, sources: List[Dict], alert_downstream: bool) -> str:
        """无LLM时的默认溯源推理"""
        hypotheses = []
        for i, s in enumerate(sources, 1):
            conf = s['confidence'] * 100
            reason = "距离最近，可能性最高" if i == 1 else ("距离较近，仍有可能" if conf > 50 else "距离较远，可能性低")
            hypotheses.append(f"假设{i}：{s['station_name']}（{s['distance']}km，置信度{conf:.0f}%）- {reason}")
        top = sources[0]
        alert_text = f"置信度{top['confidence']*100:.0f}%超过60%阈值，建议预警下游" if alert_downstream else f"置信度{top['confidence']*100:.0f}%未超过60%阈值，暂不预警"
        return (f"假设排列：{'; '.join(hypotheses)}\n"
                f"证据分析：{top['station_name']}距离最近({top['distance']}km)，置信度最高，符合污染传播规律\n"
                f"最终判断：{top['station_name']}为最可能源头\n"
                f"下游预警：{alert_text}")
    
    # ==================== 核心方法：处置决策 ====================
    async def decide_response(self, knowledge: Dict, severity: str,
                              anomalies: List[Dict] = None, source_info: Dict = None) -> Dict:
        """处置决策：知识库驱动 + 案例参考 + LLM综合推理"""
        # 1. 从知识库获取处置方案（Neo4j EmergencyPlan）
        pollution = knowledge.get("pollution", {})
        plan = knowledge.get("plan") or {}
        cases = knowledge.get("cases", [])  # 历史案例参考（多条）
        level = plan.get("priority", severity)
        priority = get_level_info(level).color
        actions = plan.get("actions", [])
        depts = plan.get("departments", [])
        dept = depts[0]["name"] if depts and isinstance(depts[0], dict) else (depts[0] if depts else "生态环境局")
        # 2. 案例参考信息（多条）
        similar_cases = [{"case_code": c.get("case_code"), "cause": c.get("cause"),
                          "outcome": c.get("outcome"), "recovery_days": c.get("recovery_days")} for c in cases]
        # 3. 构建跨环节上下文
        anomaly_details = ", ".join([f"{a['name']}={a['value']}" for a in (anomalies or [])]) or "未提供"
        source_text = f"{source_info['station_name']}(距离{source_info['distance']}km, 置信度{source_info['confidence']*100:.0f}%)" if source_info else "未提供"
        case_details = "\n".join([f"  - {c.get('case_code')}: {c.get('cause', '')}，处置结果{c.get('outcome', '')}，恢复{c.get('recovery_days', '?')}天" for c in cases]) or "无历史案例"
        # 4. LLM综合推理
        if self.llm:
            prompt = get_prompt("decision_reasoning", anomaly_details=anomaly_details, source_info=source_text,
                               pollution_type=pollution.get("name", "未知"), confidence=int(pollution.get("score", 0)*100),
                               case_details=case_details, actions=actions[:3])
            reasoning = await self.llm.chat(prompt)
        else:
            reasoning = self._default_decision_reasoning(pollution, cases, actions, source_info, anomalies)
        return {"machine": {"priority": priority, "level": level, "actions": actions, "dept": dept, 
                            "response_time": plan.get("response_time", ""), "similar_cases": similar_cases}, "human": reasoning}
    
    def _default_decision_reasoning(self, pollution: Dict, cases: List, actions: List,
                                    source_info: Dict = None, anomalies: List = None) -> str:
        """无LLM时的默认综合推理"""
        p_name = pollution.get("name", "未知")
        p_score = int(pollution.get("score", 0) * 100)
        source_text = f"源头{source_info['station_name']}" if source_info else "源头待确认"
        anomaly_text = ", ".join([f"{a['name']}{a['value']}" for a in (anomalies or [])]) or "未提供"
        # 案例参考
        case_lines = []
        total_days = 0
        for c in cases:
            days = c.get("recovery_days", 0)
            total_days += days
            case_lines.append(f"{c.get('case_code')}处置{days}天恢复")
        avg_days = round(total_days / len(cases)) if cases else 0
        case_text = ", ".join(case_lines) if case_lines else "无历史案例"
        actions_text = ", ".join([f"{i+1}.{a}" for i, a in enumerate(actions[:3])]) if actions else "人工排查"
        recovery = f"参考历史案例平均恢复{avg_days}天" if avg_days > 0 else "无历史参考"
        return (f"态势研判：{p_name}（{p_score}%），{source_text}，{anomaly_text}超标\n"
                f"案例参考：{case_text}\n"
                f"处置方案：{actions_text}\n"
                f"预期效果：{recovery}")
    
    # ==================== Part 3: 诊断溯源 ====================
    
    @staticmethod
    def format_trace_report(
        target_station: str,
        sources: List[Dict],
        spread: List[Dict],
        pollution_sources: List[Dict] = None  # 新增：上游污染源
    ) -> Dict[str, Any]:
        """生成溯源分析报告"""
        report_lines = ["【溯源分析报告】\n"]
        
        # 1. 最可能源头（上游站点）
        if sources:
            top = sources[0]
            report_lines.append(f"• 最可能源头：{top['station_name']}（置信度{top['confidence']*100:.0f}%）")
            report_lines.append(f"  - 距离：{top['distance']/1000:.1f}km")
            report_lines.append(f"  - 传播时间：约{top['travel_time']:.1f}小时")
        else:
            report_lines.append("• 未找到可疑上游站点")
        
        # 2. 潜在污染源（新增）
        if pollution_sources:
            report_lines.append(f"\n• 上游潜在污染源：{len(pollution_sources)}个")
            for ps in pollution_sources[:3]:
                risk_icon = "🔴" if ps.get('risk_level') == 'high' else ("🟠" if ps.get('risk_level') == 'medium' else "🟢")
                report_lines.append(f"  - {risk_icon} {ps['name']}（{ps.get('source_type', '')}，{ps.get('distance_km', 0)}km）")
                if ps.get('pollutants'):
                    report_lines.append(f"    排放物：{', '.join(ps['pollutants'][:4])}")
        
        # 3. 下游预警
        if spread:
            report_lines.append(f"\n• 下游预警：{len(spread)}个站点可能受影响")
            for s in spread[:3]:
                report_lines.append(f"  - {s['station_name']}：预计{s['hours_from_now']}小时后到达")
        
        # 4. 建议操作
        report_lines.append("\n• 建议：[查看污染源详情] [通知下游] [生成处置建议]")
        
        return {
            "type": "trace_report",
            "text": "\n".join(report_lines),
            "top_source": sources[0] if sources else None,
            "pollution_sources": pollution_sources,
            "affected_count": len(spread),
            "timestamp": datetime.now().isoformat()
        }
    
    @staticmethod
    def format_source_evidence(
        source: Dict,
        detection_time: datetime
    ) -> str:
        """生成溯源证据描述（10行核心逻辑）"""
        travel_time = source.get("travel_time", 0)
        distance = source.get("distance", 0)
        
        # 计算上游异常时间
        from datetime import timedelta
        upstream_time = detection_time - timedelta(hours=travel_time)
        
        evidence = f"时序证据：上游{source['station_name']}在{upstream_time.strftime('%H:%M')}异常，"
        evidence += f"传播{travel_time:.1f}小时后到达目标站点，**时间吻合**\n"
        evidence += f"地理证据：距离{distance/1000:.1f}km，水流速度匹配"
        
        return evidence
    
    # ==================== Part 4: 智能处置 ====================
    
    @staticmethod
    def format_decision_report(
        pollution_result: Dict,
        similar_cases: List[Dict],
        emergency_plan: Dict,
        priority: str
    ) -> Dict[str, Any]:
        """生成处置建议报告（15~20行核心逻辑）"""
        report_lines = ["【处置建议报告】\n"]
        
        # 1. 污染类型
        p_name = pollution_result.get("pollution_name", "未知")
        confidence = pollution_result.get("confidence", 0)
        report_lines.append(f"• 污染类型：{p_name}（{confidence*100:.0f}%置信度）")
        report_lines.append(f"  - 判断依据：{pollution_result.get('description', '')}")
        
        # 2. 相似案例
        if similar_cases:
            case = similar_cases[0]
            report_lines.append(f"\n• 相似案例：{case['case_id']}")
            report_lines.append(f"  - 处置结果：{case['outcome']}")
        
        # 3. 推荐措施
        actions = emergency_plan.get("actions", [])
        if actions:
            report_lines.append("\n• 推荐措施：")
            for i, action in enumerate(actions[:3], 1):
                report_lines.append(f"  {i}. {action}")
        
        # 4. 责任部门
        depts = emergency_plan.get("departments", [])
        report_lines.append(f"\n• 责任部门：{', '.join(depts)}")
        report_lines.append(f"• 优先级：{priority}")
        
        return {
            "type": "decision_report",
            "text": "\n".join(report_lines),
            "priority": priority,
            "pollution_type": pollution_result.get("pollution_type"),
            "timestamp": datetime.now().isoformat()
        }
    
    @staticmethod
    def format_pollution_judgment(
        data: Dict[str, float],
        pollution_type: str,
        confidence: float
    ) -> str:
        """生成污染类型判断说明（10行核心逻辑）"""
        # 特征描述映射
        feature_desc = {
            "domestic_sewage": "氨氮↑ + DO↓",
            "industrial_wastewater": "COD↑ + pH异常",
            "agricultural_runoff": "总氮↑ + 总磷↑",
            "algae_bloom": "叶绿素↑ + pH↑ + DO波动",
            "black_odor": "DO↓ + 透明度↓"
        }
        
        desc = feature_desc.get(pollution_type, "特征不明显")
        return f"根据{desc}的特征组合，判断为**{pollution_type}**（置信度{confidence*100:.0f}%）"


# 便捷函数（兼容旧版API）
class OutputGenerator:
    """输出生成器 - 兼容旧版API"""
    
    @staticmethod
    def format_trace_report(target_station, sources, spread, pollution_sources=None):
        return AgentProcessor.format_trace_report(target_station, sources, spread, pollution_sources)
    
    @staticmethod
    def format_decision_report(pollution_result, similar_cases, emergency_plan, priority):
        return AgentProcessor.format_decision_report(pollution_result, similar_cases, emergency_plan, priority)


def generate_alert(station_id: str, station_name: str, anomalies: List, data: Dict) -> Dict:
    """生成异常告警"""
    alert_text = f"【异常通知】{station_name}({station_id})数据异常\n"
    anomaly_strs = [str(a.get('metric', '')) + '=' + str(a.get('value', '')) for a in anomalies]
    alert_text += f"• 异常指标：{', '.join(anomaly_strs)}\n"
    alert_text += f"• 检测时间：{datetime.now().strftime('%H:%M')}"
    return {"type": "anomaly_alert", "station_id": station_id, "text": alert_text, "anomalies": anomalies}

def generate_trace_report(target: str, sources: List, spread: List) -> Dict:
    """生成溯源报告"""
    return OutputGenerator.format_trace_report(target, sources, spread)

def generate_decision(pollution: Dict, cases: List, plan: Dict, priority: str) -> Dict:
    """生成处置建议"""
    return OutputGenerator.format_decision_report(pollution, cases, plan, priority)
