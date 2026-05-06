"""
报告API路由
"""
import uuid
import os
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.report.database import get_db
from app.report.models import Report, ReportTemplate, ScheduledReport
from app.report.schemas import (
    ReportCreate, ReportUpdate, ReportResponse, ReportListResponse,
    ReportTemplateCreate, ReportTemplateUpdate, ReportTemplateResponse, ReportTemplateListResponse,
    ScheduledReportCreate, ScheduledReportUpdate, ScheduledReportResponse, ScheduledReportListResponse,
    GenerateReportRequest, GenerateReportResponse, ReportStatistics
)
from app.report.services.report_generator import ReportGenerator
from app.report.services.data_collector import DataCollector
from pydantic import BaseModel, Field


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    ids: List[uuid.UUID] = Field(..., description="要删除的 ID 列表")


router = APIRouter(prefix="/reports", tags=["reports"])

# 初始化服务
report_generator = ReportGenerator()


# 报告相关接口
@router.post("/generate", response_model=GenerateReportResponse, status_code=202)
async def generate_report(
    request: GenerateReportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """生成报告（异步）"""
    # 生成报告编码
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    report_code = f"RPT{timestamp}{str(uuid.uuid4())[:6].upper()}"
    
    # 报告名称
    report_name = request.report_name or f"{request.report_type.upper()}报告_{timestamp}"
    
    # 创建报告记录
    report = Report(
        report_code=report_code,
        report_type=request.report_type,
        report_name=report_name,
        station_id=request.station_id,
        start_time=request.start_time,
        end_time=request.end_time,
        file_format=request.file_format,
        status="generating",
        created_by=request.created_by
    )
    db.add(report)
    await db.flush()
    
    # 后台生成报告
    background_tasks.add_task(
        _generate_report_task,
        report.id,
        report_code,
        report_name,
        request
    )
    
    return {
        "report_id": report.id,
        "report_code": report_code,
        "status": "generating",
        "message": "报告生成中，请稍后查询"
    }


async def _generate_report_task(report_id: uuid.UUID, report_code: str, 
                                report_name: str, request: GenerateReportRequest):
    """后台生成报告任务"""
    from app.report.database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        try:
            # 收集数据
            data_collector = DataCollector()
            data = await data_collector.collect_comprehensive_data(
                str(request.station_id) if request.station_id else None,
                request.start_time,
                request.end_time
            )
            await data_collector.close()
            
            # 生成报告文件
            file_path = await report_generator.generate(
                report_code,
                report_name,
                request.file_format,
                data
            )
            
            # 更新报告记录
            result = await db.execute(select(Report).where(Report.id == report_id))
            report = result.scalar_one_or_none()
            
            if report:
                if file_path:
                    report.status = "completed"
                    report.file_path = file_path
                    report.file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                    report.content = {
                        "data_summary": {
                            "data_points": len(data.get("station_data", {}).get("data", [])),
                            "alerts_count": len(data.get("alerts", []))
                        }
                    }
                else:
                    report.status = "failed"
                    report.error_message = "Failed to generate report file"
                
                await db.commit()
                
        except Exception as e:
            # 更新失败状态
            result = await db.execute(select(Report).where(Report.id == report_id))
            report = result.scalar_one_or_none()
            if report:
                report.status = "failed"
                report.error_message = str(e)
                await db.commit()


@router.get("", response_model=ReportListResponse)
async def list_reports(
    report_type: Optional[str] = Query(None, description="报告类型"),
    station_id: Optional[uuid.UUID] = Query(None, description="站点ID"),
    status: Optional[str] = Query(None, description="状态"),
    start_time: Optional[datetime] = Query(None, description="开始时间"),
    end_time: Optional[datetime] = Query(None, description="结束时间"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取报告列表"""
    conditions = []
    if report_type:
        conditions.append(Report.report_type == report_type)
    if station_id:
        conditions.append(Report.station_id == station_id)
    if status:
        conditions.append(Report.status == status)
    if start_time:
        conditions.append(Report.created_at >= start_time)
    if end_time:
        conditions.append(Report.created_at <= end_time)
    
    # 查询总数
    count_query = select(func.count()).select_from(Report)
    if conditions:
        count_query = count_query.where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # 查询数据
    query = select(Report).order_by(Report.created_at.desc())
    if conditions:
        query = query.where(and_(*conditions))
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    reports = result.scalars().all()
    
    return {
        "total": total,
        "items": [r.to_dict() for r in reports]
    }


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取报告详情"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return report.to_dict()


@router.get("/{report_id}/download")
async def download_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """下载报告"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if report.status != "completed":
        raise HTTPException(status_code=400, detail="Report not ready")
    
    if not report.file_path or not os.path.exists(report.file_path):
        raise HTTPException(status_code=404, detail="Report file not found")
    
    from fastapi.responses import FileResponse
    
    filename = f"{report.report_name}.{report.file_format}"
    media_type = "application/pdf" if report.file_format == "pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    return FileResponse(
        report.file_path,
        media_type=media_type,
        filename=filename
    )


@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: uuid.UUID,
    report_update: ReportUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新报告元信息（名称/状态）"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    update_data = report_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(report, key, value)

    await db.flush()
    await db.refresh(report)
    return report.to_dict()


@router.delete("/{report_id}", status_code=204)
async def delete_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除报告"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    # 删除文件
    if report.file_path and os.path.exists(report.file_path):
        os.remove(report.file_path)
    
    await db.delete(report)
    await db.commit()
    
    return None


@router.post("/batch-delete")
async def batch_delete_reports(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """批量删除报告"""
    if not request.ids:
        return {"deleted": 0, "requested": 0}

    result = await db.execute(select(Report).where(Report.id.in_(request.ids)))
    reports = list(result.scalars().all())
    for report in reports:
        if report.file_path and os.path.exists(report.file_path):
            try:
                os.remove(report.file_path)
            except OSError:
                pass
        await db.delete(report)
    await db.commit()
    return {"deleted": len(reports), "requested": len(request.ids)}


@router.get("/statistics/summary", response_model=ReportStatistics)
async def get_statistics(db: AsyncSession = Depends(get_db)):
    """获取报告统计"""
    # 总数
    total_result = await db.execute(select(func.count()).select_from(Report))
    total = total_result.scalar()
    
    # 按类型统计
    type_result = await db.execute(
        select(Report.report_type, func.count())
        .group_by(Report.report_type)
    )
    by_type = {row[0]: row[1] for row in type_result.all()}
    
    # 按状态统计
    status_result = await db.execute(
        select(Report.status, func.count())
        .group_by(Report.status)
    )
    by_status = {row[0]: row[1] for row in status_result.all()}
    
    # 近7天
    week_ago = datetime.now() - timedelta(days=7)
    recent_result = await db.execute(
        select(func.count()).select_from(Report).where(Report.created_at >= week_ago)
    )
    recent_7_days = recent_result.scalar()
    
    return {
        "total_reports": total,
        "by_type": by_type,
        "by_status": by_status,
        "recent_7_days": recent_7_days
    }


# 报告模板相关接口
@router.post("/templates", response_model=ReportTemplateResponse, status_code=201)
async def create_template(
    template: ReportTemplateCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建报告模板"""
    # 生成模板编码
    if not template.template_code:
        template.template_code = f"TMP{datetime.now().strftime('%Y%m%d%H%M%S')}{str(uuid.uuid4())[:4].upper()}"
    
    template_data = template.model_dump()
    new_template = ReportTemplate(**template_data)
    db.add(new_template)
    await db.flush()
    await db.refresh(new_template)
    
    return new_template.to_dict()


@router.get("/templates", response_model=ReportTemplateListResponse)
async def list_templates(
    template_type: Optional[str] = Query(None, description="模板类型"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取模板列表"""
    conditions = []
    if template_type:
        conditions.append(ReportTemplate.template_type == template_type)
    
    # 查询总数
    count_query = select(func.count()).select_from(ReportTemplate)
    if conditions:
        count_query = count_query.where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # 查询数据
    query = select(ReportTemplate).order_by(ReportTemplate.created_at.desc())
    if conditions:
        query = query.where(and_(*conditions))
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    templates = result.scalars().all()
    
    return {
        "total": total,
        "items": [t.to_dict() for t in templates]
    }


@router.post("/templates/batch-delete")
async def batch_delete_templates(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除模板"""
    deleted = 0
    for tid in request.ids:
        res = await db.execute(select(ReportTemplate).where(ReportTemplate.id == tid))
        tpl = res.scalar_one_or_none()
        if tpl:
            await db.delete(tpl)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "total": len(request.ids)}


@router.get("/templates/{template_id}", response_model=ReportTemplateResponse)
async def get_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取模板详情"""
    result = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl.to_dict()


@router.put("/templates/{template_id}", response_model=ReportTemplateResponse)
async def update_template(
    template_id: uuid.UUID,
    template_update: ReportTemplateUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新模板"""
    result = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    update_data = template_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(template, key, str(value).lower() if isinstance(value, bool) else value)
    
    await db.flush()
    await db.refresh(template)
    return template.to_dict()


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除模板"""
    result = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tpl)
    await db.commit()
    return None


# 定时报告相关接口
@router.post("/scheduled", response_model=ScheduledReportResponse, status_code=201)
async def create_scheduled_report(
    schedule: ScheduledReportCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建定时报告"""
    schedule_data = schedule.model_dump()
    new_schedule = ScheduledReport(**schedule_data)
    db.add(new_schedule)
    await db.flush()
    await db.refresh(new_schedule)
    
    return new_schedule.to_dict()


@router.get("/scheduled", response_model=ScheduledReportListResponse)
async def list_scheduled_reports(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取定时报告列表"""
    # 查询总数
    total_result = await db.execute(select(func.count()).select_from(ScheduledReport))
    total = total_result.scalar()
    
    # 查询数据
    query = select(ScheduledReport).order_by(ScheduledReport.created_at.desc())
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    schedules = result.scalars().all()
    
    return {
        "total": total,
        "items": [s.to_dict() for s in schedules]
    }


@router.post("/scheduled/batch-delete")
async def batch_delete_scheduled_reports(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除定时报告"""
    deleted = 0
    for sid in request.ids:
        res = await db.execute(select(ScheduledReport).where(ScheduledReport.id == sid))
        s = res.scalar_one_or_none()
        if s:
            await db.delete(s)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "total": len(request.ids)}


@router.get("/scheduled/{schedule_id}", response_model=ScheduledReportResponse)
async def get_scheduled_report(
    schedule_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取定时报告详情"""
    result = await db.execute(select(ScheduledReport).where(ScheduledReport.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule.to_dict()


@router.put("/scheduled/{schedule_id}", response_model=ScheduledReportResponse)
async def update_scheduled_report(
    schedule_id: uuid.UUID,
    schedule_update: ScheduledReportUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新定时报告"""
    result = await db.execute(select(ScheduledReport).where(ScheduledReport.id == schedule_id))
    schedule = result.scalar_one_or_none()
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    update_data = schedule_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(schedule, key, str(value).lower() if isinstance(value, bool) else value)
    
    await db.flush()
    await db.refresh(schedule)
    return schedule.to_dict()


@router.delete("/scheduled/{schedule_id}", status_code=204)
async def delete_scheduled_report(
    schedule_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除定时报告"""
    result = await db.execute(select(ScheduledReport).where(ScheduledReport.id == schedule_id))
    schedule = result.scalar_one_or_none()
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    
    await db.delete(schedule)
    await db.commit()
    
    return None
