"""
API Gateway - 统一入口
"""
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
import time
import logging

from app.config import settings, SERVICE_ROUTES
from app.router import get_service_url
from app.middleware.logging import LoggingMiddleware

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 创建FastAPI应用
app = FastAPI(
    title="水环境AI监测平台 - API网关",
    description="统一API入口，负责请求路由",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# 添加中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(LoggingMiddleware)

# HTTP客户端
http_client = httpx.AsyncClient(timeout=60.0, proxy=None)


@app.on_event("startup")
async def startup():
    """启动事件"""
    logger.info(f"API Gateway started on port {settings.SERVICE_PORT}")


@app.on_event("shutdown")
async def shutdown():
    """关闭事件"""
    await http_client.aclose()
    logger.info("API Gateway shutdown")


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "service": settings.SERVICE_NAME,
        "timestamp": time.time()
    }


@app.get("/api/v1/services")
async def list_services():
    """列出所有可用的服务"""
    return {
        "services": {
            name: {"url": url, "status": "unknown"}
            for name, url in SERVICE_ROUTES.items()
        }
    }


async def proxy_request(request: Request, service_url: str, path: str) -> Response:
    """代理请求到下游服务"""
    # 构建目标URL
    url = f"{service_url}{path}"
    
    # 获取请求方法和内容
    method = request.method
    headers = dict(request.headers)
    
    # 移除host头，避免冲突
    headers.pop("host", None)
    
    # 获取查询参数
    params = dict(request.query_params)
    
    # 获取请求体
    body = await request.body()
    
    try:
        # 发送请求
        response = await http_client.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            content=body,
            follow_redirects=True
        )
        
        # 返回响应
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers)
        )
    except httpx.ConnectError as e:
        logger.error(f"Service connection error: {e}")
        raise HTTPException(status_code=503, detail=f"Service unavailable: {e}")
    except httpx.TimeoutException:
        logger.error("Service timeout")
        raise HTTPException(status_code=504, detail="Service timeout")
    except Exception as e:
        logger.error(f"Proxy error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal error: {e}")


# 动态路由 - 代理到各个服务
@app.api_route("/api/v1/stations", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/stations/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def stations_proxy(request: Request, path: str = ""):
    """站点服务代理"""
    service_url = SERVICE_ROUTES["stations"]
    full_path = f"/api/v1/stations/{path}" if path else "/api/v1/stations"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/data", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/data/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def data_proxy(request: Request, path: str = ""):
    """数据服务代理"""
    service_url = SERVICE_ROUTES["data"]
    full_path = f"/api/v1/data/{path}" if path else "/api/v1/data"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/mqtt", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/mqtt/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def mqtt_proxy(request: Request, path: str = ""):
    """MQTT管理服务代理（转发到数据服务）"""
    service_url = SERVICE_ROUTES["data"]
    full_path = f"/api/v1/mqtt/{path}" if path else "/api/v1/mqtt"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/alerts", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/alerts/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def alerts_proxy(request: Request, path: str = ""):
    """预警服务代理"""
    service_url = SERVICE_ROUTES["alerts"]
    full_path = f"/api/v1/alerts/{path}" if path else "/api/v1/alerts"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/analysis", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/analysis/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def analysis_proxy(request: Request, path: str = ""):
    """AI分析服务代理"""
    service_url = SERVICE_ROUTES["analysis"]
    full_path = f"/api/v1/analysis/{path}" if path else "/api/v1/analysis"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/ai", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/ai/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def ai_proxy(request: Request, path: str = ""):
    """AI引擎服务代理"""
    service_url = SERVICE_ROUTES["analysis"]
    full_path = f"/api/v1/ai/{path}" if path else "/api/v1/ai"
    return await proxy_request(request, service_url, full_path)


@app.api_route("/api/v1/reports", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/v1/reports/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def reports_proxy(request: Request, path: str = ""):
    """报告服务代理"""
    service_url = SERVICE_ROUTES["reports"]
    full_path = f"/api/v1/reports/{path}" if path else "/api/v1/reports"
    return await proxy_request(request, service_url, full_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.SERVICE_PORT)
