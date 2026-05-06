#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
init_neo4j.py
=============

将 Cypher 种子导入本地 Neo4j 容器。根据 --region（或 REGION_CODE 环境变量）
首先从 regions/<region>/db/neo4j 读取，若不存在则回退到仓库默认的
infrastructure/docker/neo4j/init。

跨平台（Windows / Linux / macOS）、无需 docker exec、无需 cypher-shell。
只依赖 `neo4j` Python 驱动（项目 backend/requirements.txt 已含）。

用法：
    python deploy/init_neo4j.py                    # 默认 region=ganzhou
    python deploy/init_neo4j.py --region hefei     # 切换合肥
    python deploy/init_neo4j.py --force            # 即使已有数据也强制重导
    python deploy/init_neo4j.py --uri bolt://localhost:7687 --password water123
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

try:
    from neo4j import GraphDatabase
    from neo4j.exceptions import ServiceUnavailable, AuthError
except ImportError:
    print("[ERROR] 缺少 neo4j 驱动：pip install neo4j==5.14.0", file=sys.stderr)
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INIT_DIR = PROJECT_ROOT / "infrastructure" / "docker" / "neo4j" / "init"
REGIONS_ROOT = PROJECT_ROOT / "regions"
DEFAULT_REGION = os.getenv("REGION_CODE", "ganzhou")
CYPHER_FILES = [
    "01_knowledge_graph.cypher",
    "02_river_topology.cypher",
    "03_monitoring_stations.cypher",
    "04_pollution_sources.cypher",
    "05_station_topology_patch.cypher",
    "06_pollution_events.cypher",
]


def resolve_init_dir(region: str) -> Path:
    """优先使用 regions/<region>/db/neo4j，不存在则回退 infrastructure 默认目录。"""
    region_dir = REGIONS_ROOT / region / "db" / "neo4j"
    if region_dir.exists() and any(region_dir.glob("*.cypher")):
        return region_dir
    print(f"[WARN] regions/{region}/db/neo4j 不存在或为空，回退使用 {DEFAULT_INIT_DIR}", file=sys.stderr)
    return DEFAULT_INIT_DIR


def strip_comments(text: str) -> str:
    """去除 // 行注释与 /* */ 块注释，保留字符串内容。"""
    out_lines = []
    in_block = False
    for line in text.splitlines():
        i = 0
        buf = []
        while i < len(line):
            ch = line[i]
            nxt = line[i + 1] if i + 1 < len(line) else ""
            if in_block:
                if ch == "*" and nxt == "/":
                    in_block = False
                    i += 2
                    continue
                i += 1
                continue
            if ch == "/" and nxt == "/":
                break  # 行注释
            if ch == "/" and nxt == "*":
                in_block = True
                i += 2
                continue
            buf.append(ch)
            i += 1
        out_lines.append("".join(buf))
    return "\n".join(out_lines)


def split_statements(text: str) -> list[str]:
    """按分号拆分 Cypher 语句，忽略空白与纯注释段。"""
    cleaned = strip_comments(text)
    stmts = []
    buf = []
    in_str = False
    quote = ""
    for ch in cleaned:
        if in_str:
            buf.append(ch)
            if ch == quote:
                in_str = False
            continue
        if ch in ("'", '"'):
            in_str = True
            quote = ch
            buf.append(ch)
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                stmts.append(stmt)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def wait_for_neo4j(uri: str, user: str, password: str, timeout: int = 120) -> GraphDatabase.driver:
    """轮询直到 Neo4j 可连接。"""
    start = time.time()
    while True:
        try:
            driver = GraphDatabase.driver(uri, auth=(user, password))
            driver.verify_connectivity()
            return driver
        except AuthError:
            print(f"[ERROR] Neo4j 认证失败（user={user}）", file=sys.stderr)
            sys.exit(2)
        except ServiceUnavailable:
            elapsed = int(time.time() - start)
            if elapsed >= timeout:
                print(f"[ERROR] Neo4j 在 {timeout}s 内未就绪：{uri}", file=sys.stderr)
                sys.exit(3)
            print(f"  等待 Neo4j 就绪 ... ({elapsed}s)")
            time.sleep(3)


