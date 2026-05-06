"""
统一警报分级策略配置
====================
四级警报体系：critical > high > medium > low
"""
from typing import Dict, List
from dataclasses import dataclass


@dataclass
class AlertLevel:
    """警报等级定义"""
    code: str           # 等级代码
    name: str           # 中文名称
    color: str          # 显示颜色
    response_time: str  # 响应时限
    notify_channels: List[str]  # 通知渠道
    departments: List[str]      # 责任部门


# ==============================================
# 四级警报定义
# ==============================================

ALERT_LEVELS: Dict[str, AlertLevel] = {
    "critical": AlertLevel(
        code="critical",
        name="红色预警",
        color="red",
        response_time="30分钟内",
        notify_channels=["短信", "电话", "系统弹窗", "应急广播"],
        departments=["应急管理局", "生态环境局", "水务局"]
    ),
    "high": AlertLevel(
        code="high",
        name="橙色预警",
        color="orange",
        response_time="1小时内",
        notify_channels=["短信", "系统弹窗", "邮件"],
        departments=["生态环境局", "水务局"]
    ),
    "medium": AlertLevel(
        code="medium",
        name="黄色预警",
        color="yellow",
        response_time="4小时内",
        notify_channels=["系统弹窗", "邮件"],
        departments=["生态环境局"]
    ),
    "low": AlertLevel(
        code="low",
        name="蓝色预警",
        color="blue",
        response_time="24小时内",
        notify_channels=["邮件"],
        departments=["值班人员"]
    )
}


# ==============================================
# 分级判定规则
# ==============================================

def calculate_alert_level(
    anomaly_count: int,
    confidence: float,
    has_lstm_anomaly: bool = False
) -> str:
    """
    统一警报等级判定
    
    Args:
        anomaly_count: 异常指标数量
        confidence: 污染类型置信度 (0~1)
        has_lstm_anomaly: 是否有LSTM时序异常
    
    Returns:
        警报等级代码: critical/high/medium/low
    """
    # 红色：≥3异常 + 高置信度，或LSTM异常 + ≥2异常
    if (anomaly_count >= 3 and confidence > 0.7) or \
       (has_lstm_anomaly and anomaly_count >= 2 and confidence > 0.6):
        return "critical"
    
    # 橙色：≥2异常 + 中等置信度
    if anomaly_count >= 2 and confidence > 0.5:
        return "high"
    
    # 黄色：有异常
    if anomaly_count >= 1:
        return "medium"
    
    # 蓝色：轻微异常或预警
    return "low"


def get_level_info(level_code: str) -> AlertLevel:
    """获取警报等级详情"""
    return ALERT_LEVELS.get(level_code, ALERT_LEVELS["low"])


# ==============================================
# 便捷函数
# ==============================================

def get_response_time(level: str) -> str:
    """获取响应时限"""
    return get_level_info(level).response_time


def get_notify_channels(level: str) -> List[str]:
    """获取通知渠道"""
    return get_level_info(level).notify_channels


def get_departments(level: str) -> List[str]:
    """获取责任部门"""
    return get_level_info(level).departments
