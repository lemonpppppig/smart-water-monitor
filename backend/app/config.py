"""
统一应用配置 - 合并所有微服务配置
"""
import os
from pathlib import Path

from pydantic_settings import BaseSettings


def _detect_region() -> str:
    """自动检测 regions/ 目录下可用的区域（排除 _common），取第一个。"""
    env_val = os.getenv("REGION_CODE")
    if env_val:
        return env_val
    # backend/ 的父目录即项目根
    project_root = Path(__file__).resolve().parent.parent.parent
    regions_dir = project_root / "regions"
    if regions_dir.exists():
        candidates = sorted(
            d.name for d in regions_dir.iterdir()
            if d.is_dir() and not d.name.startswith("_")
        )
        if candidates:
            return candidates[0]
    return "nanchang"


class Settings(BaseSettings):
    """应用配置"""
    # 区域配置（自动检测 regions/ 目录，运行时被 backend/.env 覆盖）
    REGION_CODE: str = _detect_region()

    # 服务配置
    SERVICE_NAME: str = "water-env-backend"
    SERVICE_PORT: int = 8000
    DEBUG: bool = False

    # PostgreSQL 数据库配置（station / alert / report / ai 共用）
    DATABASE_URL: str = "postgresql+asyncpg://water:water123@localhost:5432/water_env"

    # TDengine 时序数据库配置（data / ai 共用）
    TDENGINE_HOST: str = "localhost"
    TDENGINE_PORT: int = 6041
    TDENGINE_USER: str = "root"
    TDENGINE_PASSWORD: str = "taosdata"
    TDENGINE_DATABASE: str = "water_env"

    # Neo4j 图数据库配置（station / ai 共用）
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "water123"

    # Redis 配置
    REDIS_URL: str = "redis://localhost:6379"

    # MQTT 配置（data / alert / ai 共用）
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_CLIENT_ID: str = "water-env-backend"

    # 外部 MQTT 数据源默认配置
    EXTERNAL_MQTT_HOST: str = "120.77.155.186"
    EXTERNAL_MQTT_PORT: int = 1883
    EXTERNAL_MQTT_TOPIC: str = "water_environment/sensors/data"
    EXTERNAL_MQTT_USERNAME: str = "user_slhj_05"
    EXTERNAL_MQTT_PASSWORD: str = "user_slhj_05"

    # 数据预处理配置
    DATA_RETENTION_DAYS: int = 365
    BATCH_SIZE: int = 1000

    # 预警规则检查间隔（秒）
    RULE_CHECK_INTERVAL: int = 60

    # AI 模型配置
    MODEL_PATH: str = "/app/models"
    LSTM_SEQUENCE_LENGTH: int = 24
    LSTM_HIDDEN_SIZE: int = 64
    LSTM_NUM_LAYERS: int = 2
    PREDICTION_HORIZON: int = 72
    ANOMALY_THRESHOLD: float = 0.95

    # 报告配置
    REPORT_OUTPUT_PATH: str = "/app/reports"
    REPORT_TEMPLATE_PATH: str = "/app/templates"
    REPORT_RETENTION_DAYS: int = 365

    # 内部服务 URL（单体模式下指向自身，兼容原微服务调用方式）
    DATA_SERVICE_URL: str = "http://localhost:8000"
    ALERT_SERVICE_URL: str = "http://localhost:8000"
    AI_ENGINE_URL: str = "http://localhost:8000"
    REPORT_SERVICE_URL: str = "http://localhost:8000"
    STATION_SERVICE_URL: str = "http://localhost:8000"

    # JWT 配置（原 gateway）
    JWT_SECRET: str = "water_env_secret_key_change_in_production"

    # 限流配置
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW: int = 60

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
