"""
传感器模块化数据解析器
解析实际MQTT数据源的模块化格式（m1/m2/m3/m4/ap/ill/th）
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class SensorDataParser:
    """传感器数据解析器 - 处理模块化数组格式"""

    # 模块1字段映射: 设备字段 -> 系统字段
    M1_MAPPING = {
        "ph": "ph",
        "ec": "conductivity",       # 电导率 μS/cm
        "wt": "water_temperature",  # 水温 ℃
        "tds": "tds",               # 溶解性总固体 mg/L
        "sal": "sal",               # 盐度 %
    }

    # 模块2字段映射
    M2_MAPPING = {
        "nh3n": "nh3_n",    # 氨氮 mg/L
        "tp": "total_p",    # 总磷 mg/L
        "tn": "total_n",    # 总氮 mg/L
        "codmn": "codmn",   # 高锰酸盐指数 mg/L
    }

    # 模块3字段映射
    M3_MAPPING = {
        "do": "do",              # 溶解氧 mg/L
        "chl": "chlorophyll",    # 叶绿素a μg/L
        "bg": "blue_green_algae",  # 蓝绿藻 cells/mL
        "ntu": "turbidity",      # 浊度 NTU
    }

    # 模块4字段映射
    M4_MAPPING = {
        "tr": "transparency",   # 透明度 cm
        "fs": "flow_speed",     # 流速 m/s
        "fr": "flow_rate",      # 流量 m³/s
        "wl": "water_level",    # 水位 m
    }

    # 采样间隔（秒）
    SAMPLE_INTERVALS = {
        "ap": 5,    # 气压 5秒间隔
        "ill": 1,   # 光照 1秒间隔
        "th": 5,    # 温湿度 5秒间隔
        "m1": 5,    # 模块1 默认5秒
        "m2": 5,    # 模块2 默认5秒
        "m3": 5,    # 模块3 默认5秒
        "m4": 5,    # 模块4 默认5秒
    }

    @classmethod
    def parse(cls, raw_message: Dict[str, Any], station_id: str = "",
              receive_time: datetime = None) -> Dict[str, List[Dict[str, Any]]]:
        """
        解析模块化传感器数据

        Args:
            raw_message: 原始MQTT消息（JSON解析后的字典）
            station_id: 站点ID（从连接配置推断）
            receive_time: 消息接收时间

        Returns:
            {
                "water_quality": [...],    # 水质数据记录列表
                "environment": [...],      # 环境数据记录列表
                "module_type": "m1|m2|..."  # 识别到的模块类型
            }
        """
        if receive_time is None:
            receive_time = datetime.now()

        result = {
            "water_quality": [],
            "environment": [],
            "module_types": [],
            "raw": raw_message,
        }

        # 解析水质模块 m1
        if "m1" in raw_message:
            records = cls._parse_water_module(
                raw_message["m1"], cls.M1_MAPPING,
                station_id, receive_time, cls.SAMPLE_INTERVALS["m1"]
            )
            result["water_quality"].extend(records)
            result["module_types"].append("m1")

        # 解析营养盐模块 m2
        if "m2" in raw_message:
            records = cls._parse_water_module(
                raw_message["m2"], cls.M2_MAPPING,
                station_id, receive_time, cls.SAMPLE_INTERVALS["m2"]
            )
            result["water_quality"].extend(records)
            result["module_types"].append("m2")

        # 解析生物模块 m3
        if "m3" in raw_message:
            records = cls._parse_water_module(
                raw_message["m3"], cls.M3_MAPPING,
                station_id, receive_time, cls.SAMPLE_INTERVALS["m3"]
            )
            result["water_quality"].extend(records)
            result["module_types"].append("m3")

        # 解析水文模块 m4
        if "m4" in raw_message:
            records = cls._parse_water_module(
                raw_message["m4"], cls.M4_MAPPING,
                station_id, receive_time, cls.SAMPLE_INTERVALS["m4"]
            )
            result["water_quality"].extend(records)
            result["module_types"].append("m4")

        # 解析气压传感器
        if "ap" in raw_message:
            records = cls._parse_scalar_array(
                raw_message["ap"], "air_pressure",
                station_id, receive_time, cls.SAMPLE_INTERVALS["ap"]
            )
            result["environment"].extend(records)
            result["module_types"].append("ap")

        # 解析光照传感器
        if "ill" in raw_message:
            records = cls._parse_scalar_array(
                raw_message["ill"], "illuminance",
                station_id, receive_time, cls.SAMPLE_INTERVALS["ill"]
            )
            result["environment"].extend(records)
            result["module_types"].append("ill")

        # 解析温湿度传感器
        if "th" in raw_message:
            records = cls._parse_th_array(
                raw_message["th"],
                station_id, receive_time, cls.SAMPLE_INTERVALS["th"]
            )
            result["environment"].extend(records)
            result["module_types"].append("th")

        return result

    @classmethod
    def _parse_water_module(cls, data_array: List[Dict], field_mapping: Dict[str, str],
                            station_id: str, base_time: datetime,
                            interval_seconds: int) -> List[Dict[str, Any]]:
        """解析水质模块数组"""
        records = []
        for i, item in enumerate(data_array):
            ts = base_time - timedelta(seconds=interval_seconds * (len(data_array) - 1 - i))
            record = {
                "station_id": station_id,
                "ts": ts.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            }
            for src_field, dst_field in field_mapping.items():
                if src_field in item:
                    try:
                        record[dst_field] = float(item[src_field])
                    except (ValueError, TypeError):
                        pass
            records.append(record)
        return records

    @classmethod
    def _parse_scalar_array(cls, data_array: List[float], field_name: str,
                            station_id: str, base_time: datetime,
                            interval_seconds: int) -> List[Dict[str, Any]]:
        """解析标量数组（气压、光照）"""
        records = []
        for i, value in enumerate(data_array):
            ts = base_time - timedelta(seconds=interval_seconds * (len(data_array) - 1 - i))
            record = {
                "station_id": station_id,
                "ts": ts.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                field_name: float(value),
            }
            records.append(record)
        return records

    @classmethod
    def _parse_th_array(cls, data_array: List[Dict], station_id: str,
                        base_time: datetime, interval_seconds: int) -> List[Dict[str, Any]]:
        """解析温湿度数组"""
        records = []
        for i, item in enumerate(data_array):
            ts = base_time - timedelta(seconds=interval_seconds * (len(data_array) - 1 - i))
            record = {
                "station_id": station_id,
                "ts": ts.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            }
            if "t" in item:
                record["temperature"] = float(item["t"])
            if "h" in item:
                record["humidity"] = float(item["h"])
            records.append(record)
        return records

    @classmethod
    def identify_module_type(cls, message: Dict[str, Any]) -> List[str]:
        """识别消息中包含的模块类型"""
        modules = []
        for key in ["m1", "m2", "m3", "m4", "ap", "ill", "th"]:
            if key in message:
                modules.append(key)
        return modules

    @classmethod
    def get_module_label(cls, module_type: str) -> str:
        """获取模块中文标签"""
        labels = {
            "m1": "水质基础(pH/电导率/水温/TDS/盐度)",
            "m2": "营养盐(氨氮/总磷/总氮/CODMn)",
            "m3": "生物(溶解氧/叶绿素/蓝绿藻/浊度)",
            "m4": "水文(透明度/流速/流量/水位)",
            "ap": "气压",
            "ill": "光照",
            "th": "温湿度",
        }
        return labels.get(module_type, module_type)
