#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_tdengine.py
================

按 --region 参数（或 REGION_CODE 环境变量）为对应城市批量写入
「90 天 × 10 分钟」级仿真水质历史数据到 TDengine `water_env.water_quality` 超级表，
并针对近期活跃告警（ALERT-2026-0001 / 0002 / 0003）在对应时间窗内
注入异常峰值。

站点清单加载优先级：
    1) 若 regions/<region>/db/tdengine/stations.json 存在，则按其定义加载
       （包含 stations 列表 + anomalies_hint 列表）；
    2) 否则回退到脚本内置的赣州 73 个 ST_xxx 站点。

运行前置：
    1) docker compose up -d tdengine  (或 deploy/docker-compose.offline.yml)
    2) 只需 Python 3.8+，无需额外依赖。

用法（宿主机默认端口）：
    python scripts/seed_tdengine.py                  # 自动检测 regions/ 下可用区域
    python scripts/seed_tdengine.py --region hefei   # 切换城市（需预先扩展 STATIONS）

    # 自定义
    python scripts/seed_tdengine.py \\
        --url http://localhost:16041 --user root --password taosdata \\
        --days 90 --interval 10

本脚本仅使用 Python 标准库（urllib），通过 TDengine REST 接口写入，
不依赖外部库，不需要安装 taos native client，适合离线部署。
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _detect_region() -> str:
    """自动检测 regions/ 目录下可用的区域（排除 _common），取第一个。"""
    env_val = os.getenv("REGION_CODE")
    if env_val:
        return env_val
    regions_dir = PROJECT_ROOT / "regions"
    if regions_dir.exists():
        candidates = sorted(
            d.name for d in regions_dir.iterdir()
            if d.is_dir() and not d.name.startswith("_")
        )
        if candidates:
            return candidates[0]
    return "nanchang"

# ----------------------------------------------------------------------------
# 73 个站点：station_id / station_type / region / river / 基础基线
# 顺序与 infrastructure/docker/postgres/init/02_ganzhou_data.sql 大致对齐
# ----------------------------------------------------------------------------
STATION_TYPES = {
    "water_source":     "饮用水源",
    "industrial_park":  "工业园区",
    "boundary_section": "跨界断面",
    "rural_water":      "农村面源",
}

