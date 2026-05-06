# deploy/ — 部署与初始化

本目录负责：**Docker 基础设施启动 + 数据库初始化**。前后端在本机运行，不走容器。

## 前置要求

- Docker Desktop
- Python 3.11
- Node.js 18+

## 快速开始（本地开发）

```powershell
# 项目根目录执行

# 一键启动基础设施 + 初始化全部数据
python deploy/init_all.py --up

# 启动后端
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 启动前端
cd frontend
npm run dev
```

> 若 Docker 容器已在运行，省略 `--up` 即只做数据初始化：`python deploy/init_all.py`

## 初始化流程说明

`init_all.py` 按以下顺序自动完成所有数据库初始化：

| 步骤 | 动作 | 说明 |
|---|---|---|
| 1 | 检查 Docker 可用性 | |
| 2 | `docker compose up -d` | 启动 5 个基础设施容器（加 `--up` 时） |
| 3 | 等待容器 healthy | 最长等待 180s |
| 4 | PostgreSQL 初始化 | 由 Docker `initdb.d` 卷挂载**自动执行**，无需额外操作 |
| 5 | Neo4j 图谱导入 | 执行 6 个 Cypher 文件（河流拓扑、监测站、污染源等） |
| 6 | TDengine 时序种子 | 生成 90 天 × 10 分钟级仿真水质数据（19 项指标） |

**PostgreSQL** 初始化由 `docker-compose.yml` 挂载 `regions/<region>/db/postgres/*.sql` 到容器 initdb 目录，容器首次启动自动执行。

**Neo4j** 由 `deploy/init_neo4j.py` 通过 Python neo4j 驱动导入，幂等（已有数据自动跳过）。

**TDengine** 由 `scripts/seed_tdengine.py` 通过 REST API 批量写入，支持 `--skip-existing` 跳过已有子表。

## 常用参数

```powershell
python deploy/init_all.py --up                    # 启动容器 + 全量初始化
python deploy/init_all.py --region hefei           # 指定城市（默认 ganzhou）
python deploy/init_all.py --skip-neo4j             # 只跑 TDengine
python deploy/init_all.py --skip-tdengine          # 只跑 Neo4j
python deploy/init_all.py --force-neo4j            # Neo4j 清空重导
python deploy/init_all.py --days 30 --interval 10  # 控制时序数据量
```

## 多区域交付打包

使用 `pack-region.ps1` 可从全量工程派生单城市独立交付包：

```powershell
# 打包合肥交付物
.\deploy\pack-region.ps1 -Region hefei

# 打包南昌（含离线镜像）
.\deploy\pack-region.ps1 -Region nanchang -IncludeImages

# 指定输出目录，不生成 zip
.\deploy\pack-region.ps1 -Region ganzhou -OutDir D:\delivery -NoZip
```

脚本自动完成：复制工程 → 删除其他 region → 改写环境变量 → 注入端口偏移 → 可选打 zip。

同机并行时各城市端口互不冲突（赣州默认 / 合肥 +1 / 南昌 +2）。

## 离线部署

目标机器无法联网时：

```powershell
# 有网机器：导出 5 个基础设施镜像为 tar
python deploy/pack_images.py

# 目标机器：加载镜像 + 启动 + 初始化
python deploy/init_all.py --up --load-images
```

产物位于 `deploy/images/`，全部带 `ai-water-env-` 前缀。

## 演示数据（可选）

```powershell
# 生成一条演示预警
python deploy/seed_demo_alert.py

# 跑完整端到端链路：数据摄入 → 规则触发 → 智能体分析 → 应急预案
python deploy/run_demo_flow.py
```

## 服务端口

| 组件 | 端口 | 账号 |
|---|---|---|
| PostgreSQL | 5432 | water / water123 / water_env |
| TDengine | 6041 (REST) / 6030 (Native) | root / taosdata |
| Neo4j | 7474 (UI) / 7687 (Bolt) | neo4j / water123 |
| EMQX | 1883 (MQTT) / 18083 (Dashboard) | 匿名 |
| MinIO | 9000 (API) / 9001 (UI) | water / water12345 |

## 停止 / 清空

```powershell
docker compose down          # 停止，保留数据
docker compose down -v       # 停止并清空所有数据（下次启动重新初始化）
```

## 常见问题

| 问题 | 解决 |
|---|---|
| neo4j 驱动缺失 | `pip install neo4j==5.14.0` |
| Neo4j 连接被拒 | `docker ps` 确认容器 healthy |
| TDengine 端口冲突 | `--tdengine-url http://localhost:16041` |
| Windows asyncpg 报错 | 后端入口需设置 `WindowsSelectorEventLoopPolicy` |
