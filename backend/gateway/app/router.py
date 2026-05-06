"""
路由工具
"""
from app.config import SERVICE_ROUTES


def get_service_url(service_name: str) -> str:
    """获取服务URL"""
    return SERVICE_ROUTES.get(service_name, "")


def get_service_by_path(path: str) -> tuple[str, str]:
    """根据路径获取服务名称和URL"""
    path_parts = path.strip("/").split("/")
    
    if len(path_parts) >= 3 and path_parts[0] == "api" and path_parts[1] == "v1":
        service_name = path_parts[2]
        service_url = SERVICE_ROUTES.get(service_name)
        if service_url:
            remaining_path = "/" + "/".join(path_parts[2:])
            return service_name, service_url + remaining_path
    
    return "", ""
