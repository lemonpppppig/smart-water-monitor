"""
数据收集器
从其他服务收集报告所需数据
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import httpx

from app.report.config import settings

logger = logging.getLogger(__name__)


class DataCollector:
    """数据收集器"""
    
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def close(self):
        """关闭客户端"""
        await self.client.aclose()
    
    async def collect_station_data(self, station_id: str, 
                                   start_time: datetime, 
                                   end_time: datetime) -> Dict[str, Any]:
        """收集站点数据"""
        try:
            # 从数据服务获取历史数据
            url = f"{settings.DATA_SERVICE_URL}/api/v1/data/stations/{station_id}/history"
            params = {
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat()
            }
            
            response = await self.client.get(url, params=params)
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Failed to get station data: {response.status_code}")
                return {}
                
        except Exception as e:
            logger.error(f"Error collecting station data: {e}")
            return {}
    
    async def collect_station_statistics(self, station_id: str,
                                          start_time: datetime,
                                          end_time: datetime) -> Dict[str, Any]:
        """收集站点统计数据"""
        try:
            url = f"{settings.DATA_SERVICE_URL}/api/v1/data/stations/{station_id}/statistics"
            params = {
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat()
            }
            
            response = await self.client.get(url, params=params)
            if response.status_code == 200:
                return response.json()
            else:
                return {}
                
        except Exception as e:
            logger.error(f"Error collecting station statistics: {e}")
            return {}
    
    async def collect_alerts(self, station_id: Optional[str] = None,
                             start_time: Optional[datetime] = None,
                             end_time: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """收集预警数据"""
        try:
            url = f"{settings.ALERT_SERVICE_URL}/api/v1/alerts"
            params = {}
            
            if station_id:
                params["station_id"] = station_id
            if start_time:
                params["start_time"] = start_time.isoformat()
            if end_time:
                params["end_time"] = end_time.isoformat()
            
            response = await self.client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                return data.get("items", [])
            else:
                return []
                
        except Exception as e:
            logger.error(f"Error collecting alerts: {e}")
            return []
    
    async def collect_ai_analysis(self, station_id: str,
                                   data: Dict[str, float]) -> Dict[str, Any]:
        """收集AI分析结果"""
        try:
            url = f"{settings.AI_ENGINE_URL}/api/v1/ai/knowledge/analyze"
            payload = {"data": data}
            
            response = await self.client.post(url, json=payload)
            if response.status_code == 200:
                return response.json()
            else:
                return {}
                
        except Exception as e:
            logger.error(f"Error collecting AI analysis: {e}")
            return {}
    
    async def collect_comprehensive_data(self, station_id: Optional[str] = None,
                                          start_time: Optional[datetime] = None,
                                          end_time: Optional[datetime] = None) -> Dict[str, Any]:
        """收集综合数据（用于报告生成）"""
        data = {
            "station_id": station_id,
            "time_range": {
                "start": start_time.isoformat() if start_time else None,
                "end": end_time.isoformat() if end_time else None
            },
            "station_data": {},
            "statistics": {},
            "alerts": [],
            "ai_analysis": {}
        }
        
        # 收集站点数据
        if station_id:
            data["station_data"] = await self.collect_station_data(
                station_id, start_time, end_time
            )
            data["statistics"] = await self.collect_station_statistics(
                station_id, start_time, end_time
            )
        
        # 收集预警数据
        data["alerts"] = await self.collect_alerts(station_id, start_time, end_time)
        
        # 收集AI分析（如果有最新数据）
        latest_data = data["station_data"].get("data", [{}])[-1] if data["station_data"].get("data") else {}
        if latest_data:
            metrics = {k: v for k, v in latest_data.items() if k not in ["ts", "station_id"] and isinstance(v, (int, float))}
            if metrics:
                data["ai_analysis"] = await self.collect_ai_analysis(station_id, metrics)
        
        return data
