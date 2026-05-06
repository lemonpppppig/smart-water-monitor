"""
AI引擎API测试
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime
import os
import sys
from pathlib import Path

# 设置测试环境变量
os.environ["TDENGINE_PASSWORD"] = "test_password"
os.environ["NEO4J_PASSWORD"] = "test_password"
os.environ["REDIS_URL"] = "redis://localhost:6379"

# 添加服务路径 - 使用相对路径
service_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(service_path))

from app.ai.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


class TestHealthCheck:
    """健康检查测试"""
    
    def test_health_check(self, client):
        """测试健康检查接口"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "ai-engine"


class TestAnomalyDetection:
    """异常检测测试"""
    
    @patch("app.api.ai.time_series_engine")
    def test_detect_anomaly_success(self, mock_engine, client):
        """测试异常检测成功"""
        mock_engine.detect_anomaly.return_value = {
            "station_id": "test_station",
            "metric": "ph",
            "anomalies": [
                {"timestamp": "2024-01-01T00:00:00", "value": 9.5, "is_anomaly": True}
            ],
            "anomaly_count": 1
        }
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "data": [
                {"timestamp": "2024-01-01T00:00:00", "value": 7.5},
                {"timestamp": "2024-01-01T01:00:00", "value": 9.5}
            ]
        }
        
        response = client.post("/api/v1/ai/anomaly/detect", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["anomaly_count"] == 1
    
    @patch("app.api.ai.time_series_engine")
    def test_detect_anomaly_error(self, mock_engine, client):
        """测试异常检测返回错误"""
        mock_engine.detect_anomaly.return_value = {"error": "Model not found"}
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "data": []
        }
        
        response = client.post("/api/v1/ai/anomaly/detect", json=data)
        assert response.status_code == 400


class TestPrediction:
    """趋势预测测试"""
    
    @patch("app.api.ai.time_series_engine")
    def test_predict_success(self, mock_engine, client):
        """测试趋势预测成功"""
        mock_engine.predict.return_value = {
            "station_id": "test_station",
            "metric": "ph",
            "predictions": [
                {"timestamp": "2024-01-02T00:00:00", "value": 7.6},
                {"timestamp": "2024-01-02T01:00:00", "value": 7.7}
            ]
        }
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "hours": 24
        }
        
        response = client.post("/api/v1/ai/prediction/forecast", json=data)
        assert response.status_code == 200
        result = response.json()
        assert len(result["predictions"]) == 2
    
    @patch("app.api.ai.time_series_engine")
    def test_predict_error(self, mock_engine, client):
        """测试趋势预测返回错误"""
        mock_engine.predict.return_value = {"error": "Insufficient data"}
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "hours": 24
        }
        
        response = client.post("/api/v1/ai/prediction/forecast", json=data)
        assert response.status_code == 400