# (station_code, station_type, region, river_name)
STATIONS: List[Tuple[str, str, str, str]] = [
    ("ST_001", "water_source", "上犹县", "章江"),
    ("ST_002", "water_source", "崇义县", "章江"),
    ("ST_003", "boundary_section", "大余县", "章江"),
    ("ST_004", "rural_water", "大余县", "章江"),
    ("ST_005", "water_source", "南康区", "章江"),
    ("ST_006", "industrial_park", "南康区", "章江"),
    ("ST_007", "boundary_section", "南康区", "章江"),
    ("ST_008", "water_source", "章贡区", "章江"),
    ("ST_009", "industrial_park", "章贡区", "章江"),
    ("ST_010", "boundary_section", "章贡区", "章江"),
    ("ST_011", "rural_water", "章贡区", "章江"),
    ("ST_012", "industrial_park", "章贡区", "章江"),
    ("ST_013", "water_source", "赣县区", "章江"),
    ("ST_014", "boundary_section", "赣县区", "章江"),
    ("ST_015", "industrial_park", "南康区", "章江"),
    ("ST_016", "water_source", "石城县", "贡江"),
    ("ST_017", "rural_water", "石城县", "贡江"),
    ("ST_018", "water_source", "宁都县", "贡江"),
    ("ST_019", "boundary_section", "宁都县", "贡江"),
    ("ST_020", "industrial_park", "瑞金市", "贡江"),
    ("ST_021", "water_source", "瑞金市", "贡江"),
    ("ST_022", "rural_water", "会昌县", "贡江"),
    ("ST_023", "boundary_section", "会昌县", "贡江"),
    ("ST_024", "water_source", "会昌县", "贡江"),
    ("ST_025", "water_source", "上犹县", "上犹江"),
    ("ST_026", "rural_water", "上犹县", "上犹江"),
    ("ST_027", "water_source", "崇义县", "上犹江"),
    ("ST_028", "water_source", "崇义县", "上犹江"),
    ("ST_029", "boundary_section", "上犹县", "上犹江"),
    ("ST_030", "rural_water", "龙南市", "桃江"),
    ("ST_031", "water_source", "定南县", "桃江"),
    ("ST_032", "rural_water", "定南县", "桃江"),
    ("ST_033", "water_source", "全南县", "桃江"),
    ("ST_034", "boundary_section", "龙南市", "桃江"),
    ("ST_035", "rural_water", "信丰县", "桃江"),
    ("ST_036", "water_source", "信丰县", "桃江"),
    ("ST_037", "industrial_park", "信丰县", "桃江"),
    ("ST_038", "boundary_section", "信丰县", "桃江"),
    ("ST_039", "water_source", "安远县", "平江"),
    ("ST_040", "boundary_section", "于都县", "平江"),
    ("ST_041", "rural_water", "于都县", "平江"),
    ("ST_042", "water_source", "于都县", "平江"),
    ("ST_043", "industrial_park", "于都县", "平江"),
    ("ST_044", "boundary_section", "于都县", "平江"),
    ("ST_045", "water_source", "兴国县", "平江"),
    ("ST_046", "rural_water", "兴国县", "平江"),
    ("ST_047", "boundary_section", "兴国县", "平江"),
    ("ST_048", "boundary_section", "章贡区", "赣江"),
    ("ST_049", "industrial_park", "章贡区", "赣江"),
    ("ST_050", "water_source", "赣县区", "赣江"),
    ("ST_051", "industrial_park", "赣县区", "赣江"),
    ("ST_052", "boundary_section", "赣县区", "赣江"),
    ("ST_053", "rural_water", "赣县区", "赣江"),
    ("ST_054", "water_source", "宁都县", "梅江"),
    ("ST_055", "industrial_park", "宁都县", "梅江"),
    ("ST_056", "rural_water", "宁都县", "梅江"),
    ("ST_057", "boundary_section", "宁都县", "梅江"),
    ("ST_058", "water_source", "兴国县", "梅江"),
    ("ST_059", "rural_water", "兴国县", "梅江"),
    ("ST_060", "boundary_section", "兴国县", "梅江"),
    ("ST_061", "water_source", "遂川县", "遂川江"),
    ("ST_062", "boundary_section", "遂川县", "遂川江"),
    ("ST_063", "rural_water", "遂川县", "遂川江"),
    ("ST_064", "water_source", "万安县", "遂川江"),
    ("ST_065", "boundary_section", "万安县", "遂川江"),
    ("ST_066", "rural_water", "万安县", "遂川江"),
    ("ST_067", "boundary_section", "赣县区", "赣江"),
    ("ST_068", "water_source", "万安县", "赣江"),
    ("ST_069", "industrial_park", "万安县", "赣江"),
    ("ST_070", "boundary_section", "万安县", "赣江"),
    ("ST_071", "rural_water", "万安县", "赣江"),
    ("ST_072", "water_source", "万安县", "赣江"),
    ("ST_073", "boundary_section", "万安县", "赣江"),
]

