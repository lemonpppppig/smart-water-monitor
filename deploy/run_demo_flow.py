#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_demo_flow.py
================

端到端演示脚本：从数据摄入 → 规则触发 → 创建预警 → 三个智能体 → 应急预案，
一条命令跑完 PPT 三 Part 完整链路，每步打印关键请求/响应字段，最后给出前端 URL。

链路：
    [Step 1] POST /api/v1/data/ingest                          （写入 TDengine）
    [Step 2] POST /api/v1/alerts/rules/check                   （规则引擎判定）
    [Step 3] POST /api/v1/alerts                               （创建预警实体）
    [Step 4] POST /api/v1/ai/anomaly/detect                    （Part 2 异常诊断）
    [Step 5] POST /api/v1/ai/graph/trace-source                （Part 3 溯源）
             POST /api/v1/ai/graph/spread-analysis             （Part 3 扩散）
    [Step 6] POST /api/v1/ai/knowledge/identify                （Part 4 综合研判，携带 Step4/5 结果）
             GET  /api/v1/ai/knowledge/emergency-plan/{ptype}  （Part 4 应急预案）
    → 前端   /alerts/{id}   |   /alerts/analysis/{id}

用法（项目根目录执行）：
    python deploy/run_demo_flow.py
    python deploy/run_demo_flow.py --backend http://127.0.0.1:8000
    python deploy/run_demo_flow.py --frontend http://127.0.0.1:5173
    python deploy/run_demo_flow.py --station-code SW0001 --nh3n 3.5

仅依赖 Python 标准库（urllib），PowerShell / bash 通吃。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


DEFAULT_BACKEND = "http://127.0.0.1:8000"
DEFAULT_FRONTEND = "http://127.0.0.1:5173"


# ========== 日志 ==========
def banner(step: str, title: str) -> None:
    print(f"\n\033[36m{'=' * 70}\033[0m")
    print(f"\033[36m[{step}]\033[0m \033[1m{title}\033[0m")
    print(f"\033[36m{'=' * 70}\033[0m")


def info(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def warn(msg: str) -> None:
    print(f"  \033[33m!\033[0m {msg}")


def err(msg: str) -> None:
    print(f"  \033[31m✗ {msg}\033[0m", file=sys.stderr)


def kv(label: str, value: Any) -> None:
    """统一格式打印 key→value 摘要。"""
    v = value
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False, default=str)
        if len(v) > 180:
            v = v[:180] + " ..."
    print(f"    • {label}: {v}")


