"""
报告服务API测试
"""
import pytest
from fastapi.testclient import TestClient
from uuid import uuid4, UUID
from unittest.mock import patch, AsyncMock, MagicMock, mock_open
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

from app.report.main import app


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
        assert data["service"] == "report-service"


class TestReportGeneration:
    """报告生成测试"""
    
    @patch("app.api.reports.get_db")
    async def test_generate_report_success(self, mock_get_db, client):
        """测试生成报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        data = {
            "report_type": "daily",
            "report_name": "日报测试",
            "station_id": str(uuid4()),
            "start_time": (datetime.now() - timedelta(days=1)).isoformat(),
            "end_time": datetime.now().isoformat(),
            "file_format": "pdf",
            "created_by": "admin"
        }
        
        response = client.post("/api/v1/reports/generate", json=data)
        assert response.status_code == 202
        result = response.json()
        assert result["status"] == "generating"
        assert "report_id" in result
        assert "report_code" in result
    
    @patch("app.api.reports.get_db")
    async def test_generate_report_without_name(self, mock_get_db, client):
        """测试生成报告不指定名称"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        data = {
            "report_type": "weekly",
            "start_time": (datetime.now() - timedelta(days=7)).isoformat(),
            "end_time": datetime.now().isoformat(),
            "file_format": "excel"
        }
        
        response = client.post("/api/v1/reports/generate", json=data)
        assert response.status_code == 202
        result = response.json()
        assert result["status"] == "generating"


class TestReportCRUD:
    """报告CRUD测试"""
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_list_reports(self, mock_select, mock_get_db, client):
        """测试获取报告列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_report = MagicMock()
        mock_report.id = uuid4()
        mock_report.to_dict.return_value = {
            "id": str(mock_report.id),
            "report_code": "RPT20240101000000A1B2C3",
            "report_type": "daily",
            "report_name": "测试日报",
            "status": "completed"
        }
        
        # 模拟查询结果
        mock_result = MagicMock()
        mock_result.scalar.return_value = 1
        mock_result.scalars.return_value.all.return_value = [mock_report]
        mock_db.execute.return_value = mock_result
        
        response = client.get("/api/v1/reports/")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
        assert len(result["items"]) == 1
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_list_reports_with_filters(self, mock_select, mock_get_db, client):
        """测试带过滤条件的报告列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        station_id = uuid4()
        
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result
        
        response = client.get(
            f"/api/v1/reports/?report_type=daily&station_id={station_id}&status=completed"
        )
        assert response.status_code == 200
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_get_report_success(self, mock_select, mock_get_db, client):
        """测试获取报告详情成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        report_id = uuid4()
        mock_report = MagicMock()
        mock_report.id = report_id
        mock_report.to_dict.return_value = {
            "id": str(report_id),
            "report_code": "RPT20240101000000A1B2C3",
            "report_name": "测试报告",
            "status": "completed"
        }
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_report
        mock_db.execute.return_value = mock_result
        
        response = client.get(f"/api/v1/reports/{report_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["report_name"] == "测试报告"
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_get_report_not_found(self, mock_select, mock_get_db, client):
        """测试获取报告详情不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result
        
        response = client.get(f"/api/v1/reports/{uuid4()}")
        assert response.status_code == 404
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    @patch("app.api.reports.os.path.exists")
    async def test_download_report_success(self, mock_exists, mock_select, mock_get_db, client):
        """测试下载报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        report_id = uuid4()
        mock_report = MagicMock()
        mock_report.id = report_id
        mock_report.status = "completed"
        mock_report.file_path = "/tmp/test_report.pdf"
        mock_report.report_name = "测试报告"
        mock_report.file_format = "pdf"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_report
        mock_db.execute.return_value = mock_result
        mock_exists.return_value = True
        
        with patch("app.api.reports.FileResponse") as mock_file_response:
            mock_file_response.return_value = MagicMock()
            response = client.get(f"/api/v1/reports/{report_id}/download")
            assert response.status_code == 200
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_download_report_not_ready(self, mock_select, mock_get_db, client):
        """测试下载报告未就绪"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        report_id = uuid4()
        mock_report = MagicMock()
        mock_report.id = report_id
        mock_report.status = "generating"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_report
        mock_db.execute.return_value = mock_result
        
        response = client.get(f"/api/v1/reports/{report_id}/download")
        assert response.status_code == 400
        assert "not ready" in response.json()["detail"].lower()
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    @patch("app.api.reports.os.path.exists")
    @patch("app.api.reports.os.remove")
    async def test_delete_report_success(self, mock_remove, mock_exists, mock_select, mock_get_db, client):
        """测试删除报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        report_id = uuid4()
        mock_report = MagicMock()
        mock_report.id = report_id
        mock_report.file_path = "/tmp/test_report.pdf"
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_report
        mock_db.execute.return_value = mock_result
        mock_exists.return_value = True
        
        response = client.delete(f"/api/v1/reports/{report_id}")
        assert response.status_code == 204
        mock_remove.assert_called_once_with("/tmp/test_report.pdf")
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_delete_report_not_found(self, mock_select, mock_get_db, client):
        """测试删除报告不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result
        
        response = client.delete(f"/api/v1/reports/{uuid4()}")
        assert response.status_code == 404