# 不同站点类型的基线指标（均值，标准差）
BASELINE: Dict[str, Dict[str, Tuple[float, float]]] = {
    "water_source": {
        "ph": (7.4, 0.15), "do": (8.2, 0.4), "nh3_n": (0.25, 0.08),
        "codmn": (2.4, 0.4), "codcr": (11.0, 1.8), "turbidity": (1.6, 0.5),
        "conductivity": (320.0, 30.0), "chlorophyll": (2.8, 0.8),
        "blue_green_algae": (800.0, 200.0), "total_n": (0.8, 0.2),
        "total_p": (0.03, 0.01), "transparency": (140.0, 18.0),
        "orp": (320.0, 20.0), "water_temperature": (18.0, 4.0),
        "tds": (210.0, 20.0), "sal": (0.18, 0.03),
        "flow_speed": (0.6, 0.15), "flow_rate": (45.0, 8.0),
        "water_level": (96.5, 0.3),
    },
    "industrial_park": {
        "ph": (7.1, 0.3), "do": (6.8, 0.6), "nh3_n": (0.72, 0.18),
        "codmn": (4.4, 0.8), "codcr": (19.0, 3.0), "turbidity": (6.5, 2.0),
        "conductivity": (520.0, 60.0), "chlorophyll": (5.0, 1.5),
        "blue_green_algae": (2200.0, 600.0), "total_n": (1.4, 0.35),
        "total_p": (0.08, 0.02), "transparency": (80.0, 15.0),
        "orp": (260.0, 30.0), "water_temperature": (19.5, 4.2),
        "tds": (340.0, 40.0), "sal": (0.26, 0.05),
        "flow_speed": (0.5, 0.15), "flow_rate": (38.0, 10.0),
        "water_level": (95.2, 0.35),
    },
    "boundary_section": {
        "ph": (7.3, 0.2), "do": (7.5, 0.5), "nh3_n": (0.42, 0.12),
        "codmn": (3.2, 0.5), "codcr": (14.0, 2.2), "turbidity": (3.2, 1.0),
        "conductivity": (410.0, 40.0), "chlorophyll": (3.6, 1.1),
        "blue_green_algae": (1400.0, 350.0), "total_n": (1.0, 0.25),
        "total_p": (0.05, 0.015), "transparency": (105.0, 16.0),
        "orp": (290.0, 25.0), "water_temperature": (18.8, 4.1),
        "tds": (270.0, 28.0), "sal": (0.22, 0.04),
        "flow_speed": (0.7, 0.2), "flow_rate": (120.0, 25.0),
        "water_level": (95.8, 0.3),
    },
    "rural_water": {
        "ph": (7.2, 0.2), "do": (7.2, 0.5), "nh3_n": (0.55, 0.18),
        "codmn": (3.6, 0.6), "codcr": (15.0, 2.5), "turbidity": (4.2, 1.4),
        "conductivity": (380.0, 40.0), "chlorophyll": (4.0, 1.2),
        "blue_green_algae": (1800.0, 450.0), "total_n": (1.2, 0.3),
        "total_p": (0.07, 0.02), "transparency": (90.0, 16.0),
        "orp": (280.0, 28.0), "water_temperature": (18.6, 4.0),
        "tds": (260.0, 25.0), "sal": (0.22, 0.04),
        "flow_speed": (0.55, 0.15), "flow_rate": (35.0, 7.0),
        "water_level": (95.5, 0.3),
    },
}

METRIC_ORDER = [
    "ph", "do", "nh3_n", "codmn", "turbidity", "conductivity",
    "chlorophyll", "blue_green_algae", "total_n", "total_p",
    "codcr", "transparency", "orp", "water_temperature",
    "tds", "sal", "flow_speed", "flow_rate", "water_level",
]


# ----------------------------------------------------------------------------
# 异常注入配置：对齐 09_alerts_seed.sql 中的 3 条活跃告警
# ----------------------------------------------------------------------------
@dataclass
class AnomalyCase:
    station_code: str
    metric: str
    peak: float
    start_offset_min: int   # 相对 "现在" 的偏移分钟（负数=过去）
    duration_min: int       # 异常持续时长


ANOMALIES: List[AnomalyCase] = [
    # ALERT-2026-0001 章江工业园 NH3-N 超标，现在 -25 分钟触发，持续 30 分钟
    AnomalyCase("ST_012", "nh3_n", 2.38, -25, 30),
    # ALERT-2026-0002 上犹江陡水蓝绿藻，现在 -120 分钟
    AnomalyCase("ST_025", "blue_green_algae", 15800.0, -120, 60),
    AnomalyCase("ST_025", "chlorophyll", 18.5, -120, 60),
    # ALERT-2026-0003 赣江出省断面 CODMn，现在 -5 小时
    AnomalyCase("ST_070", "codmn", 8.6, -300, 90),
    # 补一条中期异常：ST_030 TP 偏高（8 小时前，已处置中）
    AnomalyCase("ST_030", "total_p", 0.18, -480, 120),
    # 补一条 12 小时前：ST_048 CODCr
    AnomalyCase("ST_048", "codcr", 28.0, -720, 60),
]


