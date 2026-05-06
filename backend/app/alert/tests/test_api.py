"""
预警服务API测试
"""
import pytest
from fastapi.testclient import TestClient
from uuid import uuid4, UUID
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timedelta
import os
import sys
from pathlib import Path

# 设置测试环境变量
os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@localhost:5432/test"
os.environ["REDIS_URL"] = "redis://localhost:6379"

# 添加服务路径 - 使用相对路径
service_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(service_path))

from app.alert.main import app


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
        assert data["service"] == "alert-service"


def create_mock_alert():
    """创建完整的mock预警对象"""
    mock_alert = MagicMock()
    mock_alert.id = uuid4()
    mock_alert.alert_code = "ALT202401010000001"
    mock_alert.station_id = uuid4()
    mock_alert.alert_type = "threshold"
    mock_alert.alert_level = "high"
    mock_alert.title = "pH值超标预警"
    mock_alert.description = "检测到pH值超过上限阈值"
    mock_alert.metrics = {"ph": 9.5, "threshold": 9.0}
    mock_alert.pollution_type = None
    mock_alert.source_analysis = None
    mock_alert.status = "pending"
    mock_alert.confirmed_by = None
    mock_alert.confirmed_at = None
    mock_alert.resolved_by = None
    mock_alert.resolved_at = None
    mock_alert.resolution_notes = None
    mock_alert.created_at = datetime.now()
    mock_alert.updated_at = datetime.now()
    
    # to_dict returns current attribute values
    def to_dict():
        return {
            "id": mock_alert.id,
            "alert_code": mock_alert.alert_code,
            "station_id": mock_alert.station_id,
            "alert_type": mock_alert.alert_type,
            "alert_level": mock_alert.alert_level,
            "title": mock_alert.title,
            "description": mock_alert.description,
            "metrics": mock_alert.metrics,
            "pollution_type": mock_alert.pollution_type,
            "source_analysis": mock_alert.source_analysis,
            "status": mock_alert.status,
            "confirmed_by": mock_alert.confirmed_by,
            "confirmed_at": mock_alert.confirmed_at,
            "resolved_by": mock_alert.resolved_by,
            "resolved_at": mock_alert.resolved_at,
            "resolution_notes": mock_alert.resolution_notes,
            "created_at": mock_alert.created_at,
            "updated_at": mock_alert.updated_at
        }
    
    mock_alert.to_dict = to_dict
    return mock_alert


