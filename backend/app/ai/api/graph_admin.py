"""
\u56fe\u8c31\u7ba1\u7406 API - River / PollutionSource / Confluence / District / EmergencyPlan
\u8def\u7531\u524d\u7f00\uff1a/api/v1/ai/graph-admin
\u57fa\u4e8e Neo4j \u6301\u4e45\u5316\uff0c\u5237\u65b0/\u91cd\u542f\u540e\u6570\u636e\u6b63\u5e38\u5b58\u5728
"""
import asyncio
import io
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.ai.api.ai import graph_engine
from app.ai.database import AsyncSessionLocal
from app.ai.models import GraphCanvasLayoutORM

router = APIRouter(prefix="/ai/graph-admin", tags=["graph-admin"])


# ============ Pydantic Schemas ============
class RiverPayload(BaseModel):
    river_id: str = Field(..., description="\u6cb3\u6d41ID")
    name: str = Field(..., description="\u540d\u79f0")
    level: Optional[int] = Field(None, description="\u7ea7\u522b")
    system: Optional[str] = Field(None, description="\u6240\u5c5e\u6c34\u7cfb")
    sub_system: Optional[str] = Field(None, description="\u5b50\u6c34\u7cfb")
    length_km: Optional[float] = None
    basin_area_km2: Optional[float] = None
    type: Optional[str] = None
    description: Optional[str] = None


class RiverUpdate(BaseModel):
    name: Optional[str] = None
    level: Optional[int] = None
    system: Optional[str] = None
    sub_system: Optional[str] = None
    length_km: Optional[float] = None
    basin_area_km2: Optional[float] = None
    type: Optional[str] = None
    description: Optional[str] = None


class RiverFlowRelation(BaseModel):
    upstream_id: str
    downstream_id: str
    distance_km: Optional[float] = None
    confluence_id: Optional[str] = None


class PollutionSourcePayload(BaseModel):
    source_id: str
    name: str
    category: str = Field(..., description="IndustrialSource / AgriculturalSource / MunicipalSource")
    source_type: Optional[str] = None
    river_id: Optional[str] = None
    district_code: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    pollutants: Optional[List[str]] = None
    risk_level: Optional[str] = None
    discharge_volume: Optional[float] = None
    capacity: Optional[float] = None
    livestock_count: Optional[int] = None
    area_km2: Optional[float] = None
    description: Optional[str] = None


class PollutionSourceUpdate(BaseModel):
    name: Optional[str] = None
    source_type: Optional[str] = None
    river_id: Optional[str] = None
    district_code: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    pollutants: Optional[List[str]] = None
    risk_level: Optional[str] = None
    discharge_volume: Optional[float] = None
    capacity: Optional[float] = None
    livestock_count: Optional[int] = None
    area_km2: Optional[float] = None
    description: Optional[str] = None


class ConfluencePayload(BaseModel):
    confluence_id: str
    name: str
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    district_code: Optional[str] = None
    priority: Optional[int] = None
    description: Optional[str] = None
    is_boundary: Optional[bool] = None
    confluence_type: Optional[str] = None      # 'merge' | 'tributary'
    through_river_id: Optional[str] = None     # 汇入型时，贯通的主河流 ID


class ConfluenceUpdate(BaseModel):
    name: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    district_code: Optional[str] = None
    priority: Optional[int] = None
    description: Optional[str] = None
    is_boundary: Optional[bool] = None
    confluence_type: Optional[str] = None
    through_river_id: Optional[str] = None


class DistrictPayload(BaseModel):
    code: str
    name: str
    level: Optional[str] = None
    parent_code: Optional[str] = None


class DistrictUpdate(BaseModel):
    name: Optional[str] = None
    level: Optional[str] = None
    parent_code: Optional[str] = None


class EmergencyPlanPayload(BaseModel):
    plan_id: str
    name: str
    priority: Optional[int] = None
    steps: Optional[List[str]] = None
    description: Optional[str] = None
    pollution_types: Optional[List[str]] = Field(None, description="\u5173\u8054\u7684\u6c61\u67d3\u7c7b\u578b type_id \u5217\u8868")


class EmergencyPlanUpdate(BaseModel):
    name: Optional[str] = None
    priority: Optional[int] = None
    steps: Optional[List[str]] = None
    description: Optional[str] = None
    pollution_types: Optional[List[str]] = None


