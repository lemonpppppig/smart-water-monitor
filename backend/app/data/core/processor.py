"""
数据预处理模块
- 异常值检测
- 缺失值填充
- 数据聚合
- 衍生指标计算
"""
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from sklearn.ensemble import IsolationForest
import logging

logger = logging.getLogger(__name__)


class DataProcessor:
    """数据处理器"""
    
    # 各指标的合理范围（用于异常值检测）
    METRIC_RANGES = {
        "ph": (0, 14),
        "do": (0, 20),           # 溶解氧 mg/L
        "nh3_n": (0, 100),       # 氨氮 mg/L
        "codmn": (0, 200),       # 高锰酸盐指数 mg/L
        "turbidity": (0, 1000),  # 浊度 NTU
        "conductivity": (0, 10000),  # 电导率 μS/cm
        "chlorophyll": (0, 500),     # 叶绿素 μg/L
        "blue_green_algae": (0, 10000000),  # 蓝绿藻 cells/mL
        "total_n": (0, 100),     # 总氮 mg/L
        "total_p": (0, 50),      # 总磷 mg/L
        "codcr": (0, 500),       # 化学需氧量 mg/L
        "transparency": (0, 200),    # 透明度 cm
        "orp": (-500, 500),      # 氧化还原电位 mV
        "water_temperature": (-10, 50),  # 水温 °C
    }
    
    def __init__(self):
        self.isolation_forest = IsolationForest(
            contamination=0.05,  # 假设5%的数据是异常的
            random_state=42,
            n_estimators=100
        )
    
    def validate_data(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """验证数据有效性"""
        errors = []
        
        # 检查必需字段
        if not data.get("station_id"):
            errors.append("Missing station_id")
        
        if not data.get("ts"):
            errors.append("Missing timestamp")
        
        # 检查数值范围
        for metric, (min_val, max_val) in self.METRIC_RANGES.items():
            value = data.get(metric)
            if value is not None:
                if not isinstance(value, (int, float)):
                    errors.append(f"{metric} must be numeric")
                elif value < min_val or value > max_val:
                    errors.append(f"{metric} out of range [{min_val}, {max_val}]")
        
        return len(errors) == 0, errors
    
    def detect_outliers(self, data: List[Dict[str, Any]], metric: str) -> List[int]:
        """使用孤立森林检测异常值"""
        values = [d.get(metric) for d in data if d.get(metric) is not None]
        
        if len(values) < 10:  # 数据量太小，跳过检测
            return []
        
        try:
            X = np.array(values).reshape(-1, 1)
            predictions = self.isolation_forest.fit_predict(X)
            # 返回异常值的索引
            outlier_indices = [i for i, pred in enumerate(predictions) if pred == -1]
            return outlier_indices
        except Exception as e:
            logger.error(f"Outlier detection failed: {e}")
            return []
    
    def detect_outliers_iqr(self, data: List[float]) -> List[int]:
        """使用IQR方法检测异常值"""
        if len(data) < 4:
            return []
        
        q1 = np.percentile(data, 25)
        q3 = np.percentile(data, 75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        outlier_indices = []
        for i, value in enumerate(data):
            if value < lower_bound or value > upper_bound:
                outlier_indices.append(i)
        
        return outlier_indices
    
    def fill_missing_values(self, df: pd.DataFrame, method: str = "linear") -> pd.DataFrame:
        """填充缺失值"""
        numeric_columns = df.select_dtypes(include=[np.number]).columns
        
        for col in numeric_columns:
            if df[col].isnull().sum() > 0:
                if method == "linear":
                    # 线性插值
                    df[col] = df[col].interpolate(method="linear", limit_direction="both")
                elif method == "forward":
                    # 前向填充
                    df[col] = df[col].fillna(method="ffill").fillna(method="bfill")
                elif method == "mean":
                    # 均值填充
                    df[col] = df[col].fillna(df[col].mean())
                elif method == "median":
                    # 中位数填充
                    df[col] = df[col].fillna(df[col].median())
        
        return df
    
    def aggregate_data(
        self,
        df: pd.DataFrame,
        freq: str = "1H",
        aggregation: Dict[str, str] = None
    ) -> pd.DataFrame:
        """数据聚合
        
        Args:
            df: 数据DataFrame，必须包含ts列
            freq: 聚合频率，如 '1H', '1D'
            aggregation: 各字段的聚合方式，如 {"ph": "mean", "do": "mean"}
        """
        if "ts" not in df.columns:
            raise ValueError("DataFrame must contain 'ts' column")
        
        df["ts"] = pd.to_datetime(df["ts"])
        df.set_index("ts", inplace=True)
        
        # 默认聚合方式
        if aggregation is None:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            aggregation = {col: "mean" for col in numeric_cols}
        
        # 执行聚合
        aggregated = df.resample(freq).agg(aggregation)
        aggregated.reset_index(inplace=True)
        
        return aggregated
    
    def calculate_derived_metrics(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """计算衍生指标"""
        derived = {}
        
        # 计算溶解氧饱和度（简化公式）
        if data.get("do") and data.get("water_temperature"):
            temp = data["water_temperature"]
            do = data["do"]
            # 饱和溶解氧近似公式
            do_sat = 14.652 - 0.41022 * temp + 0.007991 * temp**2 - 0.000077774 * temp**3
            derived["do_saturation"] = round((do / do_sat) * 100, 2)
        
        # 计算营养状态指数（TLI）
        if data.get("total_n") and data.get("total_p") and data.get("chlorophyll"):
            tn = data["total_n"]
            tp = data["total_p"]
            chla = data["chlorophyll"]
            
            # 简化版TLI计算
            tli_chla = 25.0 + 10.9 * (chla ** 0.5) if chla > 0 else 10
            tli_tp = 96.0 - 32.0 * (tp ** -0.5) if tp > 0 else 10
            tli_tn = 54.0 + 16.5 * (tn ** 0.5) if tn > 0 else 10
            
            tli = (tli_chla * 0.5 + tli_tp * 0.25 + tli_tn * 0.25)
            derived["tli"] = round(tli, 2)
            
            # 营养等级
            if tli < 30:
                derived["trophic_level"] = "oligotrophic"
            elif tli < 50:
                derived["trophic_level"] = "mesotrophic"
            elif tli < 60:
                derived["trophic_level"] = "light_eutrophic"
            elif tli < 70:
                derived["trophic_level"] = "moderate_eutrophic"
            else:
                derived["trophic_level"] = "severe_eutrophic"
        
        # 水质等级（基于pH的简单判断）
        if data.get("ph"):
            ph = data["ph"]
            if 6.5 <= ph <= 8.5:
                derived["ph_level"] = "normal"
            elif ph < 6.5:
                derived["ph_level"] = "acidic"
            else:
                derived["ph_level"] = "alkaline"
        
        return derived
    
    def process_data_point(self, data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        """处理单条数据点"""
        # 验证数据
        is_valid, errors = self.validate_data(data)
        
        if not is_valid:
            return data, errors
        
        # 计算衍生指标
        derived = self.calculate_derived_metrics(data)
        data["derived"] = derived
        
        # 标记数据质量
        data["data_quality"] = "good"
        
        return data, []
    
    def clean_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """清理DataFrame"""
        # 移除完全重复的行
        df = df.drop_duplicates()
        
        # 按时间排序
        if "ts" in df.columns:
            df["ts"] = pd.to_datetime(df["ts"])
            df = df.sort_values("ts")
        
        # 填充缺失值
        df = self.fill_missing_values(df)
        
        return df
