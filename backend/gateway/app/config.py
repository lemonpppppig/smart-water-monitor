"""
网关配置
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """应用配置"""
    # 服务配置
    SERVICE_NAME: str = "gateway"
    SERVICE_PORT: int = 8000
    DEBUG: bool = False
    
    # 下游服务地址
    STATION_SERVICE_URL: str = "http://localhost:8001"
    DATA_SERVICE_URL: str = "http://localhost:8002"
    ALERT_SERVICE_URL: str = "http://localhost:8003"
    AI_ENGINE_URL: str = "http://localhost:8004"
    REPORT_SERVICE_URL: str = "http://localhost:8005"
    
    # 限流配置
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW: int = 60
    
    class Config:
        env_file = ".env"


settings = Settings()

# 服务路由映射
SERVICE_ROUTES = {
    "stations": settings.STATION_SERVICE_URL,
    "data": settings.DATA_SERVICE_URL,
    "alerts": settings.ALERT_SERVICE_URL,
    "analysis": settings.AI_ENGINE_URL,
    "reports": settings.REPORT_SERVICE_URL,
}