# ========== HTTP ==========
def _request(method: str, url: str, payload: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Any:
    data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
        return json.loads(body) if body else None
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {e.code} {url} → {detail}") from e
    except URLError as e:
        raise RuntimeError(f"URLError {url} → {e}") from e


def http_get(backend: str, path: str, timeout: int = 15) -> Any:
    return _request("GET", f"{backend}{path}", timeout=timeout)


def http_post(backend: str, path: str, payload: Dict[str, Any], timeout: int = 20) -> Any:
    return _request("POST", f"{backend}{path}", payload=payload, timeout=timeout)


# ========== 业务步骤 ==========
def _has_topology(backend: str, station_id: str) -> Dict[str, int]:
    """探测站点是否存在上下游拓扑。"""
    up_n, down_n = 0, 0
    try:
        up = http_get(backend, f"/api/v1/ai/graph/upstream/{station_id}?max_depth=3", timeout=5)
        up_n = len((up or {}).get("upstream") or [])
    except Exception:
        pass
    try:
        dn = http_get(backend, f"/api/v1/ai/graph/downstream/{station_id}?max_depth=3", timeout=5)
        down_n = len((dn or {}).get("downstream") or [])
    except Exception:
        pass
    return {"up": up_n, "down": down_n}


def pick_station(
    backend: str,
    station_code: Optional[str],
    topology_filter: bool = True,
) -> Dict[str, Any]:
    banner("Step 0", "拉取站点列表")
    res = http_get(backend, "/api/v1/stations?size=100")
    items: List[Dict[str, Any]] = res.get("items") or res.get("data", {}).get("items") or []
    if not items:
        err("后端未返回任何站点，请先跑 deploy/init_all.py 初始化基础设施")
        raise SystemExit(2)

    # 1. 显式指定 station_code 最优先
    if station_code:
        for it in items:
            if it.get("station_code") == station_code:
                topo = _has_topology(backend, it["id"])
                info(
                    f"命中指定站点 {station_code} → {it.get('station_name')} "
                    f"(upstream={topo['up']}, downstream={topo['down']})"
                )
                return it
        warn(f"未找到 station_code={station_code}，将按默认策略选站")

    # 2. 拓扑筛选：优先挑上下游都非空的，其次任一非空，共探测前 30 个
    if topology_filter:
        info(f"正在探测前 {min(30, len(items))} 个站点的图谱拓扑 ……")
        both: List[Dict[str, Any]] = []
        either: List[Dict[str, Any]] = []
        for it in items[:30]:
            topo = _has_topology(backend, it["id"])
            it["_topo"] = topo
            if topo["up"] > 0 and topo["down"] > 0:
                both.append(it)
                break  # 找到一个即可
            if topo["up"] > 0 or topo["down"] > 0:
                either.append(it)
        chosen = both[0] if both else (either[0] if either else items[0])
        topo = chosen.get("_topo") or _has_topology(backend, chosen["id"])
        info(
            f"选用站点: {chosen.get('station_name')} ({chosen.get('station_code')})  "
            f"id={chosen['id']}  upstream={topo['up']}  downstream={topo['down']}"
        )
        if topo["up"] == 0 and topo["down"] == 0:
            warn("所有探测站点均无拓扑，Part 3 溯源/扩散将为空（仍继续演示其他步骤）")
        return chosen

    # 3. 不筛选
    chosen = items[0]
    info(f"选用站点: {chosen.get('station_name')} ({chosen.get('station_code')})  id={chosen['id']}")
    return chosen


def step1_ingest(backend: str, station: Dict[str, Any], nh3n: float) -> None:
    banner("Step 1", "数据摄入 POST /api/v1/data/ingest")
    payload = {
        "station_id": station["id"],
        "ts": datetime.now().isoformat(),
        "station_type": station.get("station_type"),
        "region": station.get("region"),
        "ph": 6.4,
        "do": 2.1,
        "nh3_n": nh3n,
        "codmn": 8.5,
        "turbidity": 45.0,
        "conductivity": 780.0,
    }
    kv("请求 payload", {"nh3_n": nh3n, "do": 2.1, "ph": 6.4, "codmn": 8.5})
    res = http_post(backend, "/api/v1/data/ingest", payload)
    kv("响应", res)
    if not (res and res.get("success")):
        warn("ingest 返回 success=false，但不阻塞后续流程（TDengine 可能未就绪）")
    else:
        info("已写入 TDengine")


def step2_rules_check(backend: str, station: Dict[str, Any], nh3n: float) -> Dict[str, Any]:
    banner("Step 2", "规则触发检查 POST /api/v1/alerts/rules/check")
    payload = {
        "station_id": station["id"],
        "data": {"nh3_n": nh3n, "do": 2.1, "ph": 6.4, "codmn": 8.5},
    }
    kv("请求 payload", payload["data"])
    try:
        res = http_post(backend, "/api/v1/alerts/rules/check", payload)
    except RuntimeError as e:
        warn(f"rules/check 调用失败（可能暂无启用规则）: {e}")
        return {"triggered": False, "triggered_rules": []}
    triggered = res.get("triggered")
    rules = res.get("triggered_rules") or []
    kv("triggered", triggered)
    kv("命中规则数", len(rules))
    for r in rules[:3]:
        kv("  ↳", f"{r.get('rule_name')} / {r.get('metric_code')} {r.get('condition')} {r.get('threshold')}")
    if not triggered:
        warn("没有启用的阈值规则命中 → 手动走 Step 3 直接创建预警（演示链路不阻塞）")
    return res


def step3_create_alert(backend: str, station: Dict[str, Any], nh3n: float) -> Dict[str, Any]:
    banner("Step 3", "创建预警 POST /api/v1/alerts")
    payload = {
        "station_id": station["id"],
        "alert_type": "threshold",
        "alert_level": "high",
        "title": "氨氮浓度异常升高",
        "description": (
            f"站点 {station.get('station_name')} 氨氮 {nh3n} mg/L 超标，"
            "疑似上游工业废水偷排，请及时排查处置。"
        ),
        "metrics": {"nh3_n": nh3n, "cod": 52.0, "do": 2.1, "ph": 6.4},
        "pollution_type": "industrial",
    }
    res = http_post(backend, "/api/v1/alerts", payload)
    alert = res.get("data", res) if isinstance(res, dict) else res
    kv("alert_id", alert.get("id"))
    kv("alert_code", alert.get("alert_code"))
    kv("level/type", f"{alert.get('alert_level')} / {alert.get('alert_type')}")
    return alert


def step4_detect_anomaly(backend: str, station: Dict[str, Any], nh3n: float) -> Dict[str, Any]:
    banner("Step 4", "Part 2 异常诊断 POST /api/v1/ai/anomaly/detect")
    payload = {
        "station_id": station["id"],
        "metric": "nh3_n",
        "data": [0.8, 0.9, 1.0, 1.1, 1.3, 1.8, 2.4, nh3n],  # 渐变超标序列
    }
    kv("请求 payload", payload)
    try:
        res = http_post(backend, "/api/v1/ai/anomaly/detect", payload)
    except RuntimeError as e:
        err(str(e))
        return {}
    anomalies = res.get("anomalies") or []
    kv("anomaly_count", len(anomalies))
    kv("human 摘要", (res.get("human") or "")[:140])
    kv("machine", res.get("machine"))
    return res


def step5_trace_and_spread(backend: str, station: Dict[str, Any]) -> Dict[str, Any]:
    banner("Step 5a", "Part 3 溯源 POST /api/v1/ai/graph/trace-source")
    payload = {
        "station_id": station["id"],
        "detection_time": datetime.now().isoformat(),
        "lookback_hours": 24,
    }
    try:
        trace = http_post(backend, "/api/v1/ai/graph/trace-source", payload)
    except RuntimeError as e:
        err(str(e))
        trace = {}
    # 站点级候选源头在 sources 字段，pollution_sources 是污染源实体（结构不同）
    sources = trace.get("sources") or []
    kv("候选源头数", len(sources))
    if sources:
        top = sources[0]
        kv(
            "top 源头",
            f"{top.get('station_name')} · 距离 {top.get('distance')}km · 置信度 {top.get('confidence')}",
        )
    ent_n = len(trace.get("pollution_sources") or [])
    if ent_n:
        kv("污染源实体数（图谱）", ent_n)
    kv("human 摘要", (trace.get("human") or "")[:140])
    kv("machine", trace.get("machine"))

    banner("Step 5b", "Part 3 扩散 POST /api/v1/ai/graph/spread-analysis")
    try:
        spread = http_post(backend, "/api/v1/ai/graph/spread-analysis", payload)
    except RuntimeError as e:
        err(str(e))
        spread = {}
    affected = spread.get("affected_stations") or []
    kv("受影响下游数", len(affected))
    for s in affected[:3]:
        kv("  ↳", f"{s.get('station_name')} · 距离 {s.get('distance')}km · 到达 {s.get('estimated_arrival')}")
    return {"trace": trace, "spread": spread}


def step6_identify_and_plan(
    backend: str,
    station: Dict[str, Any],
    nh3n: float,
    anomaly: Dict[str, Any],
    trace: Dict[str, Any],
) -> None:
    banner("Step 6a", "Part 4 综合研判 POST /api/v1/ai/knowledge/identify")
    # 跨阶段上下文：把 Step 4/5a 结果揉进去（优先用站点级 sources，且过滤空值）
    top_src = (trace.get("sources") or [{}])[0]
    source_info: Optional[Dict[str, Any]] = None
    if any(top_src.get(k) for k in ("station_name", "distance", "confidence")):
        source_info = {
            "station_name": top_src.get("station_name"),
            "distance": top_src.get("distance"),
            "confidence": top_src.get("confidence"),
        }
    payload = {
        "station_id": station["id"],
        "metrics": {"nh3_n": nh3n, "cod": 52.0, "do": 2.1, "ph": 6.4},
        "alert_level": "high",
        "anomalies": anomaly.get("anomalies"),
        "source_info": source_info,
    }
    kv("跨阶段上文 anomalies", f"{len(payload['anomalies'] or [])} 条")
    kv("跨阶段上文 source_info", source_info)
    try:
        identify = http_post(backend, "/api/v1/ai/knowledge/identify", payload)
    except RuntimeError as e:
        err(str(e))
        identify = {}
    kv("识别污染类型", identify.get("pollution_type") or identify.get("type"))
    kv("置信度", identify.get("confidence"))
    kv("human 摘要", (identify.get("human") or "")[:180])
    kv("machine", identify.get("machine"))

    ptype = identify.get("pollution_type") or "industrial"
    banner("Step 6b", f"Part 4 应急预案 GET /api/v1/ai/knowledge/emergency-plan/{ptype}")
    try:
        plan = http_get(backend, f"/api/v1/ai/knowledge/emergency-plan/{ptype}")
    except RuntimeError as e:
        err(str(e))
        plan = {}
    kv("pollution_name", plan.get("pollution_name"))
    actions = plan.get("actions") or []
    departments = plan.get("departments") or []
    kv("处置步骤数", len(actions))
    for i, a in enumerate(actions[:5]):
        dept = departments[i] if i < len(departments) else ""
        print(f"      {i + 1}. {a}  [{dept}]")


def print_final(frontend: str, alert_id: str) -> None:
    print("\n\033[35m" + "=" * 70 + "\033[0m")
    print("\033[35m[DONE] 端到端流程跑通，打开前端核对 Network 面板\033[0m")
    print("\033[35m" + "=" * 70 + "\033[0m")
    print(f"  AlertDetail    : {frontend}/alerts/{alert_id}")
    print(f"  AlertAnalysis  : {frontend}/alerts/analysis/{alert_id}")
    print("\n  前端 Tab 路径：")
    print("    ├─ AI 分析 / AI 诊断 → 智能体异常诊断 (Part 2)")
    print("    │                    智能体综合研判 (Part 4，含源头+异常指标)")
    print("    ├─ 溯源追踪          → 智能体多假设推理 (Part 3)")
    print("    ├─ 扩散分析          → 受影响下游站点 + 扩散半径 + 预计到达")
    print("    └─ 处置建议          → 应急预案 actions × departments")


# ========== 主流程 ==========
def main() -> int:
    parser = argparse.ArgumentParser(description="PPT 三 Part 端到端演示一键脚本")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help=f"后端地址，默认 {DEFAULT_BACKEND}")
    parser.add_argument("--frontend", default=DEFAULT_FRONTEND, help=f"前端地址，默认 {DEFAULT_FRONTEND}")
    parser.add_argument("--station-code", default=None, help="可选：指定站点编码（如 SW0001）")
    parser.add_argument("--nh3n", type=float, default=3.5, help="氨氮触发值 mg/L，默认 3.5（国标 IV 类上限 1.5）")
    parser.add_argument("--skip-ingest", action="store_true", help="跳过 Step 1 数据摄入（TDengine 不在时用）")
    parser.add_argument(
        "--no-topology-filter",
        action="store_true",
        help="不按拓扑筛选，直接用站点列表第一个（默认会探测前 30 个站点挑上下游非空的）",
    )
    args = parser.parse_args()

    backend = args.backend.rstrip("/")
    frontend = args.frontend.rstrip("/")

    t0 = time.time()
    station = pick_station(backend, args.station_code, topology_filter=not args.no_topology_filter)

    if args.skip_ingest:
        warn("已跳过 Step 1 数据摄入（--skip-ingest）")
    else:
        try:
            step1_ingest(backend, station, args.nh3n)
        except RuntimeError as e:
            warn(f"Step 1 失败但不阻塞: {e}")

    step2_rules_check(backend, station, args.nh3n)
    alert = step3_create_alert(backend, station, args.nh3n)
    anomaly = step4_detect_anomaly(backend, station, args.nh3n)
    bundle = step5_trace_and_spread(backend, station)
    step6_identify_and_plan(backend, station, args.nh3n, anomaly, bundle["trace"])

    dt = time.time() - t0
    print(f"\n\033[32m[ELAPSED]\033[0m 端到端耗时 {dt:.2f}s")
    print_final(frontend, alert["id"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[INTERRUPTED]")
        sys.exit(130)
