#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
init_all.py
===========

Windows / Linux 通用一键初始化入口。

流程：
    1) 检查 Docker 是否可用
    2) （可选）`docker compose up -d` 启动基础设施
    3) 等待 postgres / neo4j / tdengine / emqx 容器健康
    4) 调用 init_neo4j.py 导入当前 region 的 Cypher 图谱
    5) 调用 scripts/seed_tdengine.py 写入当前 region 的 90 天仿真时序

用法（项目根目录执行）：
    python deploy/init_all.py                     # 默认 region=ganzhou（或环境变量 REGION_CODE）
    python deploy/init_all.py --region hefei      # 指定城市
    python deploy/init_all.py --up                # 同时 docker compose up -d
    python deploy/init_all.py --skip-tdengine     # 只初始化 Neo4j
    python deploy/init_all.py --force-neo4j       # 强制重导 Neo4j

PostgreSQL 初始化由 docker-compose.yml 的 initdb.d 自动完成（按 REGION_CODE 挂载 region 目录），本脚本不处理。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILE = PROJECT_ROOT / "docker-compose.yml"
SEED_TDENGINE = PROJECT_ROOT / "scripts" / "seed_tdengine.py"
INIT_NEO4J = Path(__file__).resolve().parent / "init_neo4j.py"
IMAGES_DIR = Path(__file__).resolve().parent / "images"
DEFAULT_REGION = os.getenv("REGION_CODE", "ganzhou")
CONTAINER_PREFIX = os.getenv("CONTAINER_PREFIX", "water")
DEFAULT_TDENGINE_URL = os.getenv("TDENGINE_HTTP_URL", "http://localhost:6041")
DEFAULT_NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
DEFAULT_NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
DEFAULT_NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "water123")

# 默认容器名：根据 CONTAINER_PREFIX 动态拼接（支持多区域同机并行）
HEALTH_TARGETS = [
    f"{CONTAINER_PREFIX}_postgres",
    f"{CONTAINER_PREFIX}_neo4j",
    f"{CONTAINER_PREFIX}_tdengine",
    f"{CONTAINER_PREFIX}_emqx",
]


def log_step(msg: str) -> None:
    print(f"\n\033[34m[STEP]\033[0m {msg}")


def log_info(msg: str) -> None:
    print(f"\033[32m[INFO]\033[0m {msg}")


def log_warn(msg: str) -> None:
    print(f"\033[33m[WARN]\033[0m {msg}")


def log_error(msg: str) -> None:
    print(f"\033[31m[ERROR]\033[0m {msg}", file=sys.stderr)


