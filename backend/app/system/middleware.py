"""操作日志中间件：记录非 GET 请求的操作"""
import logging
import time
from typing import Iterable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.system.database import AsyncSessionLocal
from app.system.security import decode_access_token
from app.system.services import LogService


logger = logging.getLogger(__name__)


# ==================== 辅助映射 ====================
MODULE_MAP = [
    ("/api/v1/stations", "station"),
    ("/api/v1/data/mqtt", "mqtt"),
    ("/api/v1/data", "data"),
    ("/api/v1/alerts", "alert"),
    ("/api/v1/ai/graph-admin", "graph_admin"),
    ("/api/v1/ai", "ai"),
    ("/api/v1/reports", "report"),
    ("/api/v1/notifications", "notification"),
    ("/api/v1/system/users", "user"),
    ("/api/v1/system/roles", "role"),
    ("/api/v1/system/logs", "log"),
    ("/api/v1/auth", "auth"),
]


def _resolve_module(path: str) -> Optional[str]:
    for prefix, name in MODULE_MAP:
        if path.startswith(prefix):
            return name
    return None


def _action_name(method: str, module: Optional[str], path: str) -> str:
    action_cn = {"POST": "创建", "PUT": "更新", "PATCH": "更新", "DELETE": "删除"}.get(method, method)
    if path.endswith("/batch-delete"):
        action_cn = "批量删除"
    elif path.endswith("/deploy"):
        action_cn = "部署"
    elif path.endswith("/undeploy"):
        action_cn = "下线"
    return f"{action_cn}{module or ''}".strip()


class OperationLogMiddleware(BaseHTTPMiddleware):
    """记录写操作（POST/PUT/PATCH/DELETE）到 sys_operation_logs。
    跳过登录接口（auth.py 内部已记录），跳过纯 GET 请求。"""

    SKIP_PATHS: Iterable[str] = (
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/health",
        "/docs",
        "/openapi.json",
        "/redoc",
    )

    async def dispatch(self, request: Request, call_next):
        method = request.method.upper()
        path = request.url.path

        # 仅记录写操作 + 不记录认证接口（auth.py 自行记录）
        should_log = (
            method in ("POST", "PUT", "PATCH", "DELETE")
            and not any(path.startswith(p) for p in self.SKIP_PATHS)
            and path.startswith("/api/v1/")
        )

        start = time.time()
        try:
            response: Response = await call_next(request)
        except Exception:
            duration = int((time.time() - start) * 1000)
            if should_log:
                await self._record(request, path, method, 500, duration, success=False)
            raise

        if should_log:
            duration = int((time.time() - start) * 1000)
            await self._record(request, path, method, response.status_code, duration, success=response.status_code < 400)
        return response

    async def _record(self, request: Request, path: str, method: str, status_code: int, duration_ms: int, success: bool):
        try:
            module = _resolve_module(path)
            # 解析用户
            username = None
            user_id = None
            auth = request.headers.get("authorization")
            if auth:
                token = auth[7:].strip() if auth.lower().startswith("bearer ") else auth.strip()
                payload = decode_access_token(token)
                if payload:
                    username = payload.get("sub")
                    try:
                        import uuid as _uuid
                        uid_raw = payload.get("uid")
                        user_id = _uuid.UUID(uid_raw) if uid_raw else None
                    except Exception:
                        user_id = None

            ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
                request.client.host if request.client else ""
            )
            action = _action_name(method, module, path)
            async with AsyncSessionLocal() as session:
                await LogService.create_log(session, {
                    "user_id": user_id,
                    "username": username,
                    "action": action,
                    "module": module,
                    "method": method,
                    "path": path,
                    "ip": ip,
                    "user_agent": request.headers.get("user-agent", ""),
                    "status": "success" if success else "failed",
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                })
                await session.commit()
        except Exception as exc:  # 日志本身失败不能影响业务
            logger.debug(f"[system] write operation log failed: {exc}")
