"""
业务逻辑层
"""
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
import httpx
import logging

from app.alert.models import Alert, AlertRule
from app.alert.config import settings

logger = logging.getLogger(__name__)


class AlertService:
    """预警服务"""
    
    @staticmethod
    async def create_alert(db: AsyncSession, alert_data: dict) -> Alert:
        """创建预警"""
        # 生成预警编码
        if not alert_data.get("alert_code"):
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            alert_data["alert_code"] = f"ALT{timestamp}{str(uuid.uuid4())[:6].upper()}"
        
        alert = Alert(**alert_data)
        db.add(alert)
        await db.flush()
        await db.refresh(alert)
        return alert
    
    @staticmethod
    async def get_alert_by_id(db: AsyncSession, alert_id: uuid.UUID, include_deleted: bool = False) -> Optional[Alert]:
        """根据ID获取预警（默认排除软删除）"""
        conditions = [Alert.id == alert_id]
        if not include_deleted:
            conditions.append(Alert.deleted_at.is_(None))
        result = await db.execute(
            select(Alert).where(and_(*conditions))
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_alerts(
        db: AsyncSession,
        station_id: Optional[uuid.UUID] = None,
        alert_type: Optional[str] = None,
        alert_level: Optional[str] = None,
        status: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Alert], int]:
        """获取预警列表（默认排除软删除）"""
        # 构建查询条件
        conditions = [Alert.deleted_at.is_(None)]
        if station_id:
            conditions.append(Alert.station_id == station_id)
        if alert_type:
            conditions.append(Alert.alert_type == alert_type)
        if alert_level:
            conditions.append(Alert.alert_level == alert_level)
        if status:
            conditions.append(Alert.status == status)
        if start_time:
            conditions.append(Alert.created_at >= start_time)
        if end_time:
            conditions.append(Alert.created_at <= end_time)
        
        # 查询总数
        count_query = select(func.count()).select_from(Alert)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar()
        
        # 查询数据
        query = select(Alert).order_by(Alert.created_at.desc())
        if conditions:
            query = query.where(and_(*conditions))
        query = query.offset(skip).limit(limit)
        
        result = await db.execute(query)
        alerts = result.scalars().all()
        
        return list(alerts), total
    
    @staticmethod
    async def update_alert(db: AsyncSession, alert: Alert, update_data: dict) -> Alert:
        """更新预警"""
        for key, value in update_data.items():
            if value is not None and hasattr(alert, key):
                setattr(alert, key, value)
        
        await db.flush()
        await db.refresh(alert)
        return alert
    
    @staticmethod
    async def confirm_alert(db: AsyncSession, alert: Alert, confirmed_by: str) -> Alert:
        """确认预警"""
        alert.status = "confirmed"
        alert.confirmed_by = confirmed_by
        alert.confirmed_at = datetime.utcnow()
        await db.flush()
        await db.refresh(alert)
        return alert
    
    @staticmethod
    async def resolve_alert(db: AsyncSession, alert: Alert, resolved_by: str, notes: str = None) -> Alert:
        """解决预警"""
        alert.status = "resolved"
        alert.resolved_by = resolved_by
        alert.resolved_at = datetime.utcnow()
        if notes:
            alert.resolution_notes = notes
        await db.flush()
        await db.refresh(alert)
        return alert

    @staticmethod
    async def delete_alert(db: AsyncSession, alert: Alert):
        """软删除预警记录"""
        alert.deleted_at = datetime.utcnow()
        await db.flush()

    @staticmethod
    async def restore_alert(db: AsyncSession, alert_id: uuid.UUID) -> Optional[Alert]:
        """恢复软删除的预警"""
        result = await db.execute(select(Alert).where(Alert.id == alert_id))
        alert = result.scalar_one_or_none()
        if alert and alert.deleted_at is not None:
            alert.deleted_at = None
            await db.flush()
            await db.refresh(alert)
        return alert

    @staticmethod
    async def hard_delete_alert(db: AsyncSession, alert: Alert):
        """物理删除预警记录"""
        await db.delete(alert)
        await db.flush()

    @staticmethod
    async def batch_delete_alerts(db: AsyncSession, alert_ids: List[uuid.UUID]) -> int:
        """批量软删除预警记录，返回实际删除条数"""
        if not alert_ids:
            return 0
        result = await db.execute(
            select(Alert).where(
                and_(Alert.id.in_(alert_ids), Alert.deleted_at.is_(None))
            )
        )
        rows = list(result.scalars().all())
        now = datetime.utcnow()
        for row in rows:
            row.deleted_at = now
        await db.flush()
        return len(rows)
    
    @staticmethod
    async def get_statistics(db: AsyncSession) -> Dict[str, Any]:
        """获取预警统计"""
        # 总数
        total_result = await db.execute(select(func.count()).select_from(Alert))
        total = total_result.scalar()
        
        # 按状态统计
        status_result = await db.execute(
            select(Alert.status, func.count())
            .group_by(Alert.status)
        )
        by_status = {row[0]: row[1] for row in status_result.all()}
        
        # 按级别统计
        level_result = await db.execute(
            select(Alert.alert_level, func.count())
            .group_by(Alert.alert_level)
        )
        by_level = {row[0]: row[1] for row in level_result.all()}
        
        # 按类型统计
        type_result = await db.execute(
            select(Alert.alert_type, func.count())
            .group_by(Alert.alert_type)
        )
        by_type = {row[0]: row[1] for row in type_result.all()}
        
        return {
            "total": total,
            "by_status": by_status,
            "by_level": by_level,
            "by_type": by_type
        }