def check_docker() -> bool:
    if shutil.which("docker") is None:
        log_error("未找到 docker 命令，请先安装 Docker Desktop")
        return False
    try:
        subprocess.run(
            ["docker", "info"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        log_error("Docker 服务未启动")
        return False
    return True


def load_offline_images() -> bool:
    """断网部署：将 deploy/images/*.tar 逐个 docker load。"""
    if not IMAGES_DIR.exists():
        log_warn(f"镜像目录不存在: {IMAGES_DIR}")
        return True
    tars = sorted(IMAGES_DIR.glob("*.tar"))
    if not tars:
        log_info("deploy/images/ 无 .tar 文件，跳过离线导入（假设镜像已在本地或可联网 pull）")
        return True
    log_info(f"发现 {len(tars)} 个离线镜像，开始导入 ...")
    for i, tar in enumerate(tars, 1):
        print(f"  [{i}/{len(tars)}] docker load {tar.name}")
        rc = subprocess.call(["docker", "load", "-i", str(tar)],
                             stdout=subprocess.DEVNULL)
        if rc != 0:
            log_error(f"导入失败: {tar.name}")
            return False
    log_info("离线镜像导入完成")
    return True


def compose_up(region: str) -> bool:
    if not COMPOSE_FILE.exists():
        log_error(f"未找到编排文件: {COMPOSE_FILE}")
        return False
    log_info(f"docker compose -f {COMPOSE_FILE.name} up -d  (REGION_CODE={region})")
    env = os.environ.copy()
    env["REGION_CODE"] = region
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d"],
            cwd=str(PROJECT_ROOT),
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        log_error(f"docker compose up 失败: {e}")
        return False
    return True


def inspect_health(container: str) -> str | None:
    """返回 'healthy' / 'starting' / 'unhealthy' / None（容器不存在）。"""
    try:
        out = subprocess.run(
            ["docker", "inspect", container],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        data = json.loads(out)
        if not data:
            return None
        state = data[0].get("State", {})
        health = state.get("Health")
        if health:
            return health.get("Status")
        # 无 healthcheck 则按 running 近似
        return "healthy" if state.get("Running") else "unhealthy"
    except (subprocess.CalledProcessError, json.JSONDecodeError, IndexError):
        return None


def wait_for_healthy(containers: list[str], timeout: int = 180) -> bool:
    start = time.time()
    pending = set(containers)
    while pending:
        if time.time() - start > timeout:
            log_error(f"等待容器健康超时 ({timeout}s): {', '.join(sorted(pending))}")
            return False
        for c in list(pending):
            status = inspect_health(c)
            if status is None:
                # 容器还没创建出来，再等等
                continue
            if status == "healthy":
                log_info(f"{c} healthy")
                pending.discard(c)
        if pending:
            time.sleep(3)
            print(f"  等待: {', '.join(sorted(pending))}")
    return True


def run_init_neo4j(region: str, force: bool, uri: str, user: str, password: str) -> int:
    cmd = [
        sys.executable, str(INIT_NEO4J),
        "--region", region,
        "--uri", uri,
        "--user", user,
        "--password", password,
    ]
    if force:
        cmd.append("--force")
    log_info(" ".join(cmd))
    return subprocess.call(cmd, cwd=str(PROJECT_ROOT))


def run_seed_tdengine(region: str, url: str, days: int, interval: int) -> int:
    if not SEED_TDENGINE.exists():
        log_error(f"未找到种子脚本: {SEED_TDENGINE}")
        return 1
    cmd = [
        sys.executable,
        str(SEED_TDENGINE),
        "--region", region,
        "--url", url,
        "--days", str(days),
        "--interval", str(interval),
        "--batch-size", "500",
        "--skip-existing",
    ]
    log_info(" ".join(cmd))
    return subprocess.call(cmd, cwd=str(PROJECT_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="流域水环境平台 - 本地开发一键初始化（支持多区域）")
    parser.add_argument("--region", default=DEFAULT_REGION,
                        help="目标城市编码（ganzhou/hefei/nanchang/...），默认读环境变量 REGION_CODE 或 'ganzhou'")
    parser.add_argument("--up", action="store_true",
                        help="先执行 docker compose up -d 启动基础设施")
    parser.add_argument("--load-images", action="store_true",
                        help="断网部署：compose up 之前先 docker load deploy/images/*.tar")
    parser.add_argument("--skip-neo4j", action="store_true", help="跳过 Neo4j 图谱初始化")
    parser.add_argument("--skip-tdengine", action="store_true", help="跳过 TDengine 种子数据")
    parser.add_argument("--force-neo4j", action="store_true",
                        help="即使 Neo4j 已有数据也清空重导")
    parser.add_argument("--tdengine-url", default=DEFAULT_TDENGINE_URL,
                        help="TDengine REST URL（默认读环境变量 TDENGINE_HTTP_URL，回落 http://localhost:6041）")
    parser.add_argument("--neo4j-uri", default=DEFAULT_NEO4J_URI,
                        help="Neo4j Bolt URI（默认读环境变量 NEO4J_URI，回落 bolt://localhost:7687）")
    parser.add_argument("--neo4j-user", default=DEFAULT_NEO4J_USER)
    parser.add_argument("--neo4j-password", default=DEFAULT_NEO4J_PASSWORD)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--interval", type=int, default=10)
    args = parser.parse_args()

    region = args.region

    print("=" * 50)
    print("  流域水环境AI平台 - 本地数据初始化")
    print(f"  Region: {region}")
    print("=" * 50)

    log_step("1. 检查 Docker")
    if not check_docker():
        return 1

    if args.load_images:
        log_step("1.5 导入离线镜像 (deploy/images/*.tar)")
        if not load_offline_images():
            return 1

    if args.up:
        log_step(f"2. 启动基础设施（REGION_CODE={region}）")
        if not compose_up(region):
            return 1
    else:
        log_step("2. 跳过 compose up（假设基础设施已运行；如未启动请加 --up）")

    log_step("3. 等待容器健康")
    if not wait_for_healthy(HEALTH_TARGETS):
        return 1

    if args.skip_neo4j:
        log_step("4. 跳过 Neo4j 初始化")
    else:
        log_step(f"4. 初始化 Neo4j 图谱（region={region}）")
        rc = run_init_neo4j(
            region=region,
            force=args.force_neo4j,
            uri=args.neo4j_uri,
            user=args.neo4j_user,
            password=args.neo4j_password,
        )
        if rc != 0:
            log_error(f"Neo4j 初始化失败 (exit={rc})")
            return rc

    if args.skip_tdengine:
        log_step("5. 跳过 TDengine 种子")
    else:
        log_step(f"5. 写入 TDengine 历史时序数据（region={region}）")
        rc = run_seed_tdengine(region, args.tdengine_url, args.days, args.interval)
        if rc != 0:
            log_warn(f"TDengine 种子未完全成功 (exit={rc})，可单独重跑")

    print()
    print("=" * 50)
    print("  ✅ 初始化完成")
    print("=" * 50)
    print()
    print("  下一步（本机启动前后端）:")
    print("    cd backend  &&  python -m uvicorn app.main:app --port 8000 --reload")
    print("    cd frontend &&  npm run dev")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
