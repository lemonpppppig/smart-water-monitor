#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_demo_alert.py
==================

一键生成"PPT 三 Part 闭环演示"所需的示例预警事件。

执行完毕后会在控制台打印两条前端演示 URL：
    - AlertDetail    /alerts/{alert_id}
    - AlertAnalysis  /alerts/analysis/{alert_id}

打开任意一条，即可依次触发：
    Part 2 异常发现（detect_anomaly 双输出）
    Part 3 诊断溯源（trace_source 双输出）
    Part 4 智能处置（identify_pollution 综合研判，携带 Part 2 异常 + Part 3 源头）

用法（项目根目录执行，PowerShell / bash 均可）：
    python deploy/seed_demo_alert.py
    python deploy/seed_demo_alert.py --backend http://127.0.0.1:8000
    python deploy/seed_demo_alert.py --frontend http://127.0.0.1:5173
    python deploy/seed_demo_alert.py --station-code SW0001

仅依赖 Python 标准库（urllib），无需安装 requests。
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


DEFAULT_BACKEND = "http://127.0.0.1:8000"
DEFAULT_FRONTEND = "http://127.0.0.1:5173"


# -------- 日志 --------
def log_step(msg: str) -> None:
    print(f"\n[STEP] {msg}")


def log_info(msg: str) -> None:
    print(f"[INFO] {msg}")


def log_warn(msg: str) -> None:
    print(f"[WARN] {msg}")


def log_error(msg: str) -> None:
    print(f"[ERROR] {msg}", file=sys.stderr)


# -------- HTTP 工具 --------
def http_get(url: str, timeout: int = 10) -> Any:
    req = urlrequest.Request(url, method="GET", headers={"Accept": "application/json"})
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


def http_post_json(url: str, payload: Dict[str, Any], timeout: int = 15) -> Any:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        },
    )
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else None


# -------- 业务 --------
def pick_station(backend: str, station_code: Optional[str]) -> Dict[str, Any]:
    """从后端拉取站点列表，按 code 精确匹配或挑第一个。"""
    log_step("拉取站点列表 GET /api/v1/stations")
    try:
        res = http_get(f"{backend}/api/v1/stations?size=50")
    except (HTTPError, URLError) as e:
        log_error(f"站点列表请求失败: {e}")
        raise SystemExit(2)

    items: List[Dict[str, Any]] = res.get("items") or res.get("data", {}).get("items") or []
    if not items:
        log_error("后端未返回任何站点，请先确保基础设施已就绪（参考 deploy/init_all.py）")
        raise SystemExit(3)

    if station_code:
        for it in items:
            if it.get("station_code") == station_code:
                log_info(f"命中指定站点 {station_code} → {it.get('station_name')}")
                return it
        log_warn(f"未找到 station_code={station_code}，改用首个站点")

    chosen = items[0]
    log_info(f"选用站点: {chosen.get('station_name')} ({chosen.get('station_code')})")
    return chosen


def build_alert_payload(station: Dict[str, Any]) -> Dict[str, Any]:
    """构造一个 high 级别、氨氮超标的典型污染预警。"""
    return {
        "station_id": station["id"],
        "alert_type": "threshold",
        "alert_level": "high",
        "title": "氨氮浓度异常升高",
        "description": (
            f"站点 {station.get('station_name')} 氨氮 3.5 mg/L 连续超标，"
            "疑似上游工业废水偷排，请及时排查处置。"
        ),
        "metrics": {
            "nh3_n": 3.5,
            "cod": 52.0,
            "do": 2.1,
            "ph": 6.4,
        },
        "pollution_type": "industrial",
    }


def create_alert(backend: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    log_step("创建演示预警 POST /api/v1/alerts")
    try:
        res = http_post_json(f"{backend}/api/v1/alerts", payload)
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        log_error(f"创建预警失败 HTTP {e.code}: {detail}")
        raise SystemExit(4)
    except URLError as e:
        log_error(f"创建预警失败: {e}")
        raise SystemExit(4)

    alert = res.get("data", res) if isinstance(res, dict) else res
    log_info(f"已创建预警 id={alert.get('id')} code={alert.get('alert_code')}")
    return alert


def print_demo_urls(frontend: str, alert_id: str) -> None:
    print("\n==================== 演示入口 ====================")
    print(f"  AlertDetail    : {frontend}/alerts/{alert_id}")
    print(f"  AlertAnalysis  : {frontend}/alerts/analysis/{alert_id}")
    print("==================================================")
    print("提示：打开任一页面并切换到 \"AI 分析 / AI 诊断\" Tab，")
    print("      即可看到 Part 2 异常诊断 + Part 3 溯源推理 + Part 4 综合研判三段智能体双输出。")


def main() -> int:
    parser = argparse.ArgumentParser(description="PPT 三 Part 闭环演示数据一键脚本")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help=f"后端地址，默认 {DEFAULT_BACKEND}")
    parser.add_argument("--frontend", default=DEFAULT_FRONTEND, help=f"前端地址，默认 {DEFAULT_FRONTEND}")
    parser.add_argument("--station-code", default=None, help="可选：指定站点编码（如 SW0001），不指定则用首个")
    args = parser.parse_args()

    backend = args.backend.rstrip("/")
    frontend = args.frontend.rstrip("/")

    station = pick_station(backend, args.station_code)
    payload = build_alert_payload(station)
    alert = create_alert(backend, payload)
    print_demo_urls(frontend, alert["id"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
