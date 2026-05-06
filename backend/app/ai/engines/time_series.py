"""
时序分析引擎
- LSTM 自编码器：异常检测 + 重构误差评估

历史版本曾集成 Prophet 做趋势预测，现已移除：
全站统一到 LSTM AutoEncoder，模型评估改为重构误差分布。
"""
import os
import json
import logging
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
import torch
import torch.nn as nn

from app.ai.config import settings

logger = logging.getLogger(__name__)


class LSTMAutoEncoder(nn.Module):
    """LSTM自编码器"""
    
    def __init__(self, input_size: int, hidden_size: int = 64, num_layers: int = 2):
        super(LSTMAutoEncoder, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        # 编码器
        self.encoder = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0
        )
        
        # 解码器
        self.decoder = nn.LSTM(
            input_size=hidden_size,
            hidden_size=input_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0
        )
    
    def forward(self, x):
        # 编码
        _, (hidden, _) = self.encoder(x)
        
        # 使用最后时刻的隐藏状态作为输入
        decoder_input = hidden[-1].unsqueeze(1).repeat(1, x.size(1), 1)
        
        # 解码
        output, _ = self.decoder(decoder_input)
        
        return output


class TimeSeriesEngine:
    """时序分析引擎"""
    
    # ==================== 阈值配置（默认值，可从数据库加载替换） ====================
    THRESHOLDS = {
        "ph": (6.0, 9.0, "pH值"), "do": (2.0, 20.0, "溶解氧"),
        "nh3_n": (0, 2.0, "氨氮"), "codmn": (0, 15.0, "高锰酸盐指数")
    }
    
    def __init__(self, pg_pool=None):
        self.models = {}  # 存储各站点的 LSTM 模型
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.pg_pool = pg_pool  # PostgreSQL连接池（用于加载阈值配置）
        self._thresholds_cache = {}  # 站点级阈值缓存
        logger.info(f"Using device: {self.device}")
    
    async def load_thresholds(self, station_id: str = None):
        """从数据库加载阈值配置"""
        if not self.pg_pool:
            return
        
        try:
            async with self.pg_pool.acquire() as conn:
                if station_id:
                    # 加载站点级阈值
                    rows = await conn.fetch("""
                        SELECT sm.metric_code, sm.lower_limit, sm.upper_limit, sm.metric_name
                        FROM station_metrics sm
                        JOIN stations s ON sm.station_id = s.id
                        WHERE s.station_code = $1 AND sm.is_enabled = true
                    """, station_id)
                    if rows:
                        self._thresholds_cache[station_id] = {
                            row['metric_code']: (float(row['lower_limit'] or 0), float(row['upper_limit'] or 999), row['metric_name'])
                            for row in rows
                        }
                else:
                    # 加载通用阈值
                    rows = await conn.fetch("""
                        SELECT metric_code, lower_limit, upper_limit, metric_name
                        FROM metric_thresholds
                    """)
                    if rows:
                        self.THRESHOLDS = {
                            row['metric_code']: (float(row['lower_limit'] or 0), float(row['upper_limit'] or 999), row['metric_name'])
                            for row in rows
                        }
                logger.info(f"Loaded thresholds from database{f' for {station_id}' if station_id else ''}")
        except Exception as e:
            logger.warning(f"Failed to load thresholds from database: {e}, using defaults")
    
    def get_thresholds(self, station_id: str = None) -> dict:
        """获取阈值配置（优先站点级，其次通用）"""
        if station_id and station_id in self._thresholds_cache:
            return self._thresholds_cache[station_id]
        return self.THRESHOLDS
    
    def _prepare_sequence(self, data: List[float], seq_length: int) -> np.ndarray:
        """准备序列数据"""
        sequences = []
        for i in range(len(data) - seq_length + 1):
            seq = data[i:i + seq_length]
            sequences.append(seq)
        return np.array(sequences)
    
    def train_anomaly_detector(
        self,
        station_id: str,
        metric: str,
        data: List[Dict[str, Any]],
        epochs: int = 50
    ) -> bool:
        """训练异常检测模型"""
        try:
            # 提取数值
            values = [d.get(metric, 0) for d in data if d.get(metric) is not None]
            
            if len(values) < settings.LSTM_SEQUENCE_LENGTH * 2:
                logger.warning(f"Not enough data to train model for {station_id}/{metric}")
                return False
            
            # 准备训练数据
            sequences = self._prepare_sequence(values, settings.LSTM_SEQUENCE_LENGTH)
            
            # 标准化
            mean = np.mean(sequences)
            std = np.std(sequences)
            if std == 0:
                std = 1
            sequences_normalized = (sequences - mean) / std
            
            # 转换为tensor
            X = torch.FloatTensor(sequences_normalized).unsqueeze(-1).to(self.device)
            
            # 创建模型
            model = LSTMAutoEncoder(
                input_size=1,
                hidden_size=settings.LSTM_HIDDEN_SIZE,
                num_layers=settings.LSTM_NUM_LAYERS
            ).to(self.device)
            
            # 训练
            criterion = nn.MSELoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
            
            model.train()
            for epoch in range(epochs):
                optimizer.zero_grad()
                output = model(X)
                loss = criterion(output, X)
                loss.backward()
                optimizer.step()
                
                if (epoch + 1) % 10 == 0:
                    logger.info(f"Epoch {epoch + 1}/{epochs}, Loss: {loss.item():.4f}")
            
            # 保存模型
            model_key = f"{station_id}_{metric}"
            self.models[model_key] = {
                "model": model,
                "mean": mean,
                "std": std
            }
            
            # 保存到文件
            self._save_model(station_id, metric, model, mean, std)
            
            logger.info(f"Model trained successfully for {station_id}/{metric}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to train model: {e}")
            return False
    
    def _save_model(self, station_id: str, metric: str, model, mean: float, std: float):
        """保存模型"""
        try:
            os.makedirs(settings.MODEL_PATH, exist_ok=True)
            model_key = f"{station_id}_{metric}"
            
            # 保存PyTorch模型
            model_path = os.path.join(settings.MODEL_PATH, f"{model_key}_lstm.pt")
            torch.save(model.state_dict(), model_path)
            
            # 保存归一化参数
            params_path = os.path.join(settings.MODEL_PATH, f"{model_key}_params.json")
            with open(params_path, "w") as f:
                json.dump({"mean": mean, "std": std}, f)
                
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
    
    def load_model(self, station_id: str, metric: str) -> bool:
        """加载模型"""
        try:
            model_key = f"{station_id}_{metric}"
            model_path = os.path.join(settings.MODEL_PATH, f"{model_key}_lstm.pt")
            params_path = os.path.join(settings.MODEL_PATH, f"{model_key}_params.json")
            
            if not os.path.exists(model_path) or not os.path.exists(params_path):
                return False
            
            # 加载参数
            with open(params_path, "r") as f:
                params = json.load(f)
            
            # 创建模型
            model = LSTMAutoEncoder(
                input_size=1,
                hidden_size=settings.LSTM_HIDDEN_SIZE,
                num_layers=settings.LSTM_NUM_LAYERS
            ).to(self.device)
            
            # 加载权重
            model.load_state_dict(torch.load(model_path, map_location=self.device))
            model.eval()
            
            self.models[model_key] = {
                "model": model,
                "mean": params["mean"],
                "std": params["std"]
            }
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
    
    def detect_anomaly(
        self,
        station_id: str,
        metric: str,
        data: List[float]
    ) -> Dict[str, Any]:
        """检测异常"""
        model_key = f"{station_id}_{metric}"
        
        # 检查模型是否存在
        if model_key not in self.models:
            if not self.load_model(station_id, metric):
                # 降级：使用统计阈值方法进行异常检测
                return self._detect_anomaly_statistical(station_id, metric, data)
        
        try:
            model_info = self.models[model_key]
            model = model_info["model"]
            mean = model_info["mean"]
            std = model_info["std"]
            logger.info(f"[FLOW] anomaly_detect_lstm: station={station_id}, metric={metric}, data_len={len(data)}")
            
            # 准备数据
            if len(data) < settings.LSTM_SEQUENCE_LENGTH:
                return {"error": "Not enough data"}
            
            sequence = data[-settings.LSTM_SEQUENCE_LENGTH:]
            sequence_normalized = (np.array(sequence) - mean) / std
            X = torch.FloatTensor(sequence_normalized).unsqueeze(0).unsqueeze(-1).to(self.device)
            
            # 预测
            model.eval()
            with torch.no_grad():
                output = model(X)
            
            # 计算重建误差
            reconstruction = output.cpu().numpy().squeeze()
            error = np.mean((sequence_normalized - reconstruction) ** 2)
            
            # 判断异常
            is_anomaly = error > settings.ANOMALY_THRESHOLD
            logger.info(f"[FLOW] anomaly_detect_lstm_done: station={station_id}, metric={metric}, is_anomaly={is_anomaly}, score={error:.4f}, threshold={settings.ANOMALY_THRESHOLD}")
            
            return {
                "is_anomaly": is_anomaly,
                "anomaly_score": float(error),
                "threshold": settings.ANOMALY_THRESHOLD,
                "metric": metric,
                "station_id": station_id
            }
            
        except Exception as e:
            logger.error(f"Anomaly detection failed: {e}")
            return {"error": str(e)}
    
    def _detect_anomaly_statistical(
        self,
        station_id: str,
        metric: str,
        data: List[float]
    ) -> Dict[str, Any]:
        """基于统计阈值的降级异常检测（无需LSTM模型）"""
        try:
            logger.info(f"[FLOW] anomaly_detect_statistical: station={station_id}, metric={metric}, data_len={len(data)}")
            if len(data) < 3:
                return {"error": "Not enough data for statistical detection"}
            
            arr = np.array(data)
            mean = float(np.mean(arr))
            std = float(np.std(arr))
            
            # 使用IQR + 阈值双重判断
            q1 = float(np.percentile(arr, 25))
            q3 = float(np.percentile(arr, 75))
            iqr = q3 - q1
            
            # 最后一个值作为当前值
            current_value = float(data[-1])
            
            # Z-score判断
            if std > 0:
                z_score = abs(current_value - mean) / std
            else:
                z_score = 0.0
            
            # IQR判断
            iqr_lower = q1 - 1.5 * iqr
            iqr_upper = q3 + 1.5 * iqr
            
            # 阈值判断（使用配置的国标阈值）
            thresholds = self.get_thresholds(station_id)
            threshold_info = thresholds.get(metric)
            threshold_violation = False
            threshold_min = None
            threshold_max = None
            if threshold_info:
                threshold_min, threshold_max, metric_name = threshold_info
                threshold_violation = (current_value < threshold_min or current_value > threshold_max)
            
            is_anomaly = z_score > 2.0 or (current_value < iqr_lower or current_value > iqr_upper) or threshold_violation
            
            # 计算异常分数（0~1范围）
            anomaly_score = min(1.0, z_score / 4.0) if z_score > 0 else 0.0
            
            result = {
                "is_anomaly": bool(is_anomaly),
                "anomaly_score": float(anomaly_score),
                "threshold": float(settings.ANOMALY_THRESHOLD),
                "metric": metric,
                "station_id": station_id,
                "method": "statistical",
                "details": {
                    "z_score": float(z_score),
                    "iqr_range": [float(iqr_lower), float(iqr_upper)],
                    "current_value": current_value,
                    "mean": mean,
                    "std": std
                }
            }
            
            if threshold_info:
                result["details"]["threshold_range"] = [float(threshold_min), float(threshold_max)]
                result["details"]["threshold_violation"] = threshold_violation
            
            logger.info(f"[FLOW] anomaly_detect_statistical_done: station={station_id}, metric={metric}, is_anomaly={is_anomaly}, z_score={z_score:.2f}, threshold_violation={threshold_violation}")
            return result
            
        except Exception as e:
            logger.error(f"Statistical anomaly detection failed: {e}")
            return {"error": str(e)}
    
    def predict(
        self,
        station_id: str,
        metric: str,
        hours: int = None
    ) -> Dict[str, Any]:
        """（已降级）趋势预测占位。

        LSTM AutoEncoder 不做趋势预测，该方法仅保留签名供 predict_risk 等上游调用方降级使用：
        - 如果站点 LSTM 模型未训练→返回 error；
        - 否则返回空 predictions + note，表明请调用 /evaluation/reconstruction 评估模型。
        """
        if hours is None:
            hours = settings.PREDICTION_HORIZON
        if station_id not in self.models and not self.load_station_model(station_id):
            return {"error": "LSTM station model not trained"}
        return {
            "station_id": station_id,
            "metric": metric,
            "predictions": [],
            "horizon_hours": hours,
            "backend": "lstm_autoencoder",
            "note": "LSTM AutoEncoder 不支持趋势预测；请使用 /ai/evaluation/reconstruction 做重构误差评估。",
        }

    def evaluate_reconstruction(
        self,
        station_id: str,
        metric: str,
        data: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """使用站点级 LSTM AE 对一段历史数据滑窗重构，返回每时刻的实际值/重构值/误差 + 整体统计。

        数据要求：List[Dict]，每条含 `ts` 以及训练时用到的全部指标字段（缺值行会跳过）。
        返回结构：
          { station_id, metric, metrics_trained, series:[{timestamp, actual, reconstructed, error}],
            stats:{ mean_error, p95_error, max_error, anomaly_threshold, anomaly_count, sample_count } }
        """
        if station_id not in self.models and not self.load_station_model(station_id):
            return {"error": "Station model not found. Train it on Tab 1 first."}
        entry = self.models[station_id]
        metrics: List[str] = entry["metrics"]
        means = np.array(entry["means"], dtype=np.float32)
        stds = np.array(entry["stds"], dtype=np.float32)
        model = entry["model"]

        if metric not in metrics:
            return {
                "error": f"Metric '{metric}' is not in trained metrics {metrics}. Retrain with this metric."
            }
        metric_idx = metrics.index(metric)

        # 构造数据矩阵
        rows: List[List[float]] = []
        timestamps: List[str] = []
        for d in data:
            row: List[float] = []
            missing = False
            for m in metrics:
                v = d.get(m)
                if v is None:
                    missing = True
                    break
                try:
                    row.append(float(v))
                except (TypeError, ValueError):
                    missing = True
                    break
            if missing:
                continue
            ts = d.get("ts") or d.get("timestamp") or ""
            # 标准化时间字符串
            if isinstance(ts, datetime):
                ts = ts.isoformat()
            rows.append(row)
            timestamps.append(str(ts))

        seq_len = settings.LSTM_SEQUENCE_LENGTH
        if len(rows) < seq_len:
            return {
                "error": f"Not enough samples: got {len(rows)}, need >= {seq_len}. 请拉更长的历史窗口或补全缺失指标。"
            }

        matrix = np.array(rows, dtype=np.float32)  # (N, F)
        normalized = (matrix - means) / stds  # (N, F)

        # 滑动窗口批量重构
        N = len(rows)
        windows = np.stack(
            [normalized[i : i + seq_len] for i in range(N - seq_len + 1)]
        )  # (B, seq_len, F)
        with torch.no_grad():
            model.eval()
            X = torch.FloatTensor(windows).to(self.device)
            Y = model(X).cpu().numpy()  # (B, seq_len, F)

        Y_denorm = Y * stds + means  # (B, seq_len, F)

        # 对每个位置聚合所有覆盖窗口的重构值（均值）
        rec_sum = np.zeros_like(matrix, dtype=np.float64)
        rec_count = np.zeros(N, dtype=np.int32)
        for b in range(Y_denorm.shape[0]):
            for t in range(seq_len):
                pos = b + t
                rec_sum[pos] += Y_denorm[b, t]
                rec_count[pos] += 1
        rec_count_safe = np.where(rec_count == 0, 1, rec_count)[:, None]
        reconstructions = rec_sum / rec_count_safe

        actual_vec = matrix[:, metric_idx]
        rec_vec = reconstructions[:, metric_idx]
        err_vec = np.abs(actual_vec - rec_vec)
        valid_mask = rec_count > 0

        series: List[Dict[str, Any]] = []
        for i in range(N):
            if not valid_mask[i]:
                continue
            series.append({
                "timestamp": timestamps[i],
                "actual": round(float(actual_vec[i]), 4),
                "reconstructed": round(float(rec_vec[i]), 4),
                "error": round(float(err_vec[i]), 4),
            })

        valid_errs = err_vec[valid_mask]
        if valid_errs.size == 0:
            return {"error": "No valid reconstruction samples produced."}
        mean_err = float(valid_errs.mean())
        max_err = float(valid_errs.max())
        p95_err = float(np.percentile(valid_errs, 95))
        std_err = float(valid_errs.std() or 0.0)
        anomaly_threshold = mean_err + 2.0 * std_err
        anomaly_count = int((valid_errs > anomaly_threshold).sum())
        sample_count = int(valid_mask.sum())

        # ============ 智能分析 analysis ============
        actual_valid = actual_vec[valid_mask]
        rec_valid = rec_vec[valid_mask]
        actual_mean = float(np.abs(actual_valid).mean()) or 1e-9
        actual_abs_mean = max(actual_mean, 1e-9)

        # 1) 拟合质量评级
        rel_err = mean_err / actual_abs_mean
        if rel_err < 0.02:
            quality, quality_label = "excellent", "优秀"
            quality_score = int(round(95 - min(rel_err / 0.02, 1.0) * 5))
        elif rel_err < 0.05:
            quality, quality_label = "good", "良好"
            quality_score = int(round(90 - (rel_err - 0.02) / 0.03 * 15))
        elif rel_err < 0.10:
            quality, quality_label = "fair", "一般"
            quality_score = int(round(75 - (rel_err - 0.05) / 0.05 * 20))
        else:
            quality, quality_label = "poor", "较差"
            quality_score = int(round(max(10, 55 - (rel_err - 0.10) * 100)))

        # 2) 稳定性（p95 / mean 比值）
        spike_ratio = float(p95_err / mean_err) if mean_err > 0 else 1.0
        if spike_ratio > 3.0:
            stability, stability_label = "spiky", "尖峰明显"
        elif spike_ratio > 2.0:
            stability, stability_label = "moderate", "有小波动"
        else:
            stability, stability_label = "stable", "平稳"

        # 3) 异常占比
        anomaly_ratio = anomaly_count / max(sample_count, 1)

        # 4) 偏离方向（actual 整体偏高还是偏低）
        signed_diff = float((actual_valid - rec_valid).mean())
        bias_pct = signed_diff / actual_abs_mean
        if bias_pct > 0.01:
            bias, bias_label = "higher", "偏高"
        elif bias_pct < -0.01:
            bias, bias_label = "lower", "偏低"
        else:
            bias, bias_label = "balanced", "均衡"

        # 5) 异常时段：连续超阈点合并为段，取 peak_error top 3
        segments: List[Dict[str, Any]] = []
        valid_indices = np.where(valid_mask)[0]
        cur_seg: Optional[Dict[str, Any]] = None
        for idx_pos, orig_idx in enumerate(valid_indices):
            err = float(err_vec[orig_idx])
            if err > anomaly_threshold:
                if cur_seg is None:
                    cur_seg = {
                        "start": timestamps[orig_idx],
                        "end": timestamps[orig_idx],
                        "peak_error": err,
                        "count": 1,
                    }
                else:
                    cur_seg["end"] = timestamps[orig_idx]
                    cur_seg["peak_error"] = max(cur_seg["peak_error"], err)
                    cur_seg["count"] += 1
            else:
                if cur_seg is not None:
                    segments.append(cur_seg)
                    cur_seg = None
        if cur_seg is not None:
            segments.append(cur_seg)
        worst_segments = sorted(segments, key=lambda s: s["peak_error"], reverse=True)[:3]
        for seg in worst_segments:
            seg["peak_error"] = round(float(seg["peak_error"]), 4)

        # 6) 结论文案
        conclusion = (
            f"模型对站点 {station_id} 的 {metric} 指标拟合质量为「{quality_label}」（评分 {quality_score}），"
            f"平均重构误差 {mean_err:.4f}，占均值的 {rel_err * 100:.2f}%；误差分布「{stability_label}」（P95/均值={spike_ratio:.2f}）。"
            f"最近窗口实际值整体「{bias_label}」（偏离 {bias_pct * 100:+.2f}%），共检出 {anomaly_count} 个异常点，占样本的 {anomaly_ratio * 100:.2f}%。"
        )

        # 7) 建议
        suggestions: List[str] = []
        if quality == "poor":
            suggestions.append("拟合质量较差，建议在「站点模型绑定」Tab 用最新历史重新训练该站点模型。")
        elif quality == "fair":
            suggestions.append("拟合质量一般，建议略过一段时间后重训或增加训练样本。")
        if stability == "spiky":
            suggestions.append("误差存在尖峰，重点核查「异常时段」列出的窗口是否对应真实突发事件。")
        if anomaly_ratio > 0.10:
            suggestions.append(
                f"异常点占比偏高（{anomaly_ratio * 100:.1f}%），可能数据已发生偏移，建议排查传感器或重训模型。"
            )
        if bias != "balanced" and abs(bias_pct) > 0.03:
            suggestions.append(
                f"整体 {bias_label} 模型学到的正常水平（{bias_pct * 100:+.2f}%），需确认是季节性还是持续偏移。"
            )
        if sample_count < seq_len * 2:
            suggestions.append(
                f"有效样本 {sample_count} 点偏少，评估结果置信度有限，建议拉更长的历史窗口。"
            )
        if not suggestions:
            suggestions.append("模型表现良好，维持当前训练策略即可。")

        analysis = {
            "quality": quality,
            "quality_label": quality_label,
            "quality_score": quality_score,
            "rel_error": round(rel_err, 4),
            "stability": stability,
            "stability_label": stability_label,
            "spike_ratio": round(spike_ratio, 2),
            "anomaly_ratio": round(anomaly_ratio, 4),
            "bias": bias,
            "bias_label": bias_label,
            "bias_pct": round(bias_pct, 4),
            "worst_segments": worst_segments,
            "conclusion": conclusion,
            "suggestions": suggestions,
        }

        return {
            "station_id": station_id,
            "metric": metric,
            "metrics_trained": metrics,
            "series": series,
            "stats": {
                "mean_error": round(mean_err, 4),
                "p95_error": round(p95_err, 4),
                "max_error": round(max_err, 4),
                "anomaly_threshold": round(anomaly_threshold, 4),
                "anomaly_count": anomaly_count,
                "sample_count": sample_count,
            },
            "analysis": analysis,
        }
    
    # ==================== 站点级模型（一站一模型，多变量） ====================
    def train_station_model(
        self,
        station_id: str,
        metrics: List[str],
        data: List[Dict[str, Any]],
        epochs: int = 50,
    ) -> Dict[str, Any]:
        """训练站点级多变量 LSTM 自编码器模型。

        - input_size = len(metrics)，每个指标作为一个输入通道；
        - 每个指标独立做标准化（各自 mean/std）；
        - 模型文件与参数统一以 station_id 为前缀。
        """
        try:
            if not metrics:
                return {"success": False, "error": "metrics is empty"}

            # 构建 N x F 矩阵
            rows: List[List[float]] = []
            for d in data:
                row = []
                missing = False
                for m in metrics:
                    v = d.get(m)
                    if v is None:
                        missing = True
                        break
                    row.append(float(v))
                if not missing:
                    rows.append(row)

            seq_len = settings.LSTM_SEQUENCE_LENGTH
            if len(rows) < seq_len * 2:
                return {
                    "success": False,
                    "error": f"Not enough samples: got {len(rows)}, need >= {seq_len * 2}",
                    "samples": len(rows),
                }

            matrix = np.array(rows, dtype=np.float32)  # (N, F)
            # 逐指标归一化
            means = matrix.mean(axis=0)
            stds = matrix.std(axis=0)
            stds = np.where(stds == 0, 1.0, stds)
            normalized = (matrix - means) / stds  # (N, F)

            # 滑动窗口切分成序列
            sequences = np.stack(
                [normalized[i : i + seq_len] for i in range(len(normalized) - seq_len + 1)]
            )  # (B, seq_len, F)
            X = torch.FloatTensor(sequences).to(self.device)

            # 模型
            model = LSTMAutoEncoder(
                input_size=len(metrics),
                hidden_size=settings.LSTM_HIDDEN_SIZE,
                num_layers=settings.LSTM_NUM_LAYERS,
            ).to(self.device)
            criterion = nn.MSELoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

            model.train()
            final_loss = 0.0
            for epoch in range(epochs):
                optimizer.zero_grad()
                output = model(X)
                loss = criterion(output, X)
                loss.backward()
                optimizer.step()
                final_loss = float(loss.item())
                if (epoch + 1) % 10 == 0:
                    logger.info(f"[station_model:{station_id}] Epoch {epoch + 1}/{epochs}, Loss: {final_loss:.4f}")

            # 缓存
            self.models[station_id] = {
                "model": model,
                "metrics": list(metrics),
                "means": means.tolist(),
                "stds": stds.tolist(),
                "kind": "station_model",
            }

            # 落盘
            os.makedirs(settings.MODEL_PATH, exist_ok=True)
            model_file = f"{station_id}_station_lstm.pt"
            params_file = f"{station_id}_station_meta.json"
            torch.save(model.state_dict(), os.path.join(settings.MODEL_PATH, model_file))
            with open(os.path.join(settings.MODEL_PATH, params_file), "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "metrics": list(metrics),
                        "means": means.tolist(),
                        "stds": stds.tolist(),
                        "epochs": epochs,
                        "final_loss": final_loss,
                        "samples": len(rows),
                    },
                    f,
                    ensure_ascii=False,
                )

            logger.info(
                f"[station_model:{station_id}] trained OK, metrics={metrics}, samples={len(rows)}, loss={final_loss:.4f}"
            )
            return {
                "success": True,
                "final_loss": final_loss,
                "samples": len(rows),
                "metrics": list(metrics),
                "model_file": model_file,
                "params_file": params_file,
            }

        except Exception as e:
            logger.exception(f"[station_model:{station_id}] training failed: {e}")
            return {"success": False, "error": str(e)}

    def load_station_model(self, station_id: str) -> bool:
        """从磁盘加载站点级模型"""
        try:
            model_path = os.path.join(settings.MODEL_PATH, f"{station_id}_station_lstm.pt")
            meta_path = os.path.join(settings.MODEL_PATH, f"{station_id}_station_meta.json")
            if not (os.path.exists(model_path) and os.path.exists(meta_path)):
                return False
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            metrics = meta.get("metrics") or []
            if not metrics:
                return False
            model = LSTMAutoEncoder(
                input_size=len(metrics),
                hidden_size=settings.LSTM_HIDDEN_SIZE,
                num_layers=settings.LSTM_NUM_LAYERS,
            ).to(self.device)
            model.load_state_dict(torch.load(model_path, map_location=self.device))
            model.eval()
            self.models[station_id] = {
                "model": model,
                "metrics": metrics,
                "means": meta.get("means") or [0.0] * len(metrics),
                "stds": meta.get("stds") or [1.0] * len(metrics),
                "kind": "station_model",
            }
            return True
        except Exception as e:
            logger.error(f"Failed to load station model {station_id}: {e}")
            return False

    # ==================== 核心方法：混合异常检测 ====================
    def detect_anomaly_core(self, data: Dict[str, float], history: List[float] = None, model = None, station_id: str = None) -> Dict[str, Any]:
        """混合异常检测：阈值筛选 + LSTM深度分析"""
        # 1. 获取阈值配置（优先站点级）
        thresholds = self.get_thresholds(station_id)
        # 2. 阈值快速筛选
        anomalies = [{"metric": m, "value": v, "name": thresholds[m][2]} for m, v in data.items()
                     if m in thresholds and not (thresholds[m][0] <= v <= thresholds[m][1])]
        # 3. LSTM深度分析（有历史数据和模型时）
        lstm_score = 0.0
        if history and model:
            seq = torch.FloatTensor(history).unsqueeze(0).unsqueeze(-1).to(self.device)
            with torch.no_grad():
                lstm_score = float(torch.mean((seq - model(seq)) ** 2))
        # 4. 综合判断
        return {"anomalies": anomalies, "lstm_score": round(lstm_score, 4),
                "is_anomaly": len(anomalies) > 0 or lstm_score > 0.1}
