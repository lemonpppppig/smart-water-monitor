"""
站点服务API测试
"""
import pytest
from fastapi.testclient import TestClient
from uuid import uuid4, UUID
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime
import os
import sys
from pathlib import Path

# 设置测试环境变量
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@localhost:5432/test"
os.environ["REDIS_URL"] = "redis://localhost:6379"
os.environ["NEO4J_PASSWORD"] = "test_password"

# 添加服务路径 - 使用相对路径
service_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(service_path))

from app.station.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def mock_db():
    """模拟数据库会话"""
    with patch("app.api.stations.get_db") as mock:
        db = AsyncMock()
        mock.return_value = db
        yield db


class TestHealthCheck:
    """健康检查测试"""
    
    def test_health_check(self, client):
        """测试健康检查接口"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "station-service"


class TestStationCRUD:
    """站点CRUD测试"""
    
    @patch("app.api.stations.StationService.get_station_by_code")
    @patch("app.api.stations.StationService.create_station")
    async def test_create_station_success(self, mock_create, mock_get_by_code, client):
        """测试创建站点成功"""
        mock_get_by_code.return_value = None
        
        mock_station = MagicMock()
        mock_station.id = uuid4()
        mock_station.station_code = "TEST001"
        mock_station.station_name = "测试站点"
        mock_station.station_type = "water_source"
        mock_station.to_dict.return_value = {
            "id": str(mock_station.id),
            "station_code": "TEST001",
            "station_name": "测试站点",
            "station_type": "water_source",
            "status": "active"
        }
        mock_create.return_value = mock_station
        
        data = {
            "station_code": "TEST001",
            "station_name": "测试站点",
            "station_type": "water_source",
            "region": "测试区域",
            "longitude": 116.397428,
            "latitude": 39.90923
        }
        
        response = client.post("/api/v1/stations", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["station_code"] == "TEST001"
    
    @patch("app.api.stations.StationService.get_station_by_code")
    async def test_create_station_duplicate_code(self, mock_get_by_code, client):
        """测试创建站点编码重复"""
        mock_existing = MagicMock()
        mock_get_by_code.return_value = mock_existing
        
        data = {
            "station_code": "TEST001",
            "station_name": "测试站点",
            "station_type": "water_source"
        }
        
        response = client.post("/api/v1/stations", json=data)
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]
    
    @patch("app.api.stations.StationService.list_stations")
    async def test_list_stations(self, mock_list, client):
        """测试获取站点列表"""
        mock_station = MagicMock()
        mock_station.id = uuid4()
        mock_station.to_dict.return_value = {
            "id": str(mock_station.id),
            "station_code": "TEST001",
            "station_name": "测试站点",
            "station_type": "water_source"
        }
        mock_list.return_value = ([mock_station], 1)
        
        response = client.get("/api/v1/stations")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
        assert len(result["items"]) == 1
    
    @patch("app.api.stations.StationService.list_stations")
    async def test_list_stations_with_filters(self, mock_list, client):
        """测试带过滤条件的站点列表"""
        mock_list.return_value = ([], 0)
        
        response = client.get(
            "/api/v1/stations?station_type=water_source&region=测试区域&status=active"
        )
        assert response.status_code == 200
        mock_list.assert_called_once()
    
    @patch("app.api.stations.StationService.get_station_by_id")
    async def test_get_station_success(self, mock_get, client):
        """测试获取站点详情成功"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_station.id = station_id
        mock_station.to_dict.return_value = {
            "id": str(station_id),
            "station_code": "TEST001",
            "station_name": "测试站点"
        }
        mock_get.return_value = mock_station
        
        response = client.get(f"/api/v1/stations/{station_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["station_code"] == "TEST001"
    
    @patch("app.api.stations.StationService.get_station_by_id")
    async def test_get_station_not_found(self, mock_get, client):
        """测试获取站点详情不存在"""
        mock_get.return_value = None
        
        response = client.get(f"/api/v1/stations/{uuid4()}")
        assert response.status_code == 404
    
    @patch("app.api.stations.StationService.get_station_by_id")
    @patch("app.api.stations.StationService.update_station")
    async def test_update_station_success(self, mock_update, mock_get, client):
        """测试更新站点成功"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_station.id = station_id
        mock_station.to_dict.return_value = {
            "id": str(station_id),
            "station_code": "TEST001",
            "station_name": "更新后的名称"
        }
        mock_get.return_value = mock_station
        mock_update.return_value = mock_station
        
        data = {"station_name": "更新后的名称"}
        
        response = client.put(f"/api/v1/stations/{station_id}", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["station_name"] == "更新后的名称"
    
    @patch("app.api.stations.StationService.get_station_by_id")
    async def test_update_station_not_found(self, mock_get, client):
        """测试更新站点不存在"""
        mock_get.return_value = None
        
        response = client.put(f"/api/v1/stations/{uuid4()}", json={"station_name": "新名称"})
        assert response.status_code == 404
    
    @patch("app.api.stations.StationService.get_station_by_id")
    @patch("app.api.stations.StationService.delete_station")
    async def test_delete_station_success(self, mock_delete, mock_get, client):
        """测试删除站点成功"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_get.return_value = mock_station
        
        response = client.delete(f"/api/v1/stations/{station_id}")
        assert response.status_code == 204
    
    @patch("app.api.stations.StationService.get_station_by_id")
    async def test_delete_station_not_found(self, mock_get, client):
        """测试删除站点不存在"""
        mock_get.return_value = None
        
        response = client.delete(f"/api/v1/stations/{uuid4()}")
        assert response.status_code == 404


class TestStationByCode:
    """通过编码查询站点测试"""
    
    @patch("app.api.stations.StationService.get_station_by_code")
    async def test_get_station_by_code_success(self, mock_get, client):
        """测试通过编码获取站点成功"""
        mock_station = MagicMock()
        mock_station.id = uuid4()
        mock_station.to_dict.return_value = {
            "id": str(mock_station.id),
            "station_code": "TEST001",
            "station_name": "测试站点"
        }
        mock_get.return_value = mock_station
        
        response = client.get("/api/v1/stations/code/TEST001")
        assert response.status_code == 200
        result = response.json()
        assert result["station_code"] == "TEST001"
    
    @patch("app.api.stations.StationService.get_station_by_code")
    async def test_get_station_by_code_not_found(self, mock_get, client):
        """测试通过编码获取站点不存在"""
        mock_get.return_value = None
        
        response = client.get("/api/v1/stations/code/NONEXISTENT")
        assert response.status_code == 404


class TestNearbyStations:
    """附近站点查询测试"""
    
    @patch("app.api.stations.StationService.get_nearby_stations")
    async def test_get_nearby_stations(self, mock_get_nearby, client):
        """测试获取附近站点"""
        mock_station = MagicMock()
        mock_station.id = uuid4()
        mock_station.to_dict.return_value = {
            "id": str(mock_station.id),
            "station_code": "TEST001",
            "station_name": "测试站点",
            "longitude": 116.397428,
            "latitude": 39.90923
        }
        mock_get_nearby.return_value = [mock_station]
        
        data = {
            "longitude": 116.397428,
            "latitude": 39.90923,
            "radius": 5000,
            "limit": 10
        }
        
        response = client.post("/api/v1/stations/nearby", json=data)
        assert response.status_code == 200
        result = response.json()
        assert len(result) == 1


class TestStationMetrics:
    """站点指标配置测试"""
    
    @patch("app.api.stations.StationService.get_station_by_id")
    @patch("app.api.stations.StationMetricService.get_metric_by_code")
    @patch("app.api.stations.StationMetricService.create_metric")
    async def test_create_metric_success(self, mock_create, mock_get_metric, mock_get_station, client):
        """测试创建指标配置成功"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_get_station.return_value = mock_station
        mock_get_metric.return_value = None
        
        mock_metric = MagicMock()
        mock_metric.id = uuid4()
        mock_metric.to_dict.return_value = {
            "id": str(mock_metric.id),
            "station_id": str(station_id),
            "metric_code": "ph",
            "metric_name": "pH值",
            "unit": ""
        }
        mock_create.return_value = mock_metric
        
        data = {
            "metric_code": "ph",
            "metric_name": "pH值",
            "unit": "",
            "upper_limit": 9.0,
            "lower_limit": 6.0
        }
        
        response = client.post(f"/api/v1/stations/{station_id}/metrics", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["metric_code"] == "ph"
    
    @patch("app.api.stations.StationService.get_station_by_id")
    async def test_create_metric_station_not_found(self, mock_get_station, client):
        """测试创建指标配置站点不存在"""
        mock_get_station.return_value = None
        
        data = {"metric_code": "ph", "metric_name": "pH值"}
        
        response = client.post(f"/api/v1/stations/{uuid4()}/metrics", json=data)
        assert response.status_code == 404
    
    @patch("app.api.stations.StationService.get_station_by_id")
    @patch("app.api.stations.StationMetricService.get_metrics_by_station")
    async def test_list_station_metrics(self, mock_get_metrics, mock_get_station, client):
        """测试获取站点指标列表"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_get_station.return_value = mock_station
        
        mock_metric = MagicMock()
        mock_metric.to_dict.return_value = {
            "id": str(uuid4()),
            "metric_code": "ph",
            "metric_name": "pH值"
        }
        mock_get_metrics.return_value = [mock_metric]
        
        response = client.get(f"/api/v1/stations/{station_id}/metrics")
        assert response.status_code == 200
        result = response.json()
        assert len(result) == 1
    
    @patch("app.api.stations.StationService.get_station_by_id")
    @patch("app.api.stations.StationMetricService.get_metrics_by_station")
    async def test_get_station_with_metrics(self, mock_get_metrics, mock_get_station, client):
        """测试获取站点详情含指标"""
        station_id = uuid4()
        mock_station = MagicMock()
        mock_station.id = station_id
        mock_station.to_dict.return_value = {
            "id": str(station_id),
            "station_code": "TEST001",
            "station_name": "测试站点"
        }
        mock_get_station.return_value = mock_station
        
        mock_metric = MagicMock()
        mock_metric.to_dict.return_value = {
            "id": str(uuid4()),
            "metric_code": "ph"
        }
        mock_get_metrics.return_value = [mock_metric]
        
        response = client.get(f"/api/v1/stations/{station_id}/detail")
        assert response.status_code == 200
        result = response.json()
        assert "metrics" in result
        assert len(result["metrics"]) == 1
