"""
认证中间件
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from jose import JWTError, jwt
from datetime import datetime, timedelta
from app.config import settings

# 公开路径（不需要认证）
PUBLIC_PATHS = [
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
    "/api/v1/auth",
    "/api/v1/services",
    "/api/v1/ai",  # AI图谱数据查询接口
    "/api/v1/stations",  # 站点数据查询
    "/api/v1/alerts",  # 预警数据查询
    "/api/v1/data",  # 数据查询
    "/api/v1/reports",  # 报告查询
]


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """创建JWT令牌"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> dict:
    """解码JWT令牌"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def is_public_path(path: str) -> bool:
    """检查是否为公开路径"""
    for public_path in PUBLIC_PATHS:
        if path.startswith(public_path):
            return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件"""
    
    def _create_cors_response(self, status_code: int, content: dict):
        """创建带 CORS 头的响应"""
        return JSONResponse(
            status_code=status_code,
            content=content,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
    
    async def dispatch(self, request: Request, call_next):
        # 处理 OPTIONS 预检请求
        if request.method == "OPTIONS":
            return self._create_cors_response(200, {})
        
        # 检查是否为公开路径
        if is_public_path(request.url.path):
            return await call_next(request)
        
        # 获取Authorization头
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return self._create_cors_response(
                401, {"detail": "Missing authorization header"}
            )
        
        # 解析Bearer令牌
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return self._create_cors_response(
                401, {"detail": "Invalid authorization header format"}
            )
        
        token = parts[1]
        payload = decode_token(token)
        
        if payload is None:
            return self._create_cors_response(
                401, {"detail": "Invalid or expired token"}
            )
        
        # 将用户信息存入请求状态
        request.state.user = payload
        
        # 继续处理请求
        response = await call_next(request)
        return response
