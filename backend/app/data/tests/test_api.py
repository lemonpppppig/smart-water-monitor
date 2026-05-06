"""
数据服务API测试
"""
import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
import os
import sys
from pathlib import Path

# 设置测试环境变量
os.environ["TDENGINE_PASSWORD"] = "test_password"
os.environ["REDIS_URL"] = "redis://localhost:6379"

# 添加服务路径 - 使用相对路径
service_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(service_path))

from app.data.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def mock_tdengine():
    """模拟TDengine客户端"""
    with patch("app.api.data.get_tdengine_client") as mock:
        client = MagicMock()
        mock.return_value = client
        yield client


class TestHealthCheck:
    """健康检查测试"""
    
    def test_health_check(self, client):
        """测试健康检查接口"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "data-service"


class TestDataIngest:
    """数据接入测试"""
    
    @patch("app.api.data.get_ingestion_service")
    def test_ingest_single_data(self, mock_get_service, client):
        """测试接入单条数据"""
        mock_service = MagicMock()
        mock_service.ingest_data.return_value = True
        mock_get_service.return_value = mock_service
        
        data = {
            "station_id": "test_station",
            "ph": 7.5,
            "do": 8.0,
            "nh3_n": 0.5,
            "codmn": 3.0,
            "turbidity": 10.0,
            "conductivity": 500.0
        }
        
        response = client.post("/api/v1/data/ingest", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert "successfully" in result["message"]
    
    @patch("app.api.data.get_ingestion_service")
    def test_ingest_batch_data(self, mock_get_service, client):
        """测试批量接入数据"""
        mock_service = MagicMock()
        mock_service.ingest_batch.return_value = (5, 0)
        mock_get_service.return_value = mock_service
        
        batch_data = {
            "items": [
                {"station_id": "station_1", "ph": 7.5},
                {"station_id": "station_2", "ph": 7.2}
            ]
        }
        
        response = client.post("/api/v1/data/ingest/batch", json=batch_data)
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert result["success_count"] == 5
        assert result["failed_count"] == 0


class TestDataQuery:
    """数据查询测试"""
    
    def test_get_latest_data_success(self, client, mock_tdengine):
        """测试获取最新数据成功"""
        mock_tdengine.query_latest.return_value = {
            "ts": "2024-01-01T00:00:00",
            "ph": 7.5,
            "do": 8.0
        }
        
        response = client.get("/api/v1/data/stations/test_station/latest")
        assert response.status_code == 200
        result = response.json()
        assert result["ph"] == 7.5
    
    def test_get_latest_data_not_found(self, client, mock_tdengine):
        """测试获取最新数据不存在"""
        mock_tdengine.query_latest.return_value = None
        
        response = client.get("/api/v1/data/stations/test_station/latest")
        assert response.status_code == 404
    
    def test_get_latest_data_invalid_station_id(self, client, mock_tdengine):
        """测试获取最新数据使用无效站点ID"""
        mock_tdengine.query_latest.side_effect = ValueError("Invalid identifier")
        
        response = client.get("/api/v1/data/stations/invalid;id/latest")
        assert response.status_code == 400
    
    def test_get_history_data_success(self, client, mock_tdengine):
        """测试获取历史数据成功"""
        mock_tdengine.query_water_quality.return_value = [
            {"ts": "2024-01-01T00:00:00", "ph": 7.5},
            {"ts": "2024-01-01T01:00:00", "ph": 7.6}
        ]
        
        start_time = (datetime.now() - timedelta(days=1)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/history"
            f"?start_time={start_time}&end_time={end_time}"
        )
        assert response.status_code == 200
        result = response.json()
        assert result["count"] == 2
        assert len(result["data"]) == 2
    
    def test_get_history_data_with_fields(self, client, mock_tdengine):
        """测试获取历史数据指定字段"""
        mock_tdengine.query_water_quality.return_value = [
            {"ts": "2024-01-01T00:00:00", "ph": 7.5}
        ]
        
        start_time = (datetime.now() - timedelta(days=1)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/history"
            f"?start_time={start_time}&end_time={end_time}&fields=ph,do"
        )
        assert response.status_code == 200
        mock_tdengine.query_water_quality.assert_called_once()
    
    def test_get_history_data_invalid_fields(self, client, mock_tdengine):
        """测试获取历史数据使用无效字段"""
        mock_tdengine.query_water_quality.side_effect = ValueError("Invalid fields")
        
        start_time = (datetime.now() - timedelta(days=1)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/history"
            f"?start_time={start_time}&end_time={end_time}&fields=invalid_field"
        )
        assert response.status_code == 400
    
    def test_query_data_post(self, client, mock_tdengine):
        """测试POST方式查询数据"""
        mock_tdengine.query_water_quality.return_value = [
            {"ts": "2024-01-01T00:00:00", "ph": 7.5}
        ]
        
        query = {
            "start_time": (datetime.now() - timedelta(days=1)).isoformat(),
            "end_time": datetime.now().isoformat(),
            "fields": ["ph", "do"]
        }
        
        response = client.post("/api/v1/data/stations/test_station/query", json=query)
        assert response.status_code == 200
        result = response.json()
        assert "data" in result


class TestStatistics:
    """统计查询测试"""
    
    def test_get_statistics_success(self, client, mock_tdengine):
        """测试获取统计信息成功"""
        mock_tdengine.query_statistics.return_value = {
            "count": 100,
            "avg": 7.5,
            "min": 6.5,
            "max": 8.5,
            "std": 0.5
        }
        
        start_time = (datetime.now() - timedelta(days=7)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/statistics"
            f"?field=ph&start_time={start_time}&end_time={end_time}"
        )
        assert response.status_code == 200
        result = response.json()
        assert result["field"] == "ph"
        assert result["statistics"]["count"] == 100
    
    def test_get_statistics_not_found(self, client, mock_tdengine):
        """测试获取统计信息数据不存在"""
        mock_tdengine.query_statistics.return_value = {}
        
        start_time = (datetime.now() - timedelta(days=7)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/statistics"
            f"?field=ph&start_time={start_time}&end_time={end_time}"
        )
        assert response.status_code == 404
    
    def test_get_statistics_invalid_field(self, client, mock_tdengine):
        """测试获取统计信息使用无效字段"""
        mock_tdengine.query_statistics.side_effect = ValueError("Invalid fields")
        
        start_time = (datetime.now() - timedelta(days=7)).isoformat()
        end_time = datetime.now().isoformat()
        
        response = client.get(
            f"/api/v1/data/stations/test_station/statistics"
            f"?field=invalid_field&start_time={start_time}&end_time={end_time}"
        )
        assert response.status_code == 400


class TestStations:
    """站点相关测试"""
    
    def test_get_stations_with_data(self, client, mock_tdengine):
        """测试获取有数据的站点列表"""
        mock_tdengine.get_stations_with_data.return_value = ["station_1", "station_2"]
        
        response = client.get("/api/v1/data/stations")
        assert response.status_code == 200
        result = response.json()
        assert result["count"] == 2
        assert "station_1" in result["stations"]


class TestDataProcessing:
    """数据处理测试"""
    
    @patch("app.api.data.DataProcessor")
    def test_process_data(self, mock_processor_class, client):
        """测试数据处理"""
        mock_processor = MagicMock()
        mock_processor.process_data_point.return_value = (
            {"ph": 7.5, "do": 8.0},
            []
        )
        mock_processor_class.return_value = mock_processor
        
        data = {
            "station_id": "test_station",
            "ph": 7.5,
            "do": 8.0
        }
        
        response = client.post("/api/v1/data/process", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is True
        assert len(result["errors"]) == 0
    
    @patch("app.api.data.DataProcessor")
    def test_validate_data_batch(self, mock_processor_class, client):
        """测试批量验证数据"""
        mock_processor = MagicMock()
        mock_processor.validate_data.return_value = (True, [])
        mock_processor_class.return_value = mock_processor
        
        batch_data = {
            "items": [
                {"station_id": "station_1", "ph": 7.5},
                {"station_id": "station_2", "ph": 7.2}
            ]
        }
        
        response = client.post("/api/v1/data/process/validate", json=batch_data)
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 2
        assert result["valid"] == 2
        assert result["invalid"] == 0
    
    @patch("app.api.data.DataProcessor")
    def test_validate_data_batch_with_errors(self, mock_processor_class, client):
        """测试批量验证数据包含错误"""
        mock_processor = MagicMock()
        mock_processor.validate_data.side_effect = [
            (True, []),
            (False, ["pH value out of range"])
        ]
        mock_processor_class.return_value = mock_processor
        
        batch_data = {
            "items": [
                {"station_id": "station_1", "ph": 7.5},
                {"station_id": "station_2", "ph": 15.0}
            ]
        }
        
        response = client.post("/api/v1/data/process/validate", json=batch_data)
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 2
        assert result["valid"] == 1
        assert result["invalid"] == 1