class TestRiskPrediction:
    """风险预测测试"""
    
    @patch("app.api.ai.time_series_engine")
    @patch("app.api.ai.coordinator")
    def test_predict_risk_low(self, mock_coordinator, mock_engine, client):
        """测试低风险预测"""
        mock_coordinator.submit_task.return_value = "task_123"
        mock_engine.predict.return_value = {
            "predictions": [{"value": 7.5}, {"value": 7.6}]
        }
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "hours": 24
        }
        
        response = client.post("/api/v1/ai/prediction/risk", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["risk_level"] == "low"
        assert result["risk_probability"] == 0.0
    
    @patch("app.api.ai.time_series_engine")
    @patch("app.api.ai.coordinator")
    def test_predict_risk_high_ph(self, mock_coordinator, mock_engine, client):
        """测试pH高风险预测"""
        mock_coordinator.submit_task.return_value = "task_123"
        mock_engine.predict.return_value = {
            "predictions": [{"value": 9.5}]
        }
        
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "hours": 24
        }
        
        response = client.post("/api/v1/ai/prediction/risk", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["risk_level"] == "high"
        assert result["risk_probability"] == 0.8
    
    @patch("app.api.ai.time_series_engine")
    @patch("app.api.ai.coordinator")
    def test_predict_risk_high_do(self, mock_coordinator, mock_engine, client):
        """测试溶解氧高风险预测"""
        mock_coordinator.submit_task.return_value = "task_123"
        mock_engine.predict.return_value = {
            "predictions": [{"value": 1.5}]
        }
        
        data = {
            "station_id": "test_station",
            "metric": "do",
            "hours": 24
        }
        
        response = client.post("/api/v1/ai/prediction/risk", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["risk_level"] == "high"


class TestKnowledge:
    """知识推理测试"""
    
    @patch("app.api.ai.knowledge_engine")
    def test_identify_pollution(self, mock_engine, client):
        """测试污染类型识别"""
        mock_engine.identify_pollution_type.return_value = {
            "pollution_type": "organic",
            "confidence": 0.85,
            "indicators": ["codmn", "nh3_n"]
        }
        
        data = {
            "data": {"codmn": 15.0, "nh3_n": 2.0, "ph": 7.5}
        }
        
        response = client.post("/api/v1/ai/knowledge/identify", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["pollution_type"] == "organic"
    
    @patch("app.api.ai.knowledge_engine")
    def test_case_reasoning(self, mock_engine, client):
        """测试案例推理"""
        mock_engine.case_based_reasoning.return_value = [
            {"case_id": "case_001", "similarity": 0.9, "solution": "增加曝气"}
        ]
        
        data = {
            "data": {"ph": 9.0, "do": 3.0}
        }
        
        response = client.post("/api/v1/ai/knowledge/cases", json=data)
        assert response.status_code == 200
        result = response.json()
        assert len(result["cases"]) == 1
    
    @patch("app.api.ai.knowledge_engine")
    def test_get_emergency_plan(self, mock_engine, client):
        """测试获取应急预案"""
        mock_engine.get_emergency_plan.return_value = {
            "pollution_type": "organic",
            "steps": ["步骤1", "步骤2", "步骤3"],
            "contacts": ["联系人1", "联系人2"]
        }
        
        response = client.get("/api/v1/ai/knowledge/emergency-plan/organic")
        assert response.status_code == 200
        result = response.json()
        assert result["pollution_type"] == "organic"
    
    @patch("app.api.ai.knowledge_engine")
    def test_comprehensive_analysis(self, mock_engine, client):
        """测试综合分析"""
        mock_engine.analyze.return_value = {
            "summary": "水质总体良好",
            "recommendations": ["建议1", "建议2"],
            "risk_assessment": "low"
        }
        
        data = {
            "data": {"ph": 7.5, "do": 8.0, "nh3_n": 0.5}
        }
        
        response = client.post("/api/v1/ai/knowledge/analyze", json=data)
        assert response.status_code == 200
        result = response.json()
        assert "summary" in result


class TestGraphAnalysis:
    """图计算分析测试"""
    
    @patch("app.api.ai.graph_engine")
    def test_trace_source(self, mock_engine, client):
        """测试污染溯源"""
        mock_engine.trace_pollution_source.return_value = {
            "target_station": "station_b",
            "detection_time": "2024-01-01T00:00:00",
            "sources": [
                {
                    "station_id": "station_a",
                    "confidence": 0.85,
                    "distance": 5000
                }
            ],
            "confidence": 0.85
        }
        
        data = {
            "station_id": "station_b",
            "detection_time": "2024-01-01T00:00:00",
            "lookback_hours": 24
        }
        
        response = client.post("/api/v1/ai/graph/trace-source", json=data)
        assert response.status_code == 200
        result = response.json()
        assert len(result["sources"]) == 1
        assert result["confidence"] == 0.85
    
    @patch("app.api.ai.graph_engine")
    def test_spread_analysis(self, mock_engine, client):
        """测试扩散分析"""
        mock_engine.analyze_spread.return_value = {
            "source_station": "station_a",
            "detection_time": "2024-01-01T00:00:00",
            "affected_stations": [
                {"station_id": "station_b", "estimated_arrival": "2024-01-01T06:00:00"}
            ],
            "total_affected": 1
        }
        
        data = {
            "station_id": "station_a",
            "detection_time": "2024-01-01T00:00:00",
            "lookback_hours": 24
        }
        
        response = client.post("/api/v1/ai/graph/spread-analysis", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["total_affected"] == 1
    
    @patch("app.api.ai.graph_engine")
    def test_get_flow_path(self, mock_engine, client):
        """测试获取水流路径"""
        mock_engine.get_flow_path.return_value = {
            "path": [
                {"station_id": "station_a", "name": "站点A"},
                {"station_id": "station_b", "name": "站点B"}
            ],
            "total_distance": 5000
        }
        
        response = client.get("/api/v1/ai/graph/path/station_a/station_b")
        assert response.status_code == 200
        result = response.json()
        assert len(result["path"]) == 2
        assert result["total_distance"] == 5000
    
    @patch("app.api.ai.graph_engine")
    def test_get_upstream(self, mock_engine, client):
        """测试获取上游站点"""
        mock_engine.get_upstream_stations.return_value = [
            {"station_id": "station_a", "name": "站点A", "depth": 1}
        ]
        
        response = client.get("/api/v1/ai/graph/upstream/station_b?max_depth=3")
        assert response.status_code == 200
        result = response.json()
        assert len(result["upstream"]) == 1
    
    @patch("app.api.ai.graph_engine")
    def test_get_downstream(self, mock_engine, client):
        """测试获取下游站点"""
        mock_engine.get_downstream_stations.return_value = [
            {"station_id": "station_c", "name": "站点C", "depth": 1}
        ]
        
        response = client.get("/api/v1/ai/graph/downstream/station_b?max_depth=3")
        assert response.status_code == 200
        result = response.json()
        assert len(result["downstream"]) == 1


class TestAgentSystem:
    """多智能体系统测试"""
    
    @patch("app.api.ai.coordinator")
    def test_get_system_status(self, mock_coordinator, client):
        """测试获取系统状态"""
        mock_coordinator.get_system_status.return_value = {
            "agents": {
                "analysis": {"status": "idle"},
                "prediction": {"status": "busy"}
            },
            "task_queue_size": 5
        }
        
        response = client.get("/api/v1/ai/agents/status")
        assert response.status_code == 200
        result = response.json()
        assert "agents" in result
        assert "task_queue_size" in result
    
    @patch("app.api.ai.coordinator")
    def test_submit_task(self, mock_coordinator, client):
        """测试提交任务"""
        mock_coordinator.submit_task.return_value = "task_123"
        
        data = {
            "task_type": "anomaly_detection",
            "payload": {"station_id": "test_station"},
            "priority": 5
        }
        
        response = client.post("/api/v1/ai/agents/task", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["task_id"] == "task_123"
        assert result["status"] == "submitted"
    
    @patch("app.api.ai.coordinator")
    def test_get_task_result_success(self, mock_coordinator, client):
        """测试获取任务结果成功"""
        mock_task = MagicMock()
        mock_task.task_id = "task_123"
        mock_task.task_type = "anomaly_detection"
        mock_task.status = "completed"
        mock_task.result = {"anomalies": []}
        mock_task.created_at = datetime.now()
        mock_task.completed_at = datetime.now()
        
        mock_coordinator.tasks = {"task_123": mock_task}
        
        response = client.get("/api/v1/ai/agents/task/task_123")
        assert response.status_code == 200
        result = response.json()
        assert result["task_id"] == "task_123"
        assert result["status"] == "completed"
    
    @patch("app.api.ai.coordinator")
    def test_get_task_result_not_found(self, mock_coordinator, client):
        """测试获取任务结果不存在"""
        mock_coordinator.tasks = {}
        
        response = client.get("/api/v1/ai/agents/task/nonexistent_task")
        assert response.status_code == 404


class TestModelManagement:
    """模型管理测试"""
    
    def test_train_model(self, client):
        """测试训练模型"""
        data = {
            "station_id": "test_station",
            "metric": "ph",
            "start_time": "2024-01-01T00:00:00",
            "end_time": "2024-01-31T00:00:00"
        }
        
        response = client.post("/api/v1/ai/models/train", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
    
    @patch("app.api.ai.time_series_engine")
    def test_get_model_status_exists(self, mock_engine, client):
        """测试获取模型状态（模型存在）"""
        mock_engine.models = {"test_station_ph": MagicMock()}
        
        response = client.get("/api/v1/ai/models/status/test_station/ph")
        assert response.status_code == 200
        result = response.json()
        assert result["has_model"] is True
        assert result["model_key"] == "test_station_ph"
    
    @patch("app.api.ai.time_series_engine")
    def test_get_model_status_not_exists(self, mock_engine, client):
        """测试获取模型状态（模型不存在）"""
        mock_engine.models = {}
        
        response = client.get("/api/v1/ai/models/status/test_station/ph")
        assert response.status_code == 200
        result = response.json()
        assert result["has_model"] is False