class TestReportStatistics:
    """报告统计测试"""
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_get_statistics(self, mock_select, mock_get_db, client):
        """测试获取报告统计"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        # 模拟统计查询结果
        mock_result = MagicMock()
        mock_result.scalar.side_effect = [100, 20]  # total, recent_7_days
        mock_result.all.side_effect = [
            [("daily", 40), ("weekly", 30), ("monthly", 30)],  # by_type
            [("completed", 80), ("failed", 20)]  # by_status
        ]
        mock_db.execute.return_value = mock_result
        
        response = client.get("/api/v1/reports/statistics/summary")
        assert response.status_code == 200
        result = response.json()
        assert result["total_reports"] == 100
        assert "by_type" in result
        assert "by_status" in result
        assert "recent_7_days" in result


class TestReportTemplates:
    """报告模板测试"""
    
    @patch("app.api.reports.get_db")
    async def test_create_template_success(self, mock_get_db, client):
        """测试创建模板成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_template = MagicMock()
        mock_template.id = uuid4()
        mock_template.to_dict.return_value = {
            "id": str(mock_template.id),
            "template_code": "TMP20240101000000A1B2",
            "template_name": "日报模板",
            "template_type": "daily"
        }
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        
        data = {
            "template_name": "日报模板",
            "template_type": "daily",
            "description": "日常监测日报模板",
            "content_structure": {"sections": ["summary", "data", "charts"]}
        }
        
        response = client.post("/api/v1/reports/templates", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["template_name"] == "日报模板"
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_list_templates(self, mock_select, mock_get_db, client):
        """测试获取模板列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_template = MagicMock()
        mock_template.id = uuid4()
        mock_template.to_dict.return_value = {
            "id": str(mock_template.id),
            "template_code": "TMP001",
            "template_name": "日报模板"
        }
        
        mock_result = MagicMock()
        mock_result.scalar.return_value = 1
        mock_result.scalars.return_value.all.return_value = [mock_template]
        mock_db.execute.return_value = mock_result
        
        response = client.get("/api/v1/reports/templates")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_update_template_success(self, mock_select, mock_get_db, client):
        """测试更新模板成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        template_id = uuid4()
        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.to_dict.return_value = {
            "id": str(template_id),
            "template_name": "更新后的模板名称"
        }
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_template
        mock_db.execute.return_value = mock_result
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        
        data = {"template_name": "更新后的模板名称"}
        
        response = client.put(f"/api/v1/reports/templates/{template_id}", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["template_name"] == "更新后的模板名称"
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_update_template_not_found(self, mock_select, mock_get_db, client):
        """测试更新模板不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result
        
        response = client.put(f"/api/v1/reports/templates/{uuid4()}", json={"template_name": "新名称"})
        assert response.status_code == 404


class TestScheduledReports:
    """定时报告测试"""
    
    @patch("app.api.reports.get_db")
    async def test_create_scheduled_report_success(self, mock_get_db, client):
        """测试创建定时报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_schedule = MagicMock()
        mock_schedule.id = uuid4()
        mock_schedule.to_dict.return_value = {
            "id": str(mock_schedule.id),
            "schedule_name": "每日日报",
            "report_type": "daily",
            "cron_expression": "0 8 * * *"
        }
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        
        data = {
            "schedule_name": "每日日报",
            "report_type": "daily",
            "cron_expression": "0 8 * * *",
            "station_ids": [str(uuid4())],
            "recipients": ["admin@example.com"]
        }
        
        response = client.post("/api/v1/reports/scheduled", json=data)
        assert response.status_code == 201
        result = response.json()
        assert result["schedule_name"] == "每日日报"
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_list_scheduled_reports(self, mock_select, mock_get_db, client):
        """测试获取定时报告列表"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_schedule = MagicMock()
        mock_schedule.id = uuid4()
        mock_schedule.to_dict.return_value = {
            "id": str(mock_schedule.id),
            "schedule_name": "每日日报",
            "cron_expression": "0 8 * * *"
        }
        
        mock_result = MagicMock()
        mock_result.scalar.return_value = 1
        mock_result.scalars.return_value.all.return_value = [mock_schedule]
        mock_db.execute.return_value = mock_result
        
        response = client.get("/api/v1/reports/scheduled")
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 1
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_update_scheduled_report_success(self, mock_select, mock_get_db, client):
        """测试更新定时报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        schedule_id = uuid4()
        mock_schedule = MagicMock()
        mock_schedule.id = schedule_id
        mock_schedule.to_dict.return_value = {
            "id": str(schedule_id),
            "schedule_name": "更新后的计划名称"
        }
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_schedule
        mock_db.execute.return_value = mock_result
        mock_db.flush = AsyncMock()
        mock_db.refresh = AsyncMock()
        
        data = {"schedule_name": "更新后的计划名称"}
        
        response = client.put(f"/api/v1/reports/scheduled/{schedule_id}", json=data)
        assert response.status_code == 200
        result = response.json()
        assert result["schedule_name"] == "更新后的计划名称"
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_delete_scheduled_report_success(self, mock_select, mock_get_db, client):
        """测试删除定时报告成功"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        schedule_id = uuid4()
        mock_schedule = MagicMock()
        mock_schedule.id = schedule_id
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_schedule
        mock_db.execute.return_value = mock_result
        
        response = client.delete(f"/api/v1/reports/scheduled/{schedule_id}")
        assert response.status_code == 204
    
    @patch("app.api.reports.get_db")
    @patch("app.api.reports.select")
    async def test_delete_scheduled_report_not_found(self, mock_select, mock_get_db, client):
        """测试删除定时报告不存在"""
        mock_db = AsyncMock()
        mock_get_db.return_value = mock_db
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result
        
        response = client.delete(f"/api/v1/reports/scheduled/{uuid4()}")
        assert response.status_code == 404