def run_init(
    uri: str = "bolt://localhost:7687",
    user: str = "neo4j",
    password: str = "water123",
    init_dir: Path = DEFAULT_INIT_DIR,
    force: bool = False,
) -> int:
    print("=" * 46)
    print("  Neo4j 数据初始化")
    print("=" * 46)
    print(f"  目标: {uri}")
    print(f"  脚本目录: {init_dir}")
    print()

    if not init_dir.exists():
        print(f"[ERROR] 初始化目录不存在: {init_dir}", file=sys.stderr)
        return 1

    driver = wait_for_neo4j(uri, user, password)

    try:
        with driver.session() as session:
            # 幂等检查
            if not force:
                result = session.run("MATCH (n) RETURN count(n) AS cnt").single()
                existing = result["cnt"] if result else 0
                if existing and existing > 0:
                    print(f"[SKIP] Neo4j 已有 {existing} 个节点。如需重新初始化，追加 --force")
                    return 0

            if force:
                print("[INFO] --force 启用，清空现有图数据 ...")
                session.run("MATCH (n) DETACH DELETE n").consume()

            # 逐文件、逐语句执行
            total = 0
            for fname in CYPHER_FILES:
                fpath = init_dir / fname
                if not fpath.exists():
                    print(f"[WARN] 未找到: {fpath}")
                    continue
                print(f"[RUN]  {fname}")
                text = fpath.read_text(encoding="utf-8")
                stmts = split_statements(text)
                for idx, stmt in enumerate(stmts, 1):
                    try:
                        session.run(stmt).consume()
                    except Exception as e:
                        print(
                            f"  [ERROR] {fname} 第 {idx} 条语句执行失败：{e}\n"
                            f"  语句片段：{stmt[:200]}...",
                            file=sys.stderr,
                        )
                        raise
                print(f"  ok - {len(stmts)} 条语句")
                total += len(stmts)

            # 验证
            print()
            print("[VERIFY] 节点分布：")
            rows = session.run(
                "MATCH (n) RETURN labels(n)[0] AS type, count(n) AS cnt ORDER BY cnt DESC"
            )
            for r in rows:
                print(f"  {r['type']:<20} {r['cnt']}")

            print()
            print(f"[DONE] 共执行 {total} 条 Cypher 语句")
    finally:
        driver.close()

    return 0


def main():
    parser = argparse.ArgumentParser(description="Neo4j 数据初始化（区域化 + 跨平台 Python 版）")
    parser.add_argument("--region", default=DEFAULT_REGION,
                        help=f"目标区域代码，优先读 regions/<region>/db/neo4j（默认 {DEFAULT_REGION}）")
    parser.add_argument("--uri", default=os.getenv("NEO4J_URI", "bolt://localhost:7687"))
    parser.add_argument("--user", default=os.getenv("NEO4J_USER", "neo4j"))
    parser.add_argument("--password", default=os.getenv("NEO4J_PASSWORD", "water123"))
    parser.add_argument(
        "--init-dir",
        default=os.getenv("NEO4J_INIT_DIR"),
        help="显式指定 Cypher 脚本目录；不传时根据 --region 解析",
    )
    parser.add_argument("--force", action="store_true", help="即使已有数据也清空后重新导入")
    args = parser.parse_args()

    init_dir = Path(args.init_dir) if args.init_dir else resolve_init_dir(args.region)

    print(f"[REGION] {args.region}")

    return run_init(
        uri=args.uri,
        user=args.user,
        password=args.password,
        init_dir=init_dir,
        force=args.force,
    )


if __name__ == "__main__":
    sys.exit(main())