# ----------------------------------------------------------------------------
# 区域化加载：优先读 regions/<region>/db/tdengine/stations.json 覆盖默认赣州数据
# ----------------------------------------------------------------------------
def load_region_override(region: str) -> Optional[Tuple[List[Tuple[str, str, str, str]], List[AnomalyCase]]]:
    """若存在 regions/<region>/db/tdengine/stations.json，解析并返回 (STATIONS, ANOMALIES)。

    stations.json 结构参考 regions/nanchang/db/tdengine/stations.json：
        {
          "stations": [ {station_code, station_type, region, river, ...}, ... ],
          "anomalies_hint": [ {station_code, metric, peak, start_offset_min, duration_min, ...}, ... ]
        }
    """
    cfg_path = PROJECT_ROOT / "regions" / region / "db" / "tdengine" / "stations.json"
    if not cfg_path.exists():
        return None
    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[WARN] 解析 {cfg_path} 失败: {e}，回退内置赣州站点")
        return None
    stations_raw = data.get("stations") or []
    if not stations_raw:
        return None
    stations: List[Tuple[str, str, str, str]] = []
    for s in stations_raw:
        code = s.get("station_code")
        stype = s.get("station_type")
        dist = s.get("region") or s.get("district") or ""
        river = s.get("river") or s.get("river_name") or ""
        if not code or not stype:
            continue
        stations.append((code, stype, dist, river))
    anomalies: List[AnomalyCase] = []
    for a in data.get("anomalies_hint") or []:
        try:
            anomalies.append(AnomalyCase(
                station_code=a["station_code"],
                metric=a["metric"],
                peak=float(a["peak"]),
                start_offset_min=int(a["start_offset_min"]),
                duration_min=int(a["duration_min"]),
            ))
        except (KeyError, TypeError, ValueError) as e:
            print(f"[WARN] anomalies_hint 条目无效已忽略: {a} ({e})")
    return stations, anomalies


# ----------------------------------------------------------------------------
# TDengine REST 客户端封装
# ----------------------------------------------------------------------------
class TDengineREST:
    def __init__(self, url: str, user: str, password: str, database: str):
        self.url = url.rstrip("/") + "/rest/sql"
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "text/plain",
        }
        self.database = database

    def exec(self, sql: str) -> dict:
        req = urllib.request.Request(
            self.url, data=sql.encode("utf-8"),
            headers=self.headers, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status}: {body[:200]}")
                data = json.loads(body)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
        if data.get("code", 0) != 0:
            raise RuntimeError(f"TDengine error: {data}")
        return data

    def exec_many(self, statements: Iterable[str]) -> None:
        for sql in statements:
            self.exec(sql)

    def ensure_db_and_stable(self):
        self.exec(f"CREATE DATABASE IF NOT EXISTS {self.database} PRECISION 'ms' KEEP 365")
        self.exec(
            f"""CREATE STABLE IF NOT EXISTS {self.database}.water_quality (
                ts TIMESTAMP,
                ph FLOAT, `do` FLOAT, nh3_n FLOAT, codmn FLOAT, turbidity FLOAT,
                conductivity FLOAT, chlorophyll FLOAT, blue_green_algae FLOAT,
                total_n FLOAT, total_p FLOAT, codcr FLOAT, transparency FLOAT,
                orp FLOAT, water_temperature FLOAT, tds FLOAT, sal FLOAT,
                flow_speed FLOAT, flow_rate FLOAT, water_level FLOAT
            ) TAGS (station_id VARCHAR(64), station_type VARCHAR(32), region VARCHAR(64))"""
        )


