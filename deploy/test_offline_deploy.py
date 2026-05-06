#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_offline_deploy.py
======================

断网离线部署冒烟测试（方案 3：独立 compose 栈）。

在不影响现有 ai-water-env 主栈的前提下，完整验证：
    tar 完整性 → docker load → compose up → 健康检查 → 外部端口可达
全流程通过即证明 deploy/images/*.tar 能在真正的断网机器上跑起来。

隔离设计：
    - project name:  ai-water-env-offline-test   （与主栈 ai-water-env 不同）
    - 容器名前缀:    water_test_*
    - 端口偏移:      +10000  （emqx 18083 -> 28083 以避让 dashboard）
    - 卷名:          water_test_*_data
    - 配置文件:      deploy/docker-compose.test.yml（不挂 regions/ seed）

用法：
    python deploy/test_offline_deploy.py              # 全流程 up
    python deploy/test_offline_deploy.py --retag      # 先把 ai-water-env-*:latest tag 全删再 load（更严格模拟断网）
    python deploy/test_offline_deploy.py --down       # 测完拆掉（连卷一起删）
    python deploy/test_offline_deploy.py --status     # 只看测试栈状态
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_DIR = Path(__file__).resolve().parent
IMAGES_DIR = DEPLOY_DIR / "images"
COMPOSE_TEST_FILE = DEPLOY_DIR / "docker-compose.test.yml"
INIT_NEO4J = DEPLOY_DIR / "init_neo4j.py"
SEED_TDENGINE = PROJECT_ROOT / "scripts" / "seed_tdengine.py"

PROJECT_NAME = "ai-water-env-offline-test"

# 测试栈使用的偏移端口（与 docker-compose.test.yml 对齐）
TEST_POSTGRES_PORT = 15432
TEST_NEO4J_BOLT_URI = "bolt://localhost:17687"
TEST_TDENGINE_URL = "http://localhost:16041"

# 测试栈容器清单（container_name, 端口探测 URL or None, 等待秒上限）
CONTAINERS = [
    ("water_test_postgres",  None,                                      90),
    ("water_test_tdengine",  "http://localhost:16041/-/ping",           120),
    ("water_test_neo4j",     "http://localhost:17474",                  120),
    ("water_test_emqx",      "http://localhost:28083/status",            90),
    ("water_test_minio",     "http://localhost:19000/minio/health/live", 90),
]

# 镜像 tag 清单（用于 --retag 时统一清除）
PROJECT_TAGS = [
    "ai-water-env-postgres:latest",
    "ai-water-env-neo4j:latest",
    "ai-water-env-tdengine:latest",
    "ai-water-env-emqx:latest",
    "ai-water-env-minio:latest",
]
ORIGINAL_TAGS = [
    "neo4j:5.15-community",
    "tdengine/tdengine:3.2.3.0",
    "emqx/emqx:5.5.1",
    "minio/minio:RELEASE.2024-01-13T07-53-03Z",
]


def log_step(msg: str) -> None:
    print(f"\n\033[34m[STEP]\033[0m {msg}")


def log_info(msg: str) -> None:
    print(f"\033[32m[INFO]\033[0m {msg}")


def log_warn(msg: str) -> None:
    print(f"\033[33m[WARN]\033[0m {msg}")


def log_error(msg: str) -> None:
    print(f"\033[31m[ERROR]\033[0m {msg}", file=sys.stderr)


def run(cmd: list[str], check: bool = True, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, **kw)


def check_docker() -> bool:
    if shutil.which("docker") is None:
        log_error("未找到 docker 命令")
        return False
    try:
        run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        log_error("Docker 服务未启动")
        return False
    return True


def compose(*args: str, check: bool = True, env_extra: dict | None = None) -> int:
    """docker compose -p <project> -f <file> ..."""
    cmd = ["docker", "compose", "-p", PROJECT_NAME, "-f", str(COMPOSE_TEST_FILE), *args]
    log_info("  $ " + " ".join(cmd[2:]))
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    if not check:
        return subprocess.call(cmd, env=env)
    return subprocess.run(cmd, env=env, check=True).returncode


# ---------- 子命令 ----------

def cmd_retag() -> int:
    """模拟断网场景：清除所有 ai-water-env-* tag（含 postgres 自建镜像）。"""
    log_step("清除项目 tag（保留原始第三方 tag，避免影响主栈）")
    for tag in PROJECT_TAGS:
        rc = subprocess.call(
            ["docker", "rmi", tag],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if rc == 0:
            log_info(f"  removed  {tag}")
        else:
            log_warn(f"  skip     {tag} (not found)")
    return 0


def cmd_load() -> int:
    log_step("docker load 离线 tar")
    if not IMAGES_DIR.exists():
        log_error(f"不存在: {IMAGES_DIR}")
        return 1
    tars = sorted(IMAGES_DIR.glob("*.tar"))
    if not tars:
        log_error("deploy/images/*.tar 为空，先运行 pack_images.py")
        return 1
    for i, tar in enumerate(tars, 1):
        print(f"  [{i}/{len(tars)}] docker load {tar.name}  ({tar.stat().st_size / 1024 / 1024:.1f} MB)")
        rc = subprocess.call(
            ["docker", "load", "-i", str(tar)],
            stdout=subprocess.DEVNULL,
        )
        if rc != 0:
            log_error(f"load 失败: {tar.name}")
            return 1
    # 确认项目 tag 都回来了
    log_info("验证项目 tag：")
    for tag in PROJECT_TAGS:
        rc = subprocess.call(
            ["docker", "image", "inspect", tag],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if rc == 0:
            print(f"  ✓ {tag}")
        else:
            log_error(f"  ✗ {tag} 未就绪")
            return 1
    return 0


def http_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except Exception:
        return False


def wait_container_healthy(name: str, max_seconds: int) -> bool:
    """优先看 docker health=healthy；无 healthcheck 则退化为 running 判断。"""
    deadline = time.time() + max_seconds
    last_state = ""
    while time.time() < deadline:
        try:
            r = subprocess.run(
                ["docker", "inspect", "--format", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}", name],
                check=True, capture_output=True, text=True,
            )
            status, health = (r.stdout.strip() + "|").split("|")[:2]
            state = f"{status}/{health or 'no-health'}"
            if state != last_state:
                print(f"    {name}: {state}")
                last_state = state
            if health == "healthy":
                return True
            if not health and status == "running":
                return True
            if status in ("exited", "dead"):
                return False
        except subprocess.CalledProcessError:
            pass
        time.sleep(3)
    return False


def cmd_up(region: str = "ganzhou") -> int:
    log_step(f"compose up -d  (project={PROJECT_NAME}, REGION_CODE={region})")
    compose("up", "-d", env_extra={"REGION_CODE": region})

    log_step("等待容器健康（docker healthcheck + HTTP 退化）")
    all_ok = True
    for name, url, max_s in CONTAINERS:
        ok = wait_container_healthy(name, max_s)
        if ok:
            log_info(f"  ✓ {name} healthy")
            continue
        # healthcheck 不通时，用外部 HTTP 探测做最后判定（更贴近用户感知）
        if url and http_ok(url):
            log_warn(f"  ~ {name} healthcheck 超时但外部 HTTP 可达：{url}（视为通过）")
        else:
            log_error(f"  ✗ {name} 未在 {max_s}s 内健康")
            all_ok = False

    log_step("外部端口探测")
    for name, url, _ in CONTAINERS:
        if not url:
            print(f"  - {name}  (无 HTTP 探测，容器状态已在上一步校验)")
            continue
        ok = http_ok(url)
        tag = "✓" if ok else "✗"
        print(f"  {tag} {name:<24} {url}")
        if not ok:
            all_ok = False

    if all_ok:
        log_step("冒烟测试通过")
        print("  测试栈访问入口：")
        print("    PostgreSQL   localhost:15432  (water / water123 / water_env)")
        print("    TDengine     localhost:16041  (REST)  /  16030 (taosc)")
        print("    Neo4j        http://localhost:17474    (neo4j / water123)")
        print("    EMQX         MQTT 11883  / WS 28080  / Dashboard http://localhost:28083")
        print("    MinIO        http://localhost:19001   (water / water12345)")
        print()
        print("  清理：python deploy/test_offline_deploy.py --down")
        return 0
    else:
        log_error("冒烟测试存在未通过项，请用以下命令排查：")
        print(f"  docker compose -p {PROJECT_NAME} -f {COMPOSE_TEST_FILE} logs --tail=80")
        return 1


def cmd_down() -> int:
    log_step(f"compose down -v  (project={PROJECT_NAME})")
    compose("down", "-v", check=False)
    log_info("测试栈容器与卷已清理")
    return 0


def cmd_status() -> int:
    log_step(f"compose ps  (project={PROJECT_NAME})")
    compose("ps", check=False)
    return 0


# ---------- 数据初始化验证 ----------

def count_postgres_tables() -> int:
    """在测试栈 postgres 容器内 psql 查 public schema 表数。"""
    r = subprocess.run(
        ["docker", "exec", "water_test_postgres", "psql", "-U", "water", "-d", "water_env",
         "-tAc", "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"],
        capture_output=True, text=True,
    )
    try:
        return int(r.stdout.strip() or "0")
    except ValueError:
        return 0


def wait_postgres_initdb(expect_min_tables: int = 10, timeout: int = 300) -> bool:
    """Postgres 首次启动会执行 initdb 下的 10 个 SQL，耗时较长（seed 数据大）。"""
    deadline = time.time() + timeout
    last = -1
    while time.time() < deadline:
        n = count_postgres_tables()
        if n != last:
            print(f"    postgres tables in public: {n}")
            last = n
        if n >= expect_min_tables:
            return True
        time.sleep(5)
    return False


def list_postgres_tables() -> list[str]:
    r = subprocess.run(
        ["docker", "exec", "water_test_postgres", "psql", "-U", "water", "-d", "water_env",
         "-tAc", "SELECT table_name FROM information_schema.tables "
                 "WHERE table_schema='public' ORDER BY table_name"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return []
    return [line.strip() for line in r.stdout.splitlines() if line.strip()]


def verify_postgres() -> bool:
    log_step("验证 Postgres initdb (容器自动执行 regions/<region>/db/postgres/*.sql)")
    if not wait_postgres_initdb():
        log_error("Postgres initdb 超时未完成")
        return False

    tables = list_postgres_tables()
    log_info(f"public schema 共 {len(tables)} 张表：")
    # 分行打印，便于核对
    for i in range(0, len(tables), 4):
        print("    " + "  ".join(f"{t:<28}" for t in tables[i:i + 4]))

    # 关键表探测（与 regions/ganzhou/db/postgres 真实 schema 对齐）
    probes = [
        "stations",            # 01_init.sql
        "alerts",              # 01_init.sql
        "alert_rules",         # 01_init.sql
        "users",               # 01_init.sql
        "rivers",              # 02_ganzhou_data.sql
        "districts",           # 02_ganzhou_data.sql
        "pollution_cases",     # 03_pollution_cases.sql
        "metrics_catalog",     # 04_additional_tables.sql
        "ai_station_models",   # 04_additional_tables.sql
        "mqtt_connections",    # 04_additional_tables.sql
        "report_templates",    # 04_additional_tables.sql
        "notifications",       # 04_additional_tables.sql
    ]
    existing = set(tables)
    missing = [t for t in probes if t not in existing]
    if missing:
        log_error(f"关键表缺失: {missing}")
        return False

    ok = True
    for t in probes:
        r = subprocess.run(
            ["docker", "exec", "water_test_postgres", "psql", "-U", "water", "-d", "water_env",
             "-tAc", f"SELECT COUNT(*) FROM {t}"],
            capture_output=True, text=True,
        )
        cnt = (r.stdout or "").strip()
        if r.returncode == 0 and cnt.isdigit():
            print(f"  ✓ {t:<25} rows={cnt}")
        else:
            print(f"  ✗ {t:<25} {r.stderr.strip() or 'query failed'}")
            ok = False
    # 门槛：至少 20 张表（真实背景为 28）
    if len(tables) < 20:
        log_error(f"表数量异常: {len(tables)} < 20")
        ok = False
    return ok


def run_init_neo4j(region: str) -> bool:
    log_step(f"调用 init_neo4j.py (uri={TEST_NEO4J_BOLT_URI}, region={region})")
    cmd = [
        sys.executable, str(INIT_NEO4J),
        "--uri", TEST_NEO4J_BOLT_URI,
        "--region", region,
        "--force",
    ]
    log_info("  $ " + " ".join(cmd))
    rc = subprocess.call(cmd, cwd=str(PROJECT_ROOT))
    if rc != 0:
        log_error(f"init_neo4j.py 失败 (exit={rc})")
        return False
    return True


def run_seed_tdengine(region: str, days: int) -> bool:
    log_step(f"调用 seed_tdengine.py (url={TEST_TDENGINE_URL}, region={region}, days={days})")
    if not SEED_TDENGINE.exists():
        log_error(f"未找到: {SEED_TDENGINE}")
        return False
    cmd = [
        sys.executable, str(SEED_TDENGINE),
        "--region", region,
        "--url", TEST_TDENGINE_URL,
        "--days", str(days),
        "--interval", "10",
        "--batch-size", "500",
        "--skip-existing",
    ]
    log_info("  $ " + " ".join(cmd))
    rc = subprocess.call(cmd, cwd=str(PROJECT_ROOT))
    if rc != 0:
        log_error(f"seed_tdengine.py 失败 (exit={rc})")
        return False
    return True


def cmd_init(region: str, days: int) -> int:
    log_step(f"数据初始化 (region={region}, tdengine days={days})")
    ok = True
    if not verify_postgres():
        ok = False
    if not run_init_neo4j(region):
        ok = False
    if not run_seed_tdengine(region, days):
        ok = False
    if ok:
        log_step("数据初始化全部通过 ✓")
        return 0
    log_error("数据初始化有未通过项")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="断网离线部署冒烟测试（独立 compose 栈）")
    parser.add_argument("--retag", action="store_true",
                        help="up 之前先 rmi 所有 ai-water-env-* tag，严格模拟断网")
    parser.add_argument("--down", action="store_true",
                        help="拆除测试栈（连卷一起删）")
    parser.add_argument("--status", action="store_true",
                        help="只显示测试栈当前容器状态")
    parser.add_argument("--init", action="store_true",
                        help="up 成功后继续验证数据初始化：Postgres initdb + init_neo4j.py + seed_tdengine.py")
    parser.add_argument("--region", default=os.getenv("REGION_CODE", "ganzhou"),
                        help="初始化时的 region，默认 ganzhou。会同时传给 compose 以挂载 regions/<region>/db/postgres")
    parser.add_argument("--days", type=int, default=1,
                        help="TDengine 种子回溯天数（默认 1，冷烟用，正式验证可传 7/30/90）")
    args = parser.parse_args()

    print("=" * 56)
    print(f"  离线部署冒烟测试  (project={PROJECT_NAME})")
    print("=" * 56)

    if not check_docker():
        return 1
    if not COMPOSE_TEST_FILE.exists():
        log_error(f"缺少测试 compose 文件: {COMPOSE_TEST_FILE}")
        return 1

    if args.status:
        return cmd_status()
    if args.down:
        return cmd_down()

    if args.retag:
        if cmd_retag() != 0:
            return 1
    if cmd_load() != 0:
        return 1
    rc = cmd_up(region=args.region)
    if rc != 0:
        return rc
    if args.init:
        return cmd_init(region=args.region, days=args.days)
    return 0


if __name__ == "__main__":
    sys.exit(main())
