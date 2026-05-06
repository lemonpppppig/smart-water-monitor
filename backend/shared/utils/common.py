"""
通用工具函数
"""
import uuid
import re
from datetime import datetime
from typing import Optional


def generate_code(prefix: str = "", length: int = 8) -> str:
    """生成唯一编码"""
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    random_part = uuid.uuid4().hex[:length].upper()
    return f"{prefix}{timestamp}{random_part}"


def format_datetime(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """格式化日期时间"""
    if dt is None:
        return ""
    return dt.strftime(fmt)


def parse_datetime(dt_str: str, fmt: str = "%Y-%m-%d %H:%M:%S") -> Optional[datetime]:
    """解析日期时间字符串"""
    if not dt_str:
        return None
    try:
        return datetime.strptime(dt_str, fmt)
    except ValueError:
        return None


def validate_station_type(station_type: str) -> bool:
    """验证站点类型"""
    valid_types = ["water_source", "industrial_park", "boundary_section", "rural_water"]
    return station_type in valid_types


def validate_metric_code(metric_code: str) -> bool:
    """验证指标编码"""
    valid_codes = [
        "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
        "chlorophyll", "blue_green_algae", "total_n", "total_p",
        "codcr", "transparency", "orp", "water_temperature",
        "heavy_metals", "suspended_solids", "flow_rate"
    ]
    return metric_code in valid_codes


def get_pollution_level(value: float, standard: float) -> str:
    """根据数值和标准获取污染等级"""
    if value <= standard:
        return "excellent"
    elif value <= standard * 1.5:
        return "good"
    elif value <= standard * 2:
        return "mild"
    elif value <= standard * 3:
        return "moderate"
    else:
        return "severe"


def calculate_nutrient_index(total_n: float, total_p: float, chla: float) -> float:
    """计算营养状态指数（TLI）"""
    # 简化版TLI计算
    tli_chla = 10 if chla <= 0 else 25.0 + 10.9 * (chla ** 0.5)
    tli_tp = 10 if total_p <= 0 else 96.0 - 32.0 * (total_p ** -0.5)
    tli_tn = 10 if total_n <= 0 else 54.0 + 16.5 * (total_n ** 0.5)
    
    # 加权平均
    tli = (tli_chla * 0.5 + tli_tp * 0.25 + tli_tn * 0.25)
    return round(tli, 2)


def get_trophic_level(tli: float) -> str:
    """根据TLI获取营养等级"""
    if tli < 30:
        return "oligotrophic"  # 贫营养
    elif tli < 50:
        return "mesotrophic"   # 中营养
    elif tli < 60:
        return "light_eutrophic"  # 轻度富营养
    elif tli < 70:
        return "moderate_eutrophic"  # 中度富营养
    else:
        return "severe_eutrophic"  # 重度富营养


def sanitize_filename(filename: str) -> str:
    """清理文件名中的非法字符"""
    return re.sub(r'[<>:"/\\|?*]', '_', filename)


def truncate_string(s: str, max_length: int, suffix: str = "...") -> str:
    """截断字符串"""
    if len(s) <= max_length:
        return s
    return s[:max_length - len(suffix)] + suffix


def merge_dicts(base: dict, override: dict) -> dict:
    """合并字典，override覆盖base"""
    result = base.copy()
    result.update(override)
    return result