# ----------------------------------------------------------------------------
# 数据生成
# ----------------------------------------------------------------------------
def seasonal_multiplier(ts: datetime) -> float:
    # 日内节律：凌晨 DO 低、正午 DO 高；这里返回一个 0.95 ~ 1.05 之间的系数
    hour = ts.hour + ts.minute / 60.0
    return 1.0 + 0.05 * math.sin(math.pi * (hour - 6) / 12)


def temp_multiplier(ts: datetime) -> float:
    # 季节节律：春夏高、冬季低
    day_of_year = ts.timetuple().tm_yday
    return 1.0 + 0.15 * math.sin(2 * math.pi * (day_of_year - 81) / 365)


def gen_value(rng: random.Random, mean: float, std: float) -> float:
    v = rng.gauss(mean, std)
    return max(v, 0.0)


def apply_anomaly(
    station_code: str, ts: datetime, now: datetime,
    metrics: Dict[str, float]
) -> Dict[str, float]:
    for anomaly in ANOMALIES:
        if anomaly.station_code != station_code:
            continue
        start = now + timedelta(minutes=anomaly.start_offset_min)
        end = start + timedelta(minutes=anomaly.duration_min)
        if not (start <= ts <= end):
            continue
        # 线性上升到峰值再下降（单峰）
        total = anomaly.duration_min
        pos = (ts - start).total_seconds() / 60.0
        # 三角脉冲
        if pos <= total / 2:
            factor = pos / (total / 2)
        else:
            factor = (total - pos) / (total / 2)
        base = metrics.get(anomaly.metric, 0.0)
        peak = anomaly.peak
        metrics[anomaly.metric] = base + (peak - base) * max(0.0, min(1.0, factor))
    return metrics


def generate_rows(
    station_code: str, station_type: str,
    start_ts: datetime, end_ts: datetime,
    interval_min: int, seed: int, now: datetime,
) -> Iterable[Tuple[datetime, Dict[str, float]]]:
    rng = random.Random(seed)
    base = BASELINE.get(station_type, BASELINE["rural_water"])
    ts = start_ts
    while ts <= end_ts:
        t_mul = temp_multiplier(ts)
        s_mul = seasonal_multiplier(ts)
        row: Dict[str, float] = {}
        for metric, (mean, std) in base.items():
            mul = 1.0
            if metric == "water_temperature":
                mul = t_mul
            elif metric == "do":
                mul = s_mul
            row[metric] = gen_value(rng, mean * mul, std)
        # pH 限定 5.5~9
        row["ph"] = min(9.0, max(5.5, row["ph"]))
        # 异常注入
        row = apply_anomaly(station_code, ts, now, row)
        yield ts, row
        ts += timedelta(minutes=interval_min)


def format_value_row(ts: datetime, row: Dict[str, float]) -> str:
    vals = [f"'{ts.strftime('%Y-%m-%d %H:%M:%S')}'"]
    for m in METRIC_ORDER:
        v = row.get(m)
        vals.append("NULL" if v is None else f"{v:.4f}")
    return f"({', '.join(vals)})"


