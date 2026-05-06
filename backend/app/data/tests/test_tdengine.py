"""
TDengine客户端测试
"""
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime
import os
import sys
from pathlib import Path

os.environ["TDENGINE_PASSWORD"] = "test_password"

# 添加服务路径 - 使用相对路径
service_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(service_path))

from app.data.db.tdengine import (
    TDengineClient, 
    _validate_identifier, 
    _validate_fields, 
    ALLOWED_FIELDS
)


class TestValidation:
    """验证函数测试"""
    
    def test_validate_identifier_valid(self):
        """测试验证有效标识符"""
        assert _validate_identifier("station_123") == "station_123"
        assert _validate_identifier("station-abc") == "station-abc"
        assert _validate_identifier("StationABC") == "StationABC"
    
    def test_validate_identifier_invalid(self):
        """测试验证无效标识符"""
        with pytest.raises(ValueError) as exc_info:
            _validate_identifier("station;drop")
        assert "Invalid identifier" in str(exc_info.value)
        
        with pytest.raises(ValueError) as exc_info:
            _validate_identifier("station' OR '1'='1")
        assert "Invalid identifier" in str(exc_info.value)
        
        with pytest.raises(ValueError) as exc_info:
            _validate_identifier("")
        assert "Invalid identifier" in str(exc_info.value)
    
    def test_validate_fields_valid(self):
        """测试验证有效字段列表"""
        fields = ["ph", "do", "nh3_n"]
        result = _validate_fields(fields)
        assert result == fields
    
    def test_validate_fields_empty(self):
        """测试验证空字段列表"""
        result = _validate_fields(None)
        assert result == list(ALLOWED_FIELDS)
        
        result = _validate_fields([])
        assert result == list(ALLOWED_FIELDS)
    
    def test_validate_fields_invalid(self):
        """测试验证无效字段"""
        with pytest.raises(ValueError) as exc_info:
            _validate_fields(["ph", "invalid_field", "do"])
        assert "Invalid fields" in str(exc_info.value)
        assert "invalid_field" in str(exc_info.value)
    
    def test_validate_fields_sql_injection_attempt(self):
        """测试验证SQL注入尝试"""
        with pytest.raises(ValueError) as exc_info:
            _validate_fields(["ph); DROP TABLE water_quality; --"])
        assert "Invalid fields" in str(exc_info.value)


class TestTDengineClient:
    """TDengine客户端测试"""
    
    @patch("app.db.tdengine.taosws.connect")
    def test_connect(self, mock_connect):
        """测试连接建立"""
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        client.connect()
        
        mock_connect.assert_called_once()
        assert client._conn is not None
    
    @patch("app.db.tdengine.taosws.connect")
    def test_close(self, mock_connect):
        """测试连接关闭"""
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        client.connect()
        client.close()
        
        mock_conn.close.assert_called_once()
        assert client._conn is None
    
    @patch("app.db.tdengine.taosws.connect")
    def test_insert_water_quality(self, mock_connect):
        """测试插入水质数据"""
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        
        data = {
            "station_id": "test_station",
            "station_type": "water_source",
            "region": "test_region",
            "ph": 7.5,
            "do": 8.0,
            "ts": "2024-01-01 00:00:00"
        }
        
        result = client.insert_water_quality(data)
        
        assert result is True
        mock_conn.execute.assert_called()
    
    @patch("app.db.tdengine.taosws.connect")
    def test_insert_water_quality_invalid_station_id(self, mock_connect):
        """测试插入数据使用无效站点ID"""
        client = TDengineClient()
        
        data = {
            "station_id": "invalid;station",
            "ph": 7.5
        }
        
        result = client.insert_water_quality(data)
        assert result is False
    
    @patch("app.db.tdengine.taosws.connect")
    def test_query_water_quality(self, mock_connect):
        """测试查询水质数据"""
        mock_conn = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([
            ("2024-01-01 00:00:00", 7.5, 8.0)
        ]))
        mock_conn.query.return_value = mock_result
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        
        start_time = datetime(2024, 1, 1, 0, 0, 0)
        end_time = datetime(2024, 1, 2, 0, 0, 0)
        
        result = client.query_water_quality(
            "test_station", start_time, end_time, ["ts", "ph", "do"]
        )
        
        assert len(result) == 1
        assert result[0]["ph"] == 7.5
    
    @patch("app.db.tdengine.taosws.connect")
    def test_query_water_quality_invalid_station_id(self, mock_connect):
        """测试查询使用无效站点ID"""
        client = TDengineClient()
        
        start_time = datetime(2024, 1, 1, 0, 0, 0)
        end_time = datetime(2024, 1, 2, 0, 0, 0)
        
        with pytest.raises(ValueError) as exc_info:
            client.query_water_quality(
                "invalid;station", start_time, end_time, ["ph"]
            )
        assert "Invalid identifier" in str(exc_info.value)
    
    @patch("app.db.tdengine.taosws.connect")
    def test_query_water_quality_invalid_fields(self, mock_connect):
        """测试查询使用无效字段"""
        client = TDengineClient()
        
        start_time = datetime(2024, 1, 1, 0, 0, 0)
        end_time = datetime(2024, 1, 2, 0, 0, 0)
        
        with pytest.raises(ValueError) as exc_info:
            client.query_water_quality(
                "test_station", start_time, end_time, ["invalid_field"]
            )
        assert "Invalid fields" in str(exc_info.value)
    
    @patch("app.db.tdengine.taosws.connect")
    def test_query_latest(self, mock_connect):
        """测试查询最新数据"""
        mock_conn = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([
            ("2024-01-01 00:00:00", 7.5, 8.0, 0.5, 3.0, 10.0, 500.0,
             1.0, 2.0, 1.5, 0.1, 15.0, 50.0, 200.0, 25.0)
        ]))
        mock_conn.query.return_value = mock_result
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        
        result = client.query_latest("test_station")
        
        assert result is not None
        assert result["ph"] == 7.5
        assert result["do"] == 8.0
    
    @patch("app.db.tdengine.taosws.connect")
    def test_query_statistics(self, mock_connect):
        """测试查询统计数据"""
        mock_conn = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([
            (100, 7.5, 6.5, 8.5, 0.5)
        ]))
        mock_conn.query.return_value = mock_result
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        
        start_time = datetime(2024, 1, 1, 0, 0, 0)
        end_time = datetime(2024, 1, 2, 0, 0, 0)
        
        result = client.query_statistics(
            "test_station", "ph", start_time, end_time
        )
        
        assert result["count"] == 100
        assert result["avg"] == 7.5
        assert result["min"] == 6.5
        assert result["max"] == 8.5
        assert result["std"] == 0.5
    
    @patch("app.db.tdengine.taosws.connect")
    def test_get_stations_with_data(self, mock_connect):
        """测试获取有数据的站点列表"""
        mock_conn = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([
            ("station_1",),
            ("station_2",)
        ]))
        mock_conn.query.return_value = mock_result
        mock_connect.return_value = mock_conn
        
        client = TDengineClient()
        
        result = client.get_stations_with_data()
        
        assert len(result) == 2
        assert "station_1" in result
        assert "station_2" in result