def _filter_none(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


# ============ River ============
@router.post("/rivers", status_code=201)
async def create_river(payload: RiverPayload):
    data = payload.model_dump()
    river_id = data.pop("river_id")
    props = _filter_none(data)
    row = await asyncio.to_thread(graph_engine.upsert_river, river_id, props)
    return {"success": True, "data": row}


@router.post("/rivers/flows", status_code=201)
async def create_river_flow(payload: RiverFlowRelation):
    await asyncio.to_thread(
        graph_engine.create_river_flows_into,
        payload.upstream_id, payload.downstream_id,
        payload.distance_km, payload.confluence_id,
    )
    return {"success": True}


@router.delete("/rivers/flows", status_code=204)
async def delete_river_flow(upstream_id: str, downstream_id: str):
    ok = await asyncio.to_thread(
        graph_engine.delete_river_flows_into, upstream_id, downstream_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Flow relation not found")
    return None


@router.put("/rivers/{river_id}")
async def update_river(river_id: str, payload: RiverUpdate):
    existing = await asyncio.to_thread(graph_engine.get_river, river_id)
    if not existing:
        raise HTTPException(status_code=404, detail="River not found")
    props = _filter_none(payload.model_dump(exclude_unset=True))
    row = await asyncio.to_thread(graph_engine.upsert_river, river_id, props)
    return {"success": True, "data": row}


@router.delete("/rivers/{river_id}", status_code=204)
async def delete_river(river_id: str):
    ok = await asyncio.to_thread(graph_engine.delete_river, river_id)
    if not ok:
        raise HTTPException(status_code=404, detail="River not found")
    return None


# ============ PollutionSource ============
@router.post("/pollution-sources", status_code=201)
async def create_pollution_source(payload: PollutionSourcePayload):
    data = payload.model_dump()
    source_id = data.pop("source_id")
    category = data.pop("category")
    props = _filter_none(data)
    try:
        row = await asyncio.to_thread(
            graph_engine.upsert_pollution_source, source_id, category, props
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if props.get("river_id"):
        await asyncio.to_thread(
            graph_engine.link_pollution_to_river, source_id, props["river_id"]
        )
    return {"success": True, "data": row}


@router.put("/pollution-sources/{source_id}")
async def update_pollution_source(source_id: str, payload: PollutionSourceUpdate):
    existing = await asyncio.to_thread(graph_engine.get_pollution_source_detail, source_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Pollution source not found")
    # 保持原 category
    category = existing.get("category") or "IndustrialSource"
    update_data = payload.model_dump(exclude_unset=True)
    props = _filter_none(update_data)
    try:
        row = await asyncio.to_thread(
            graph_engine.upsert_pollution_source, source_id, category, props
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # 改绑事务：如果显式传了 river_id（包括传 null/空字符串），先解所有旧关系，再按需建新关系
    if "river_id" in update_data:
        await asyncio.to_thread(graph_engine.unlink_pollution_from_all_rivers, source_id)
        new_river = update_data.get("river_id")
        if new_river:
            await asyncio.to_thread(
                graph_engine.link_pollution_to_river, source_id, new_river
            )
    return {"success": True, "data": row}


@router.post("/pollution-sources/{source_id}/river/{river_id}", status_code=201)
async def bind_pollution_source_to_river(source_id: str, river_id: str):
    existing = await asyncio.to_thread(graph_engine.get_pollution_source_detail, source_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Pollution source not found")
    river = await asyncio.to_thread(graph_engine.get_river, river_id)
    if not river:
        raise HTTPException(status_code=404, detail="River not found")
    await asyncio.to_thread(graph_engine.link_pollution_to_river, source_id, river_id)
    return {"success": True, "source_id": source_id, "river_id": river_id}


@router.delete("/pollution-sources/{source_id}/river/{river_id}", status_code=204)
async def unbind_pollution_source_from_river(source_id: str, river_id: str):
    ok = await asyncio.to_thread(
        graph_engine.unlink_pollution_from_river, source_id, river_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Pollution-River link not found")
    return None


@router.delete("/pollution-sources/{source_id}", status_code=204)
async def delete_pollution_source(source_id: str):
    ok = await asyncio.to_thread(graph_engine.delete_pollution_source, source_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Pollution source not found")
    return None


# ============ Station 拓扑：上下游 + 挂到河流 + 属性更新 ============
class StationPropsUpdate(BaseModel):
    name: Optional[str] = None
    station_name: Optional[str] = None
    station_code: Optional[str] = None
    river_km: Optional[float] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    status: Optional[str] = None
    district: Optional[str] = None


@router.put("/stations/{station_id}", status_code=200)
async def update_station_props(station_id: str, payload: StationPropsUpdate):
    """更新站点节点属性（不存在时 MERGE 补建）。"""
    props = payload.model_dump(exclude_none=True)
    # name 同时写入 station_name 保持一致
    if 'name' in props and 'station_name' not in props:
        props['station_name'] = props['name']
    ok = await asyncio.to_thread(graph_engine.update_station_props, station_id, **props)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to update station")
    return {"success": True, "station_id": station_id}


class StationFlowRelation(BaseModel):
    upstream_id: str
    downstream_id: str
    distance_km: Optional[float] = None
    travel_hours: Optional[float] = None


@router.post("/stations/flows", status_code=201)
async def create_station_flow(payload: StationFlowRelation):
    """新建站点上下游关系：(Station)-[:UPSTREAM_OF]->(Station)"""
    ok = await asyncio.to_thread(
        graph_engine.create_flow_relationship,
        payload.upstream_id, payload.downstream_id,
        payload.distance_km, payload.travel_hours,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to create station flow")
    return {"success": True}


@router.delete("/stations/flows", status_code=204)
async def delete_station_flow(upstream_id: str, downstream_id: str):
    ok = await asyncio.to_thread(
        graph_engine.delete_station_flow, upstream_id, downstream_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Station flow not found")
    return None


@router.post("/stations/{station_id}/river/{river_id}", status_code=201)
async def bind_station_to_river(station_id: str, river_id: str):
    """站点挂到河流：(Station)-[:ON_RIVER]->(River)。站点节点不存在时自动 MERGE 补建。"""
    river = await asyncio.to_thread(graph_engine.get_river, river_id)
    if not river:
        raise HTTPException(status_code=404, detail="River not found")
    await asyncio.to_thread(graph_engine.link_station_to_river, station_id, river_id)
    return {"success": True, "station_id": station_id, "river_id": river_id}


@router.delete("/stations/{station_id}/river/{river_id}", status_code=204)
async def unbind_station_from_river(station_id: str, river_id: str):
    ok = await asyncio.to_thread(
        graph_engine.unlink_station_from_river, station_id, river_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Station-River link not found")
    return None


# ============ Confluence ============
@router.post("/confluences", status_code=201)
async def create_confluence(payload: ConfluencePayload):
    data = payload.model_dump()
    cid = data.pop("confluence_id")
    props = _filter_none(data)
    row = await asyncio.to_thread(graph_engine.upsert_confluence, cid, props)
    return {"success": True, "data": row}


@router.put("/confluences/{confluence_id}")
async def update_confluence(confluence_id: str, payload: ConfluenceUpdate):
    existing = await asyncio.to_thread(graph_engine.get_confluence, confluence_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Confluence not found")
    props = _filter_none(payload.model_dump(exclude_unset=True))
    row = await asyncio.to_thread(graph_engine.upsert_confluence, confluence_id, props)
    return {"success": True, "data": row}


@router.delete("/confluences/{confluence_id}", status_code=204)
async def delete_confluence(confluence_id: str):
    ok = await asyncio.to_thread(graph_engine.delete_confluence, confluence_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Confluence not found")
    return None


# ============ Confluence 拓扑关系（河流↔交汇点）============
class RiverConfluenceRelation(BaseModel):
    river_id: str
    confluence_id: str
    distance_km: Optional[float] = None


@router.post("/confluences/inflow", status_code=201)
async def create_confluence_inflow(payload: RiverConfluenceRelation):
    """河流汇入交汇点：(River)-[:FLOWS_INTO_CONFLUENCE]->(Confluence)"""
    ok = await asyncio.to_thread(
        graph_engine.link_river_to_confluence,
        payload.river_id, payload.confluence_id, payload.distance_km,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to create river→confluence relation")
    return {"success": True}


@router.delete("/confluences/inflow", status_code=204)
async def delete_confluence_inflow(river_id: str, confluence_id: str):
    ok = await asyncio.to_thread(
        graph_engine.unlink_river_from_confluence, river_id, confluence_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="River→confluence relation not found")
    return None


@router.post("/confluences/outflow", status_code=201)
async def create_confluence_outflow(payload: RiverConfluenceRelation):
    """交汇点下泄为河流：(Confluence)-[:CONFLUENCE_FLOWS_TO]->(River)"""
    ok = await asyncio.to_thread(
        graph_engine.link_confluence_to_river,
        payload.confluence_id, payload.river_id, payload.distance_km,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to create confluence→river relation")
    return {"success": True}


@router.delete("/confluences/outflow", status_code=204)
async def delete_confluence_outflow(confluence_id: str, river_id: str):
    ok = await asyncio.to_thread(
        graph_engine.unlink_confluence_from_river, confluence_id, river_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Confluence→river relation not found")
    return None


# ============ District ============
@router.post("/districts", status_code=201)
async def create_district(payload: DistrictPayload):
    data = payload.model_dump()
    code = data.pop("code")
    props = _filter_none(data)
    row = await asyncio.to_thread(graph_engine.upsert_district, code, props)
    return {"success": True, "data": row}


@router.put("/districts/{code}")
async def update_district(code: str, payload: DistrictUpdate):
    existing = await asyncio.to_thread(graph_engine.get_district, code)
    if not existing:
        raise HTTPException(status_code=404, detail="District not found")
    props = _filter_none(payload.model_dump(exclude_unset=True))
    row = await asyncio.to_thread(graph_engine.upsert_district, code, props)
    return {"success": True, "data": row}


@router.delete("/districts/{code}", status_code=204)
async def delete_district(code: str):
    ok = await asyncio.to_thread(graph_engine.delete_district, code)
    if not ok:
        raise HTTPException(status_code=404, detail="District not found")
    return None


# ============ EmergencyPlan ============
@router.get("/emergency-plans")
async def list_emergency_plans():
    items = await asyncio.to_thread(graph_engine.list_emergency_plans)
    return {"items": items, "total": len(items)}


@router.get("/emergency-plans/{plan_id}")
async def get_emergency_plan_detail(plan_id: str):
    row = await asyncio.to_thread(graph_engine.get_emergency_plan, plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="Emergency plan not found")
    return row


@router.post("/emergency-plans", status_code=201)
async def create_emergency_plan(payload: EmergencyPlanPayload):
    data = payload.model_dump()
    plan_id = data.pop("plan_id")
    pollution_types = data.pop("pollution_types", None)
    props = _filter_none(data)
    row = await asyncio.to_thread(
        graph_engine.upsert_emergency_plan, plan_id, props, pollution_types
    )
    return {"success": True, "data": row}


@router.put("/emergency-plans/{plan_id}")
async def update_emergency_plan(plan_id: str, payload: EmergencyPlanUpdate):
    existing = await asyncio.to_thread(graph_engine.get_emergency_plan, plan_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Emergency plan not found")
    data = payload.model_dump(exclude_unset=True)
    pollution_types = data.pop("pollution_types", None)
    props = _filter_none(data)
    row = await asyncio.to_thread(
        graph_engine.upsert_emergency_plan, plan_id, props, pollution_types
    )
    return {"success": True, "data": row}


@router.delete("/emergency-plans/{plan_id}", status_code=204)
async def delete_emergency_plan(plan_id: str):
    ok = await asyncio.to_thread(graph_engine.delete_emergency_plan, plan_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Emergency plan not found")
    return None


# ============ 图谱快照：画布编辑器数据源 ============
def _fetch_all_stations_in_graph() -> List[Dict[str, Any]]:
    """从 Neo4j 拉所有 Station 节点（用于画布展示）。"""
    with graph_engine.driver.session() as session:
        result = session.run(
            """
            MATCH (s:Station)
            RETURN s.station_id as station_id,
                   s.name as name,
                   s.station_name as station_name,
                   s.station_code as station_code,
                   s.river_id as river_id,
                   s.river_km as river_km,
                   s.longitude as longitude,
                   s.latitude as latitude,
                   s.status as status
            """
        )
        return [dict(record) for record in result]


def _fetch_all_edges() -> List[Dict[str, Any]]:
    """一次性拉出所有画布需展示的拓扑关系。
    注意：
    - 站点挂河流关系名与初始化脚本对齐为 ON_RIVER（早期 LOCATED_ON 已由启动迁移合并）。
    - IN_DISTRICT / FLOWS_THROUGH 不再上画布（由属性面板 district_code 下拉管理）。
    - POLLUTION_UPSTREAM_OF 为污染源→站点的溯源链路（只读展示）。
    """
    edges: List[Dict[str, Any]] = []
    with graph_engine.driver.session() as session:
        # FLOWS_INTO: River → River
        for rec in session.run(
            "MATCH (u:River)-[rel:FLOWS_INTO]->(d:River) "
            "RETURN u.river_id as s, d.river_id as t, rel.distance_km as distance_km, rel.confluence_id as confluence_id"
        ):
            edges.append({
                "source": rec["s"], "target": rec["t"], "type": "FLOWS_INTO",
                "props": {k: rec[k] for k in ("distance_km", "confluence_id") if rec[k] is not None},
            })
        # ON_RIVER: Station → River（关系名与初始化脚本对齐）
        for rec in session.run(
            "MATCH (s:Station)-[:ON_RIVER]->(r:River) RETURN s.station_id as s, r.river_id as t"
        ):
            edges.append({"source": rec["s"], "target": rec["t"], "type": "ON_RIVER", "props": {}})
        # UPSTREAM_OF: Station → Station
        for rec in session.run(
            "MATCH (u:Station)-[rel:UPSTREAM_OF]->(d:Station) "
            "RETURN u.station_id as s, d.station_id as t, rel.distance_km as distance_km, rel.travel_hours as travel_hours"
        ):
            edges.append({
                "source": rec["s"], "target": rec["t"], "type": "UPSTREAM_OF",
                "props": {k: rec[k] for k in ("distance_km", "travel_hours") if rec[k] is not None},
            })
        # DISCHARGES_TO: PollutionSourceEntity → River
        for rec in session.run(
            "MATCH (s:PollutionSourceEntity)-[:DISCHARGES_TO]->(r:River) "
            "RETURN s.source_id as s, r.river_id as t"
        ):
            edges.append({"source": rec["s"], "target": rec["t"], "type": "DISCHARGES_TO", "props": {}})
        # FLOWS_INTO_CONFLUENCE: River → Confluence（新增升格建模）
        for rec in session.run(
            "MATCH (r:River)-[rel:FLOWS_INTO_CONFLUENCE]->(c:Confluence) "
            "RETURN r.river_id as s, c.confluence_id as t, rel.distance_km as distance_km"
        ):
            edges.append({
                "source": rec["s"], "target": rec["t"], "type": "FLOWS_INTO_CONFLUENCE",
                "props": {k: rec[k] for k in ("distance_km",) if rec[k] is not None},
            })
        # CONFLUENCE_FLOWS_TO: Confluence → River（新增升格建模）
        for rec in session.run(
            "MATCH (c:Confluence)-[rel:CONFLUENCE_FLOWS_TO]->(r:River) "
            "RETURN c.confluence_id as s, r.river_id as t, rel.distance_km as distance_km"
        ):
            edges.append({
                "source": rec["s"], "target": rec["t"], "type": "CONFLUENCE_FLOWS_TO",
                "props": {k: rec[k] for k in ("distance_km",) if rec[k] is not None},
            })
        # POLLUTION_UPSTREAM_OF: PollutionSourceEntity → Station（只读展示的溯源链路）
        # 注：Neo4j 里实际关系名仍是 UPSTREAM_OF，但通过端点标签区分；
        # 前端用 POLLUTION_UPSTREAM_OF 区别于 Station-Station 的 UPSTREAM_OF，避免 RelKind 歧义。
        for rec in session.run(
            "MATCH (p:PollutionSourceEntity)-[rel:UPSTREAM_OF]->(s:Station) "
            "RETURN p.source_id as s, s.station_id as t, "
            "       rel.distance_km as distance_km, rel.travel_hours as travel_hours"
        ):
            props: Dict[str, Any] = {"readonly": True}
            for k in ("distance_km", "travel_hours"):
                if rec[k] is not None:
                    props[k] = rec[k]
            edges.append({
                "source": rec["s"], "target": rec["t"], "type": "POLLUTION_UPSTREAM_OF",
                "props": props,
            })
    return edges


@router.get("/graph/snapshot")
async def graph_snapshot():
    """返回图谱全量快照，用于画布编辑器初始化。"""
    rivers = await asyncio.to_thread(graph_engine.get_all_rivers)
    sources = await asyncio.to_thread(graph_engine.get_all_pollution_sources)
    confluences = await asyncio.to_thread(graph_engine.get_all_confluences)
    districts = await asyncio.to_thread(graph_engine.get_all_districts)
    stations = await asyncio.to_thread(_fetch_all_stations_in_graph)
    edges = await asyncio.to_thread(_fetch_all_edges)
    return {
        "nodes": {
            "rivers": rivers or [],
            "stations": stations or [],
            "pollution_sources": sources or [],
            "confluences": confluences or [],
            "districts": districts or [],
        },
        "edges": edges,
    }


# ============ 批量导入：拓扑绑定 ============
ImportKind = Literal["river_flow", "station_river", "station_flow", "pollution_river", "river_confluence_in", "river_confluence_out"]

_IMPORT_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "river_flow": {
        "headers": ["upstream_id", "downstream_id", "distance_km", "confluence_id"],
        "required": ["upstream_id", "downstream_id"],
        "example": ["R001", "R002", "5.2", "CF001"],
        "desc": "河流上下游流向 River-[:FLOWS_INTO]->River",
    },
    "station_river": {
        "headers": ["station_id", "river_id"],
        "required": ["station_id", "river_id"],
        "example": ["ST001", "R001"],
        "desc": "站点挂到河流 Station-[:ON_RIVER]->River",
    },
    "station_flow": {
        "headers": ["upstream_id", "downstream_id", "distance_km", "travel_hours"],
        "required": ["upstream_id", "downstream_id"],
        "example": ["ST001", "ST002", "1.8", "0.5"],
        "desc": "站点上下游 Station-[:UPSTREAM_OF]->Station",
    },
    "pollution_river": {
        "headers": ["source_id", "river_id"],
        "required": ["source_id", "river_id"],
        "example": ["PS001", "R001"],
        "desc": "污染源挂到河流 PollutionSource-[:DISCHARGES_TO]->River",
    },
    "river_confluence_in": {
        "headers": ["river_id", "confluence_id", "distance_km"],
        "required": ["river_id", "confluence_id"],
        "example": ["R_ZHANG", "C_001", "0"],
        "desc": "河流汇入交汇点 River-[:FLOWS_INTO_CONFLUENCE]->Confluence",
    },
    "river_confluence_out": {
        "headers": ["confluence_id", "river_id", "distance_km"],
        "required": ["confluence_id", "river_id"],
        "example": ["C_001", "R_GAN_MAIN", "0"],
        "desc": "交汇点下泄河流 Confluence-[:CONFLUENCE_FLOWS_TO]->River",
    },
}


class BulkImportPayload(BaseModel):
    kind: ImportKind
    items: List[Dict[str, Any]] = Field(..., description="待导入的条目列表")
    dry_run: bool = Field(False, description="true=只校验不写入")


@router.get("/import/template", response_class=PlainTextResponse)
async def download_import_template(kind: ImportKind):
    """下载 CSV 模板（含表头 + 一行示例）。"""
    tmpl = _IMPORT_TEMPLATES[kind]
    buf = io.StringIO()
    buf.write(",".join(tmpl["headers"]) + "\n")
    buf.write(",".join(tmpl["example"]) + "\n")
    return PlainTextResponse(
        content=buf.getvalue(),
        headers={
            "Content-Disposition": f'attachment; filename="template_{kind}.csv"',
            "Content-Type": "text/csv; charset=utf-8",
        },
    )


def _to_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@router.post("/import/bulk")
async def bulk_import_topology(payload: BulkImportPayload):
    """批量导入拓扑绑定。幂等：已存在的关系会被 MERGE 覆盖。"""
    kind = payload.kind
    tmpl = _IMPORT_TEMPLATES[kind]
    required = tmpl["required"]

    total = len(payload.items)
    success = 0
    errors: List[Dict[str, Any]] = []

    for idx, raw in enumerate(payload.items, start=1):
        # 格式校验
        missing = [k for k in required if not raw.get(k)]
        if missing:
            errors.append({"row": idx, "reason": f"缺少必填字段: {', '.join(missing)}"})
            continue

        if payload.dry_run:
            success += 1
            continue

        try:
            if kind == "river_flow":
                ok = await asyncio.to_thread(
                    graph_engine.create_river_flow,
                    raw["upstream_id"], raw["downstream_id"],
                    _to_float(raw.get("distance_km")),
                    raw.get("confluence_id") or None,
                )
            elif kind == "station_river":
                # River 存在性校验
                river = await asyncio.to_thread(graph_engine.get_river, raw["river_id"])
                if not river:
                    raise ValueError(f"河流不存在: {raw['river_id']}")
                ok = await asyncio.to_thread(
                    graph_engine.link_station_to_river,
                    raw["station_id"], raw["river_id"],
                )
            elif kind == "station_flow":
                ok = await asyncio.to_thread(
                    graph_engine.create_flow_relationship,
                    raw["upstream_id"], raw["downstream_id"],
                    _to_float(raw.get("distance_km")),
                    _to_float(raw.get("travel_hours")),
                )
            elif kind == "pollution_river":
                river = await asyncio.to_thread(graph_engine.get_river, raw["river_id"])
                if not river:
                    raise ValueError(f"河流不存在: {raw['river_id']}")
                ok = await asyncio.to_thread(
                    graph_engine.link_pollution_to_river,
                    raw["source_id"], raw["river_id"],
                )
            elif kind == "river_confluence_in":
                ok = await asyncio.to_thread(
                    graph_engine.link_river_to_confluence,
                    raw["river_id"], raw["confluence_id"], _to_float(raw.get("distance_km")),
                )
            elif kind == "river_confluence_out":
                ok = await asyncio.to_thread(
                    graph_engine.link_confluence_to_river,
                    raw["confluence_id"], raw["river_id"], _to_float(raw.get("distance_km")),
                )
            else:
                ok = False

            if ok:
                success += 1
            else:
                errors.append({"row": idx, "reason": "写入失败（节点不存在或 Neo4j 拒绝）"})
        except Exception as exc:  # noqa: BLE001
            errors.append({"row": idx, "reason": str(exc)})

    return {
        "kind": kind,
        "total": total,
        "success": success,
        "failed": len(errors),
        "dry_run": payload.dry_run,
        "errors": errors[:100],  # 限制返回错误数
    }


# ============ 画布坐标持久化（graph_canvas_layout）============
NodeTypeLit = Literal["river", "station", "confluence", "pollution"]


class CanvasLayoutItem(BaseModel):
    node_type: NodeTypeLit
    node_id: str
    x: float
    y: float


class CanvasLayoutBulk(BaseModel):
    layouts: List[CanvasLayoutItem]


@router.get("/graph/canvas-layout")
async def get_canvas_layout():
    """返回全部已保存的画布节点坐标。"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(GraphCanvasLayoutORM))
        rows = result.scalars().all()
        return {"data": [r.to_dict() for r in rows]}


@router.post("/graph/canvas-layout")
async def save_canvas_layout(payload: CanvasLayoutBulk):
    """批量 UPSERT 画布节点坐标。空 list 也返回成功。"""
    if not payload.layouts:
        return {"data": {"saved": 0}}
    async with AsyncSessionLocal() as session:
        saved = 0
        for item in payload.layouts:
            stmt = pg_insert(GraphCanvasLayoutORM).values(
                node_type=item.node_type,
                node_id=item.node_id,
                x=item.x,
                y=item.y,
            ).on_conflict_do_update(
                constraint="uq_graph_canvas_layout_type_id",
                set_={"x": item.x, "y": item.y},
            )
            await session.execute(stmt)
            saved += 1
        await session.commit()
        return {"data": {"saved": saved}}


@router.delete("/graph/canvas-layout/{node_type}/{node_id}")
async def reset_canvas_layout(node_type: NodeTypeLit, node_id: str):
    """重置单个节点坐标，下次 loadSnapshot 按算法重新布局。"""
    async with AsyncSessionLocal() as session:
        stmt = delete(GraphCanvasLayoutORM).where(
            GraphCanvasLayoutORM.node_type == node_type,
            GraphCanvasLayoutORM.node_id == node_id,
        )
        result = await session.execute(stmt)
        await session.commit()
        return {"data": {"deleted": result.rowcount or 0}}
