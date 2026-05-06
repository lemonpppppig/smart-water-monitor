"""
Pydantic Schema Definitions
"""
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


# 报告相关Schema
class ReportBase(BaseModel):
    """报告基础Schema"""
    report_type: str = Field(..., description="报告类型: daily, weekly, monthly, alert, custom")
    report_name: str = Field(..., description="报告名称", max_length=256)
    station_id: Optional[UUID] = Field(None, description="站点ID")
    start_time: Optional[datetime] = Field(None, description="数据开始时间")
    end_time: Optional[datetime] = Field(None, description="数据结束时间")


class ReportCreate(ReportBase):
    """创建报告请求"""
    file_format: str = Field(default="pdf", description="文件格式: pdf, excel")
    created_by: Optional[str] = Field(None, description="创建人")


class ReportUpdate(BaseModel):
    """更新报告请求"""
    report_name: Optional[str] = Field(None, max_length=256)
    status: Optional[str] = Field(None, description="状态")


class ReportResponse(BaseModel):
    """报告响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    report_code: str
    report_type: str
    report_name: str
    station_id: Optional[UUID]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    content: Optional[Dict[str, Any]]
    file_path: Optional[str]
    file_format: str
    file_size: Optional[int]
    status: str
    error_message: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime


class ReportListResponse(BaseModel):
    """报告列表响应"""
    total: int
    items: List[ReportResponse]


class ReportContent(BaseModel):
    """报告内容"""
    summary: Dict[str, Any] = Field(..., description="报告摘要")
    data_analysis: Dict[str, Any] = Field(..., description="数据分析")
    alerts: List[Dict[str, Any]] = Field(default_factory=list, description="预警信息")
    charts: List[Dict[str, Any]] = Field(default_factory=list, description="图表数据")
    recommendations: List[str] = Field(default_factory=list, description="建议")


# 报告模板相关Schema
class ReportTemplateBase(BaseModel):
    """报告模板基础Schema"""
    template_name: str = Field(..., description="模板名称", max_length=128)
    template_type: str = Field(..., description="模板类型")
    description: Optional[str] = Field(None, description="模板描述")
    content_structure: Dict[str, Any] = Field(..., description="内容结构配置")


class ReportTemplateCreate(ReportTemplateBase):
    """创建模板请求"""
    template_code: Optional[str] = Field(None, description="模板编码")


class ReportTemplateUpdate(BaseModel):
    """更新模板请求"""
    template_name: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = None
    content_structure: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None
    is_enabled: Optional[bool] = None


class ReportTemplateResponse(BaseModel):
    """模板响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    template_code: str
    template_name: str
    template_type: str
    description: Optional[str]
    content_structure: Dict[str, Any]
    is_default: str
    is_enabled: str
    created_at: datetime
    updated_at: datetime


class ReportTemplateListResponse(BaseModel):
    """模板列表响应"""
    total: int
    items: List[ReportTemplateResponse]


# 定时报告相关Schema
class ScheduledReportBase(BaseModel):
    """定时报告基础Schema"""
    schedule_name: str = Field(..., description="计划名称", max_length=128)
    report_type: str = Field(..., description="报告类型")
    station_ids: Optional[List[UUID]] = Field(None, description="站点ID列表")
    cron_expression: str = Field(..., description="Cron表达式")
    recipients: List[str] = Field(default_factory=list, description="接收人列表")


class ScheduledReportCreate(ScheduledReportBase):
    """创建定时报告请求"""
    pass


class ScheduledReportUpdate(BaseModel):
    """更新定时报告请求"""
    schedule_name: Optional[str] = Field(None, max_length=128)
    cron_expression: Optional[str] = None
    recipients: Optional[List[str]] = None
    is_enabled: Optional[bool] = None


class ScheduledReportResponse(BaseModel):
    """定时报告响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    schedule_name: str
    report_type: str
    station_ids: Optional[List[UUID]]
    cron_expression: str
    recipients: List[str]
    is_enabled: str
    last_run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class ScheduledReportListResponse(BaseModel):
    """定时报告列表响应"""
    total: int
    items: List[ScheduledReportResponse]


# 报告生成相关Schema
class GenerateReportRequest(BaseModel):
    """生成报告请求"""
    report_type: str = Field(..., description="报告类型")
    report_name: Optional[str] = Field(None, description="报告名称")
    station_id: Optional[UUID] = Field(None, description="站点ID")
    start_time: datetime = Field(..., description="数据开始时间")
    end_time: datetime = Field(..., description="数据结束时间")
    file_format: str = Field(default="pdf", description="文件格式")
    created_by: Optional[str] = Field(None, description="创建人")


class GenerateReportResponse(BaseModel):
    """生成报告响应"""
    report_id: UUID = Field(..., description="报告ID")
    report_code: str = Field(..., description="报告编码")
    status: str = Field(..., description="状态")
    message: str = Field(..., description="消息")


# 统计数据相关Schema
class ReportStatistics(BaseModel):
    """报告统计"""
    total_reports: int
    by_type: Dict[str, int]
    by_status: Dict[str, int]
    recent_7_days: int
