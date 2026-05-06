"""
限流中间件
"""
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import time
from collections import defaultdict
from app.config import settings


class RateLimiter:
    """简单内存限流器"""
    
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
    
    def is_allowed(self, key: str) -> bool:
        """检查是否允许请求"""
        now = time.time()
        window_start = now - self.window_seconds
        
        # 清理过期请求记录
        self.requests[key] = [ts for ts in self.requests[key] if ts > window_start]
        
        # 检查是否超过限制
        if len(self.requests[key]) >= self.max_requests:
            return False
        
        # 记录本次请求
        self.requests[key].append(now)
        return True


# 创建限流器实例
rate_limiter = RateLimiter(
    max_requests=settings.RATE_LIMIT_REQUESTS,
    window_seconds=settings.RATE_LIMIT_WINDOW
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """限流中间件"""
    
    async def dispatch(self, request: Request, call_next):
        # 使用IP地址作为限流键
        client_ip = request.client.host if request.client else "unknown"
        
        if not rate_limiter.is_allowed(client_ip):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        response = await call_next(request)
        return response