def ingest_station(
    client: TDengineREST, station_code: str, station_type: str, region: str,
    start_ts: datetime, end_ts: datetime, interval_min: int, now: datetime,
    batch_size: int, seed: int,
) -> int:
    sub_table = f"wq_{station_code}"
    # 使用超级表动态建子表
    using = (
        f"USING {client.database}.water_quality TAGS "
        f"('{station_code}', '{station_type}', '{region}')"
    )
    fields = "(" + ", ".join(["ts"] + [f"`{m}`" if m == "do" else m for m in METRIC_ORDER]) + ")"
    buffer: List[str] = []
    total = 0
    for ts, row in generate_rows(station_code, station_type, start_ts, end_ts, interval_min, seed, now):
        buffer.append(format_value_row(ts, row))
        if len(buffer) >= batch_size:
            sql = (
                f"INSERT INTO {client.database}.{sub_table} {using} {fields} VALUES "
                + ",".join(buffer)
            )
            client.exec(sql)
            total += len(buffer)
            buffer.clear()
    if buffer:
        sql = (
            f"INSERT INTO {client.database}.{sub_table} {using} {fields} VALUES "
            + ",".join(buffer)
        )
        client.exec(sql)
        total += len(buffer)
    return total


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TDengine 水质历史数据种子脚本（区域化）")
    p.add_argument("--region", default=_detect_region(),
                   help="目标区域代码，默认自动检测 regions/ 目录下可用区域（或读环境变量 REGION_CODE）")
    p.add_argument("--url", default=os.getenv("TDENGINE_HTTP_URL", "http://localhost:16041"),
                   help="TDengine REST 地址，默认 http://localhost:16041")
    p.add_argument("--user", default=os.getenv("TDENGINE_USER", "root"))
    p.add_argument("--password", default=os.getenv("TDENGINE_PASSWORD", "taosdata"))
    p.add_argument("--database", default=os.getenv("TDENGINE_DATABASE", "water_env"))
    p.add_argument("--days", type=int, default=90, help="回溯天数（默认 90）")
    p.add_argument("--interval", type=int, default=10, help="采样间隔分钟（默认 10）")
    p.add_argument("--batch-size", type=int, default=500, help="批量插入行数（默认 500）")
    p.add_argument("--stations", nargs="*", default=None,
                   help="仅写入指定 station_code 列表（默认全部 73 个）")
    p.add_argument("--skip-existing", action="store_true",
                   help="若子表已有数据则跳过（通过 COUNT(*) 检查）")
    return p.parse_args()


def main() -> int:
    global STATIONS, ANOMALIES
    args = parse_args()
    override = load_region_override(args.region)
    if override is not None:
        STATIONS, ANOMALIES = override
        print(f"[INFO] 已加载 regions/{args.region}/db/tdengine/stations.json："
              f"{len(STATIONS)} 个站点 / {len(ANOMALIES)} 条异常")
    else:
        print(f"[WARN] 未找到 regions/{args.region}/db/tdengine/stations.json，"
              f"回退内置赣州 73 站点——请补齐站点配置！")
    print(f"[INFO] region={args.region} target={args.url} db={args.database} days={args.days} interval={args.interval}min")
    client = TDengineREST(args.url, args.user, args.password, args.database)
    try:
        client.ensure_db_and_stable()
    except Exception as e:
        print(f"[ERR] 初始化数据库/超级表失败：{e}")
        return 1

    now = datetime.now().replace(second=0, microsecond=0)
    # 对齐到 interval 分钟的整点，避免最后一条落入未来
    now = now - timedelta(minutes=now.minute % args.interval)
    start_ts = now - timedelta(days=args.days)
    print(f"[INFO] time range: {start_ts} ~ {now}")

    targets = [
        s for s in STATIONS
        if args.stations is None or s[0] in args.stations
    ]
    print(f"[INFO] will seed {len(targets)} stations")

    start_time = time.time()
    total_rows = 0
    for idx, (code, stype, region, river) in enumerate(targets, 1):
        if args.skip_existing:
            try:
                res = client.exec(
                    f"SELECT COUNT(*) FROM {args.database}.wq_{code}"
                )
                cnt = 0
                if res.get("data"):
                    cnt = int(res["data"][0][0])
                if cnt > 1000:
                    print(f"[SKIP] [{idx}/{len(targets)}] {code} already has {cnt} rows")
                    continue
            except Exception:
                pass  # 子表不存在也算正常

        seed = abs(hash(code)) % (2**31)
        try:
            rows = ingest_station(
                client, code, stype, region,
                start_ts, now, args.interval, now,
                args.batch_size, seed,
            )
            total_rows += rows
            elapsed = time.time() - start_time
            print(f"[OK]  [{idx}/{len(targets)}] {code:<8} type={stype:<17} "
                  f"region={region:<8} rows={rows:<6} elapsed={elapsed:.1f}s")
        except Exception as e:
            print(f"[ERR] [{idx}/{len(targets)}] {code}: {e}")
            return 2

    print(f"[DONE] total rows inserted: {total_rows} in {time.time()-start_time:.1f}s")
    print(f"[DONE] anomalies injected: {len(ANOMALIES)} (aligned with ALERT-2026-0001/0002/0003)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