class AlertRuleService:
    """预警规则服务"""
    
    @staticmethod
    async def create_rule(db: AsyncSession, rule_data: dict) -> AlertRule:
        """创建规则"""
        rule = AlertRule(**rule_data)
        db.add(rule)
        await db.flush()
        await db.refresh(rule)
        return rule
    
    @staticmethod
    async def get_rule_by_id(db: AsyncSession, rule_id: uuid.UUID) -> Optional[AlertRule]:
        """根据ID获取规则"""
        result = await db.execute(
            select(AlertRule).where(AlertRule.id == rule_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_rules(
        db: AsyncSession,
        rule_type: Optional[str] = None,
        is_enabled: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[AlertRule], int]:
        """获取规则列表"""
        conditions = []
        if rule_type:
            conditions.append(AlertRule.rule_type == rule_type)
        if is_enabled is not None:
            conditions.append(AlertRule.is_enabled == is_enabled)
        
        # 查询总数
        count_query = select(func.count()).select_from(AlertRule)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar()
        
        # 查询数据
        query = select(AlertRule).order_by(AlertRule.created_at.desc())
        if conditions:
            query = query.where(and_(*conditions))
        query = query.offset(skip).limit(limit)
        
        result = await db.execute(query)
        rules = result.scalars().all()
        
        return list(rules), total
    
    @staticmethod
    async def update_rule(db: AsyncSession, rule: AlertRule, update_data: dict) -> AlertRule:
        """更新规则"""
        for key, value in update_data.items():
            if value is not None and hasattr(rule, key):
                setattr(rule, key, value)
        
        await db.flush()
        await db.refresh(rule)
        return rule
    
    @staticmethod
    async def delete_rule(db: AsyncSession, rule: AlertRule):
        """删除规则"""
        await db.delete(rule)
    
    @staticmethod
    async def check_rules(db: AsyncSession, station_id: str, data: dict) -> List[dict]:
        """检查规则是否触发"""
        triggered = []
        
        # 获取启用的规则
        result = await db.execute(
            select(AlertRule).where(AlertRule.is_enabled == True)
        )
        rules = result.scalars().all()
        logger.info(f"[FLOW] alert_rule_check: station={station_id}, active_rules={len(rules)}, metrics={list(data.keys())}")
        
        for rule in rules:
            # 检查规则是否适用于该站点
            if rule.station_ids and uuid.UUID(station_id) not in rule.station_ids:
                continue
            
            # 检查条件
            conditions = rule.conditions
            if rule.rule_type == "threshold":
                # 阈值规则检查
                for metric_code, condition in conditions.items():
                    value = data.get(metric_code)
                    if value is not None:
                        min_val = condition.get("min")
                        max_val = condition.get("max")
                        
                        if min_val is not None and value < min_val:
                            triggered.append({
                                "rule_id": str(rule.id),
                                "rule_name": rule.rule_name,
                                "metric_code": metric_code,
                                "value": value,
                                "threshold": min_val,
                                "condition": "below_min",
                                "alert_level": rule.alert_level
                            })
                            logger.info(f"[FLOW] alert_triggered: rule={rule.rule_name}, metric={metric_code}, value={value}, threshold={min_val}, condition=below_min")
                        elif max_val is not None and value > max_val:
                            triggered.append({
                                "rule_id": str(rule.id),
                                "rule_name": rule.rule_name,
                                "metric_code": metric_code,
                                "value": value,
                                "threshold": max_val,
                                "condition": "above_max",
                                "alert_level": rule.alert_level
                            })
                            logger.info(f"[FLOW] alert_triggered: rule={rule.rule_name}, metric={metric_code}, value={value}, threshold={max_val}, condition=above_max")
        
        if not triggered:
            logger.info(f"[FLOW] alert_check_done: station={station_id}, no_trigger")
        return triggered


class NotificationService:
    """通知服务"""
    
    @staticmethod
    async def send_notification(alert: Alert, channels: List[str]):
        """发送通知"""
        for channel in channels:
            if channel == "app":
                await NotificationService._send_app_notification(alert)
            elif channel == "sms":
                await NotificationService._send_sms(alert)
            elif channel == "email":
                await NotificationService._send_email(alert)
            elif channel == "wechat":
                await NotificationService._send_wechat(alert)
    
    @staticmethod
    async def _send_app_notification(alert: Alert):
        """发送APP推送"""
        # TODO: 实现APP推送
        logger.info(f"APP notification sent for alert {alert.alert_code}")
    
    @staticmethod
    async def _send_sms(alert: Alert):
        """发送短信"""
        # TODO: 实现短信发送
        logger.info(f"SMS sent for alert {alert.alert_code}")
    
    @staticmethod
    async def _send_email(alert: Alert):
        """发送邮件"""
        # TODO: 实现邮件发送
        logger.info(f"Email sent for alert {alert.alert_code}")
    
    @staticmethod
    async def _send_wechat(alert: Alert):
        """发送微信通知"""
        # TODO: 实现微信通知
        logger.info(f"WeChat notification sent for alert {alert.alert_code}")