class TestAlertCRUD:
    """预警CRUD测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.create_alert")
    async def test_create_alert_success(self, mock_create, mock_get_db, client):
        """测试创建预警成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_alert = create_mock_alert()
        mock_create.return_value = mock_alert
        
        data = {
            "station_id": str(uuid4()),
            "alert_type": "threshold",
            "alert_level": "high",
            "title": "pH值超标预警",
            "description": "检测到pH值超过上限阈值",
            "metrics": {"ph": 9.5, "threshold": 9.0}
        }
        
        response = client.post("/api/v1/alerts/", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["alert_level"] == "high"
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.list_alerts")
    async def test_list_alerts(self, mock_list, mock_get_db, client):
        """测试获取预警列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_alert = create_mock_alert()
        mock_list.return_value = ([mock_alert], 1)
        
        response = client.get("/api/v1/alerts/")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
        assert len(result["items"]) == 1
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.list_alerts")
    async def test_list_alerts_with_filters(self, mock_list, mock_get_db, client):
        """测试带过滤条件的预警列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        mock_list.return_value = ([], 0)
        
        station_id = uuid4()
        response = client.get(
            f"/api/v1/alerts/?station_id={station_id}&alert_type=threshold&alert_level=high&status=pending"
        )
        assert response.status_code == 200
        mock_list.assert_called_once()
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_get_alert_success(self, mock_get, mock_get_db, client):
        """测试获取预警详情成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        alert_id = uuid4()
        mock_alert = create_mock_alert()
        mock_alert.id = alert_id
        mock_get.return_value = mock_alert
        
        response = client.get(f"/api/v1/alerts/{alert_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["alert_code"] == "ALT202401010000001"
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_get_alert_not_found(self, mock_get, mock_get_db, client):
        """测试获取预警详情不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        mock_get.return_value = None
        
        response = client.get(f"/api/v1/alerts/{uuid4()}")
        assert response.status_code == 404
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.update_alert")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_update_alert_success(self, mock_get, mock_update, mock_get_db, client):
        """测试更新预警成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        alert_id = uuid4()
        mock_alert = create_mock_alert()
        mock_alert.id = alert_id
        mock_alert.status = "confirmed"
        mock_get.return_value = mock_alert
        mock_update.return_value = mock_alert
        
        data = {"status": "confirmed"}
        
        response = client.put(f"/api/v1/alerts/{alert_id}", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "confirmed"


class TestAlertConfirm:
    """预警确认测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.confirm_alert")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_confirm_alert_success(self, mock_get, mock_confirm, mock_get_db, client):
        """测试确认预警成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        alert_id = uuid4()
        mock_alert = create_mock_alert()
        mock_alert.id = alert_id
        mock_alert.status = "confirmed"
        mock_alert.confirmed_by = "admin"
        mock_get.return_value = mock_alert
        mock_confirm.return_value = mock_alert
        
        data = {"confirmed_by": "admin"}
        
        response = client.post(f"/api/v1/alerts/{alert_id}/confirm", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "confirmed"
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_confirm_alert_not_found(self, mock_get, mock_get_db, client):
        """测试确认预警不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        mock_get.return_value = None
        
        data = {"confirmed_by": "admin"}
        
        response = client.post(f"/api/v1/alerts/{uuid4()}/confirm", json=data)
        assert response.status_code == 404


class TestAlertResolve:
    """预警解决测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.resolve_alert")
    @patch("app.api.alerts.AlertService.get_alert_by_id")
    async def test_resolve_alert_success(self, mock_get, mock_resolve, mock_get_db, client):
        """测试解决预警成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        alert_id = uuid4()
        mock_alert = create_mock_alert()
        mock_alert.id = alert_id
        mock_alert.status = "resolved"
        mock_alert.resolved_by = "admin"
        mock_alert.resolution_notes = "已处理"
        mock_get.return_value = mock_alert
        mock_resolve.return_value = mock_alert
        
        data = {"resolved_by": "admin", "notes": "已处理"}
        
        response = client.post(f"/api/v1/alerts/{alert_id}/resolve", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "resolved"


class TestAlertStatistics:
    """预警统计测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertService.get_statistics")
    async def test_get_alert_statistics(self, mock_stats, mock_get_db, client):
        """测试获取预警统计"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_stats.return_value = {
            "total": 100,
            "by_status": {"pending": 30, "confirmed": 40, "resolved": 30},
            "by_level": {"low": 20, "medium": 50, "high": 30},
            "by_type": {"threshold": 60, "anomaly": 40}
        }
        
        response = client.get("/api/v1/alerts/statistics/summary")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 100
        assert "by_status" in result
        assert "by_level" in result
        assert "by_type" in result


def create_mock_rule():
    """创建完整的mock规则对象"""
    mock_rule = MagicMock()
    mock_rule.id = uuid4()
    mock_rule.rule_name = "pH值阈值规则"
    mock_rule.rule_type = "threshold"
    mock_rule.station_ids = [uuid4(), uuid4()]
    mock_rule.metric_codes = ["ph", "do"]
    mock_rule.conditions = {"operator": ">", "threshold": 9.0}
    mock_rule.alert_level = "high"
    mock_rule.notification_channels = ["email", "sms"]
    mock_rule.is_enabled = True
    mock_rule.created_at = datetime.now()
    mock_rule.updated_at = datetime.now()
    
    # to_dict returns current attribute values
    def to_dict():
        return {
            "id": mock_rule.id,
            "rule_name": mock_rule.rule_name,
            "rule_type": mock_rule.rule_type,
            "station_ids": mock_rule.station_ids,
            "metric_codes": mock_rule.metric_codes,
            "conditions": mock_rule.conditions,
            "alert_level": mock_rule.alert_level,
            "notification_channels": mock_rule.notification_channels,
            "is_enabled": mock_rule.is_enabled,
            "created_at": mock_rule.created_at,
            "updated_at": mock_rule.updated_at
        }
    
    mock_rule.to_dict = to_dict
    return mock_rule


class TestAlertRules:
    """预警规则测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.create_rule")
    async def test_create_rule_success(self, mock_create, mock_get_db, client):
        """测试创建预警规则成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_rule = create_mock_rule()
        mock_create.return_value = mock_rule
        
        data = {
            "rule_name": "pH值阈值规则",
            "rule_type": "threshold",
            "conditions": {"ph": {"min": 6.0, "max": 9.0}},
            "alert_level": "high",
            "notification_channels": ["app", "email"]
        }
        
        response = client.post("/api/v1/alerts/rules", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["rule_name"] == "pH值阈值规则"
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.list_rules")
    async def test_list_rules(self, mock_list, mock_get_db, client):
        """测试获取规则列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_rule = create_mock_rule()
        mock_list.return_value = ([mock_rule], 1)
        
        response = client.get("/api/v1/alerts/rules")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.list_rules")
    async def test_list_rules_with_is_enabled_filter(self, mock_list, mock_get_db, client):
        """测试获取规则列表带启用状态过滤"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        mock_list.return_value = ([], 0)
        
        response = client.get("/api/v1/alerts/rules?is_enabled=true")
        assert response.status_code == 200
        # 验证 is_enabled 参数正确传递
        mock_list.assert_called_once()
        call_kwargs = mock_list.call_args.kwargs
        assert call_kwargs.get("is_enabled") is True
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.get_rule_by_id")
    async def test_get_rule_success(self, mock_get, mock_get_db, client):
        """测试获取规则详情成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        rule_id = uuid4()
        mock_rule = create_mock_rule()
        mock_rule.id = rule_id
        mock_get.return_value = mock_rule
        
        response = client.get(f"/api/v1/alerts/rules/{rule_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["rule_name"] == "pH值阈值规则"
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.update_rule")
    @patch("app.api.alerts.AlertRuleService.get_rule_by_id")
    async def test_update_rule_success(self, mock_get, mock_update, mock_get_db, client):
        """测试更新规则成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        rule_id = uuid4()
        mock_rule = create_mock_rule()
        mock_rule.id = rule_id
        mock_rule.rule_name = "更新后的规则名称"
        mock_rule.is_enabled = False
        mock_get.return_value = mock_rule
        mock_update.return_value = mock_rule
        
        data = {"rule_name": "更新后的规则名称", "is_enabled": False}
        
        response = client.put(f"/api/v1/alerts/rules/{rule_id}", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["rule_name"] == "更新后的规则名称"
        assert result["is_enabled"] is False
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.delete_rule")
    @patch("app.api.alerts.AlertRuleService.get_rule_by_id")
    async def test_delete_rule_success(self, mock_get, mock_delete, mock_get_db, client):
        """测试删除规则成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        rule_id = uuid4()
        mock_rule = MagicMock()
        mock_get.return_value = mock_rule
        
        response = client.delete(f"/api/v1/alerts/rules/{rule_id}")
        assert response.status_code == 204


class TestRuleCheck:
    """规则检查测试"""
    
    @patch("app.api.alerts.get_db")
    @patch("app.api.alerts.AlertRuleService.check_rules")
    async def test_check_rules(self, mock_check, mock_get_db, client):
        """测试规则检查"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_check.return_value = [
            {
                "rule_id": str(uuid4()),
                "rule_name": "pH值阈值规则",
                "metric_code": "ph",
                "value": 9.5,
                "threshold": 9.0,
                "condition": "above_max",
                "alert_level": "high"
            }
        ]
        
        data = {
            "station_id": str(uuid4()),
            "data": {"ph": 9.5, "do": 8.0}
        }
        
        response = client.post("/api/v1/alerts/rules/check", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["triggered"] is True
        assert len(result["triggered_rules"]) == 1
