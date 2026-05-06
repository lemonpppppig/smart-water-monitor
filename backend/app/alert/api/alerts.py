"""
预警API路由
"""
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.alert.database import get_db
from app.alert.services import AlertService, AlertRuleService, NotificationService
from pydantic import BaseModel, Field

from app.alert.schemas import (
    AlertCreate, AlertUpdate, AlertConfirm, AlertResolve, AlertResponse, AlertListResponse,
    AlertRuleCreate, AlertRuleUpdate, AlertRuleResponse, AlertRuleListResponse,
    AlertStatistics, RuleCheckRequest, RuleCheckResponse
)


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    ids: List[UUID] = Field(..., description="要删除的 ID 列表")

router = APIRouter(prefix="/alerts", tags=["alerts"])


# ========== 预警规则相关接口 - 必须定义在 /{alert_id} 之前 ==========
@router.post("/rules", response_model=AlertRuleResponse, status_code=201)
async def create_rule(
    rule: AlertRuleCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建预警规则"""
    rule_data = rule.model_dump()
    new_rule = await AlertRuleService.create_rule(db, rule_data)
    return new_rule.to_dict()


@router.get("/rules", response_model=AlertRuleListResponse)
async def list_rules(
    rule_type: Optional[str] = Query(None, description="规则类型"),
    is_enabled: Optional[bool] = Query(None, description="是否启用"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取规则列表"""
    rules, total = await AlertRuleService.list_rules(db, rule_type, is_enabled, skip, limit)
    return {
        "total": total,
        "items": [r.to_dict() for r in rules]
    }


@router.get("/rules/{rule_id}", response_model=AlertRuleResponse)
async def get_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取规则详情"""
    rule = await AlertRuleService.get_rule_by_id(db, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule.to_dict()


@router.put("/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_rule(
    rule_id: UUID,
    rule_update: AlertRuleUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新规则"""
    rule = await AlertRuleService.get_rule_by_id(db, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    update_data = rule_update.model_dump(exclude_unset=True)
    updated_rule = await AlertRuleService.update_rule(db, rule, update_data)
    return updated_rule.to_dict()


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """删除规则"""
    rule = await AlertRuleService.get_rule_by_id(db, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    await AlertRuleService.delete_rule(db, rule)
    return None


@router.post("/rules/batch-delete")
async def batch_delete_rules(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """批量删除规则"""
    deleted = 0
    for rid in request.ids:
        rule = await AlertRuleService.get_rule_by_id(db, rid)
        if rule:
            await AlertRuleService.delete_rule(db, rule)
            deleted += 1
    return {"deleted": deleted, "total": len(request.ids)}


@router.post("/rules/check", response_model=RuleCheckResponse)
async def check_rules(
    check_request: RuleCheckRequest,
    db: AsyncSession = Depends(get_db)
):
    """检查规则是否触发"""
    triggered_rules = await AlertRuleService.check_rules(
        db, check_request.station_id, check_request.data
    )
    
    return {
        "triggered": len(triggered_rules) > 0,
        "triggered_rules": triggered_rules
    }


# ========== 统计接口 - 必须定义在 /{alert_id} 之前 ==========
@router.get("/statistics/summary", response_model=AlertStatistics)
async def get_statistics(
    db: AsyncSession = Depends(get_db)
):
    """获取预警统计"""
    stats = await AlertService.get_statistics(db)
    return stats


# ========== 预警相关接口 ==========
@router.post("", response_model=AlertResponse, status_code=201)
async def create_alert(
    alert: AlertCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建预警"""
    alert_data = alert.model_dump()
    new_alert = await AlertService.create_alert(db, alert_data)
    
    # 发送通知
    if alert_data.get("notification_channels"):
        await NotificationService.send_notification(
            new_alert, alert_data["notification_channels"]
        )
    
    return new_alert.to_dict()


@router.get("", response_model=AlertListResponse)
async def list_alerts(
    station_id: Optional[UUID] = Query(None, description="站点ID"),
    alert_type: Optional[str] = Query(None, description="预警类型"),
    alert_level: Optional[str] = Query(None, description="预警级别"),
    status: Optional[str] = Query(None, description="状态"),
    start_time: Optional[datetime] = Query(None, description="开始时间"),
    end_time: Optional[datetime] = Query(None, description="结束时间"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取预警列表"""
    alerts, total = await AlertService.list_alerts(
        db, station_id, alert_type, alert_level, status, start_time, end_time, skip, limit
    )
    return {
        "total": total,
        "items": [a.to_dict() for a in alerts]
    }


@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """获取预警详情"""
    alert = await AlertService.get_alert_by_id(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert.to_dict()


@router.put("/{alert_id}", response_model=AlertResponse)
async def update_alert(
    alert_id: UUID,
    alert_update: AlertUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新预警"""
    alert = await AlertService.get_alert_by_id(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    update_data = alert_update.model_dump(exclude_unset=True)
    updated_alert = await AlertService.update_alert(db, alert, update_data)
    return updated_alert.to_dict()


@router.post("/{alert_id}/confirm", response_model=AlertResponse)
async def confirm_alert(
    alert_id: UUID,
    confirm_data: AlertConfirm,
    db: AsyncSession = Depends(get_db)
):
    """确认预警"""
    alert = await AlertService.get_alert_by_id(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    updated_alert = await AlertService.confirm_alert(db, alert, confirm_data.confirmed_by)
    return updated_alert.to_dict()


@router.post("/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert(
    alert_id: UUID,
    resolve_data: AlertResolve,
    db: AsyncSession = Depends(get_db)
):
    """解决预警"""
    alert = await AlertService.get_alert_by_id(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    updated_alert = await AlertService.resolve_alert(
        db, alert, resolve_data.resolved_by, resolve_data.notes
    )
    return updated_alert.to_dict()


@router.post("/batch-delete")
async def batch_delete_alerts(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """批量删除预警"""
    deleted = await AlertService.batch_delete_alerts(db, request.ids)
    return {"deleted": deleted, "requested": len(request.ids)}


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """软删除单条预警"""
    alert = await AlertService.get_alert_by_id(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    await AlertService.delete_alert(db, alert)
    return None


@router.post("/{alert_id}/restore", response_model=AlertResponse)
async def restore_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """恢复软删除的预警"""
    alert = await AlertService.restore_alert(db, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found or not deleted")
    return alert.to_dict()
