"""
API Gateway 主应用测试
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
import os

# 设置测试环境变量
os.environ["JWT_SECRET"] = "test-secret-key-for-testing-only"
os.environ["REDIS_URL"] = "redis://localhost:6379"

from app.main import app, http_client
from app.middleware.auth import create_access_token


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def auth_token():
    """创建测试用JWT令牌"""
    return create_access_token({"sub": "testuser", "role": "admin"})


@pytest.fixture
def auth_headers(auth_token):
    """创建带认证的请求头"""
    return {"Authorization": f"Bearer {auth_token}"}


class TestHealthCheck:
    """健康检查接口测试"""
    
    def test_health_check(self, client):
        """测试健康检查接口"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "gateway"
        assert "timestamp" in data


class TestServiceList:
    """服务列表接口测试"""
    
    def test_list_services(self, client):
        """测试列出所有服务"""
        response = client.get("/api/v1/services")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        expected_services = ["stations", "data", "alerts", "analysis", "reports"]
        for service in expected_services:
            assert service in data["services"]


class TestAuth:
    """认证接口测试"""
    
    def test_login_success(self, client):
        """测试登录成功"""
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_failure(self, client):
        """测试登录失败"""
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrongpassword"}
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid credentials"
    
    def test_login_missing_credentials(self, client):
        """测试缺少登录凭据"""
        response = client.post("/api/v1/auth/login", json={})
        assert response.status_code == 401
    
    def test_get_current_user_without_auth(self, client):
        """测试未认证获取当前用户"""
        response = client.get("/api/v1/auth/me")
        assert response.status_code == 401
    
    def test_get_current_user_with_auth(self, client, auth_headers):
        """测试已认证获取当前用户"""
        response = client.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["sub"] == "testuser"
        assert data["role"] == "admin"


class TestProxyRoutes:
    """代理路由测试"""
    
    @patch("app.main.http_client.request")
    def test_stations_proxy_get(self, mock_request, client, auth_headers):
        """测试站点服务代理GET请求"""
        mock_request.return_value = AsyncMock(
            status_code=200,
            content=b'{"stations": []}',
            headers={"content-type": "application/json"}
        )
        
        response = client.get("/api/v1/stations/", headers=auth_headers)
        assert response.status_code == 200
        mock_request.assert_called_once()
    
    @patch("app.main.http_client.request")
    def test_data_proxy_post(self, mock_request, client, auth_headers):
        """测试数据服务代理POST请求"""
        mock_request.return_value = AsyncMock(
            status_code=201,
            content=b'{"success": true}',
            headers={"content-type": "application/json"}
        )
        
        response = client.post(
            "/api/v1/data/ingest",
            headers=auth_headers,
            json={"station_id": "test_station", "ph": 7.0}
        )
        assert response.status_code == 201
    
    @patch("app.main.http_client.request")
    def test_alerts_proxy_get(self, mock_request, client, auth_headers):
        """测试预警服务代理GET请求"""
        mock_request.return_value = AsyncMock(
            status_code=200,
            content=b'{"alerts": []}',
            headers={"content-type": "application/json"}
        )
        
        response = client.get("/api/v1/alerts/", headers=auth_headers)
        assert response.status_code == 200
    
    @patch("app.main.http_client.request")
    def test_analysis_proxy_post(self, mock_request, client, auth_headers):
        """测试AI分析服务代理POST请求"""
        mock_request.return_value = AsyncMock(
            status_code=200,
            content=b'{"result": "anomaly detected"}',
            headers={"content-type": "application/json"}
        )
        
        response = client.post(
            "/api/v1/analysis/ai/anomaly/detect",
            headers=auth_headers,
            json={"station_id": "test", "metric": "ph", "data": []}
        )
        assert response.status_code == 200
    
    @patch("app.main.http_client.request")
    def test_reports_proxy_get(self, mock_request, client, auth_headers):
        """测试报告服务代理GET请求"""
        mock_request.return_value = AsyncMock(
            status_code=200,
            content=b'{"reports": []}',
            headers={"content-type": "application/json"}
        )
        
        response = client.get("/api/v1/reports/", headers=auth_headers)
        assert response.status_code == 200


class TestAuthMiddleware:
    """认证中间件测试"""
    
    def test_public_path_docs(self, client):
        """测试公开路径 - 文档"""
        response = client.get("/docs")
        assert response.status_code == 200
    
    def test_public_path_redoc(self, client):
        """测试公开路径 - ReDoc"""
        response = client.get("/redoc")
        assert response.status_code == 200
    
    def test_public_path_openapi(self, client):
        """测试公开路径 - OpenAPI schema"""
        response = client.get("/openapi.json")
        assert response.status_code == 200
    
    def test_protected_path_without_auth(self, client):
        """测试受保护路径无认证"""
        response = client.get("/api/v1/stations/")
        assert response.status_code == 401
        assert "authorization" in response.json()["detail"].lower()
    
    def test_protected_path_with_invalid_token(self, client):
        """测试受保护路径使用无效令牌"""
        response = client.get(
            "/api/v1/stations/",
            headers={"Authorization": "Bearer invalid_token"}
        )
        assert response.status_code == 401
    
    def test_protected_path_with_malformed_header(self, client):
        """测试受保护路径使用格式错误的认证头"""
        response = client.get(
            "/api/v1/stations/",
            headers={"Authorization": "invalid_format"}
        )
        assert response.status_code == 401


class TestErrorHandling:
    """错误处理测试"""
    
    @patch("app.main.http_client.request")
    def test_service_connection_error(self, mock_request, client, auth_headers):
        """测试服务连接错误"""
        import httpx
        mock_request.side_effect = httpx.ConnectError("Connection refused")
        
        response = client.get("/api/v1/stations/", headers=auth_headers)
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()
    
    @patch("app.main.http_client.request")
    def test_service_timeout(self, mock_request, client, auth_headers):
        """测试服务超时"""
        import httpx
        mock_request.side_effect = httpx.TimeoutException("Request timed out")
        
        response = client.get("/api/v1/stations/", headers=auth_headers)
        assert response.status_code == 504
        assert "timeout" in response.json()["detail"].lower()


class TestRouter:
    """路由工具测试"""
    
    def test_get_service_url(self):
        """测试获取服务URL"""
        from app.router import get_service_url
        url = get_service_url("stations")
        assert "localhost:8001" in url
    
    def test_get_service_url_not_found(self):
        """测试获取不存在的服务URL"""
        from app.router import get_service_url
        url = get_service_url("nonexistent")
        assert url == ""
    
    def test_get_service_by_path_valid(self):
        """测试根据有效路径获取服务"""
        from app.router import get_service_by_path
        service_name, service_url = get_service_by_path("/api/v1/stations/list")
        assert service_name == "stations"
        assert "stations" in service_url
    
    def test_get_service_by_path_invalid(self):
        """测试根据无效路径获取服务"""
        from app.router import get_service_by_path
        service_name, service_url = get_service_by_path("/invalid/path")
        assert service_name == ""
        assert service_url == ""
