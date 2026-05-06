#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pack_images.py
==============

基础设施镜像离线打包脚本（跨平台）。

场景：在有网络的开发机上，把 5 个基础设施镜像 `docker save` 成 tar。
      拷贝到断网目标机后，通过 `init_all.py --up --load-images` 载入。

镜像统一带 `ai-water-env-` 前缀，方便在 Docker Desktop 中筛选归属：
    原镜像                                     →  项目镜像（额外 tag）
    ──────────────────────────────────────────    ──────────────────────────────
    ai-water-env-postgres:latest              →  ai-water-env-postgres:latest  (自建)
    neo4j:5.15-community                      →  ai-water-env-neo4j:latest
    tdengine/tdengine:3.2.3.0                 →  ai-water-env-tdengine:latest
    emqx/emqx:5.5.1                           →  ai-water-env-emqx:latest
    minio/minio:RELEASE.2024-01-13T07-53-03Z  →  ai-water-env-minio:latest

tar 内部保留双 tag（共享同一镜像 layer），load 后 docker images 会同时看到两个名字；
docker-compose.yml 继续用原始镜像名，因此有网环境的 `docker compose up` 行为不变。

流程：
    1) 检查 docker 可用
    2) docker compose build postgres   （项目自建镜像 PostGIS + pgvector）
    3) docker pull 其余 4 个第三方镜像（若本地已有则命中 cache）
    4) docker tag 打上 ai-water-env-<name>:latest 前缀
    5) docker save 双 tag 到 deploy/images/ai-water-env-*.tar
    6) 打印产物清单与大小

用法（项目根目录执行，PowerShell / bash 均可）：
    python deploy/pack_images.py
    python deploy/pack_images.py --skip-build   # 跳过 postgres build（已 build 过）
    python deploy/pack_images.py --skip-pull    # 跳过 pull（本地镜像已齐）
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_DIR = Path(__file__).resolve().parent
IMAGES_DIR = DEPLOY_DIR / "images"
COMPOSE_FILE = PROJECT_ROOT / "docker-compose.yml"

PREFIX = "ai-water-env-"

# 原始镜像名 -> (项目镜像名, tar 文件名)
# 所有 tar 都以 PREFIX 开头；load 后镜像同时挂 "原名" 与 "项目名" 两个 tag。
IMAGES: dict[str, tuple[str, str]] = {
    "ai-water-env-postgres:latest":                ("ai-water-env-postgres:latest", "ai-water-env-postgres.tar"),
    "neo4j:5.15-community":                        ("ai-water-env-neo4j:latest",    "ai-water-env-neo4j.tar"),
    "tdengine/tdengine:3.2.3.0":                   ("ai-water-env-tdengine:latest", "ai-water-env-tdengine.tar"),
    "emqx/emqx:5.5.1":                             ("ai-water-env-emqx:latest",     "ai-water-env-emqx.tar"),
    "minio/minio:RELEASE.2024-01-13T07-53-03Z":    ("ai-water-env-minio:latest",    "ai-water-env-minio.tar"),
}

SELF_BUILT = "ai-water-env-postgres:latest"


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
        subprocess.run(["docker", "info"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        log_error("Docker 服务未启动")
        return False
    return True


def build_postgres() -> bool:
    if not COMPOSE_FILE.exists():
        log_error(f"未找到 compose 文件: {COMPOSE_FILE}")
        return False
    log_info(f"docker compose -f {COMPOSE_FILE.name} build postgres")
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "build", "postgres"],
            cwd=str(PROJECT_ROOT),
            check=True,
        )
    except subprocess.CalledProcessError as e:
        log_error(f"postgres 构建失败: {e}")
        return False
    return True


def pull_image(image: str) -> bool:
    print(f"  pull {image}")
    try:
        subprocess.run(["docker", "pull", image], check=True,
                       stdout=subprocess.DEVNULL)
    except subprocess.CalledProcessError as e:
        log_error(f"pull 失败: {image}: {e}")
        return False
    return True


def tag_image(src: str, dst: str) -> bool:
    if src == dst:
        return True
    print(f"  tag {src}  ->  {dst}")
    try:
        subprocess.run(["docker", "tag", src, dst], check=True)
    except subprocess.CalledProcessError as e:
        log_error(f"tag 失败: {src} -> {dst}: {e}")
        return False
    return True


def save_images(tags: list[str], out_path: Path) -> bool:
    """一次性把多个 tag 写进同一个 tar（共享 layer，体积不增）。"""
    print(f"  save [{', '.join(tags)}]  ->  {out_path.name}")
    cmd = ["docker", "save", "-o", str(out_path)] + tags
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        log_error(f"save 失败: {tags}: {e}")
        return False
    return True


def human_size(n: int) -> str:
    mb = n / (1024 * 1024)
    if mb < 1024:
        return f"{mb:>8.1f} MB"
    return f"{mb / 1024:>8.2f} GB"


def cleanup_legacy_tars() -> None:
    """清理旧命名的 tar（无 ai-water-env- 前缀），避免 images/ 残留混乱。"""
    legacy = ["neo4j.tar", "tdengine.tar", "emqx.tar", "minio.tar", "postgres.tar"]
    for name in legacy:
        p = IMAGES_DIR / name
        if p.exists():
            log_info(f"清理旧命名 tar: {name}")
            p.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description="基础设施镜像离线打包（带 ai-water-env- 前缀）")
    parser.add_argument("--skip-build", action="store_true",
                        help="跳过 postgres build 步骤")
    parser.add_argument("--skip-pull", action="store_true",
                        help="跳过 docker pull 步骤（本地镜像已齐）")
    args = parser.parse_args()

    print("=" * 50)
    print("  基础设施镜像离线打包（带前缀）")
    print("=" * 50)

    log_step("0. 前置检查")
    if not check_docker():
        return 1
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    log_info(f"输出目录: {IMAGES_DIR}")
    cleanup_legacy_tars()

    if args.skip_build:
        log_step("1. 跳过 postgres 构建")
    else:
        log_step("1. 构建自建镜像 postgres (PostGIS + pgvector)")
        if not build_postgres():
            return 1

    if args.skip_pull:
        log_step("2. 跳过第三方镜像拉取")
    else:
        log_step("2. 拉取第三方基础设施镜像")
        for src in IMAGES:
            if src == SELF_BUILT:
                continue
            if not pull_image(src):
                return 1

    log_step(f"3. 打项目前缀 tag ({PREFIX}*:latest)")
    for src, (project_tag, _) in IMAGES.items():
        if not tag_image(src, project_tag):
            return 1

    log_step(f"4. 导出 {len(IMAGES)} 个镜像到 {IMAGES_DIR}（双 tag）")
    for src, (project_tag, fname) in IMAGES.items():
        tags = [src] if src == project_tag else [src, project_tag]
        if not save_images(tags, IMAGES_DIR / fname):
            return 1

    log_step("5. 产物清单")
    total = 0
    for _, (_, fname) in IMAGES.items():
        f = IMAGES_DIR / fname
        if f.exists():
            size = f.stat().st_size
            total += size
            print(f"  {f.name:<42} {human_size(size)}")
        else:
            log_warn(f"缺失: {f.name}")
    print(f"  {'合计':<42} {human_size(total)}")

    print()
    print("=" * 50)
    print("  打包完成")
    print("=" * 50)
    print()
    print("  离线机器使用：")
    print("    python deploy/init_all.py --up --load-images")
    print()
    print("  load 后 docker images 会同时出现 ai-water-env-<name>:latest 和原始镜像名。")
    print("  Docker Desktop 中按 'ai-water-env-' 前缀即可一眼识别本项目资产。")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
