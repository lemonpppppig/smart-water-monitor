# regions/ — 多区域数据骨架

本目录存放所有**按城市隔离**的数据资源：地图素材、数据库种子、AI 模型、OSM 原始切片等。
代码层（`backend/` / `frontend/` / `scripts/` / `deploy/`）保持一份，通过 `REGION_CODE` / `VITE_REGION` 环境变量在运行时选择当前激活的城市。

> 目标：**同一份代码 + 三份数据 = 三份独立交付物**。

## 目录结构

```
regions/
├── _common/                 # 跨城市的通用模板（不随 region 挂载）
│   └── db/postgres/         # 通用 PG 脚本（schema、字典表等）
├── ganzhou/                 # 赣州（参考实现，已完成）
│   ├── region.config.json   # ★ 区域元数据（边界、中心、文件名、站点数）
│   ├── map/                 # ★ 前端 3D 地图资产
│   │   ├── normal_map.png   #   法线贴图（尺寸需与 normalMapBounds 对齐）
│   │   ├── rivers.json      #   河网 GeoJSON（由 scripts/extract-rivers.mjs 生成）
│   │   └── roads.json       #   路网 GeoJSON（由 scripts/extract-roads.mjs 生成）
│   ├── osm/                 #   OSM 原始切片（*.osm / *.osm.pbf，仅开发用）
│   ├── db/
│   │   ├── postgres/        # ★ PG initdb.d 入口脚本（01_schema ~ 10_seed）
│   │   ├── neo4j/           # ★ 6 个 Cypher 种子
│   │   └── tdengine/        #   stations.json（由种子脚本读取）
│   └── ml_models/           # ★ LSTM AutoEncoder 权重（*.pt + *_meta.json）
├── hefei/                   # 合肥（占位，待交付人填充）
│   └── ...
└── nanchang/                # 南昌（占位，待交付人填充）
    └── ...
```

★ 标记为**必填**资产，缺失将导致前后端启动失败或地图空白。

## 代码层如何消费 regions/

| 层 | 入口 | 消费方式 |
|---|---|---|
| 前端 Vite | `frontend/vite.config.ts` | 读 `VITE_REGION` → alias `@region` 指向 `regions/<code>/`、`@region-map` 指向 `regions/<code>/map/` |
| 前端地图 | `frontend/src/pages/Map/map/base.tsx` | `import regionConfig from "@region/region.config.json"` 获取 `osmBounds` / `normalMapBounds` / `center` |
| 前端贴图 | `base.tsx` / `river.tsx` / `roads.tsx` | `import data from "@region-map/normal_map.png"`（文件名固定为 `normal_map.png` / `rivers.json` / `roads.json`）|
| 后端 | `backend/.env` | `REGION_CODE=<code>` / `MODEL_PATH=.../regions/<code>/ml_models` |
| Docker | 根 `docker-compose.yml` | `./regions/${REGION_CODE:-ganzhou}/db/postgres:/docker-entrypoint-initdb.d` |
| Neo4j 种子 | `deploy/init_neo4j.py --region <code>` | 读 `regions/<code>/db/neo4j/*.cypher` |
| TDengine 种子 | `scripts/seed_tdengine.py --region <code>` | 读 `regions/<code>/db/tdengine/stations.json` |
| OSM 提取 | `scripts/extract-{rivers,roads}.mjs --region <code>` | 输入 `regions/<code>/osm/*.osm`，输出到 `regions/<code>/map/` |

> **强隔离规则**：前后端运行时禁止硬编码城市名、坐标或文件名。所有区域化参数必须通过 `region.config.json` 或环境变量传入。

## 切换激活区域

### 本地开发（Windows PowerShell）

```powershell
# 1. 设置后端环境变量（backend/.env）
REGION_CODE=hefei
MODEL_PATH=D:/code/racing_project/ai-water-env/regions/hefei/ml_models

# 2. 设置前端环境变量（frontend/.env.development）
VITE_REGION=hefei

# 3. 改 frontend/tsconfig.app.json 中 paths，把 ganzhou 替换为 hefei
#    （TS Language Server 不支持动态 paths，必须写死）

# 4. 清理旧区域的 PG 卷（切换区域需重建数据库）
docker compose down -v

# 5. 一键初始化合肥数据
python deploy/init_all.py --region hefei --up

# 6. 启动前后端
cd backend;  python -m uvicorn app.main:app --port 8000 --reload
cd frontend; npm run dev
```

### 独立交付给客户（三人各自产出）

三份项目作为**独立交付物**给不同客户。交付前每人各自在自己的分支上：

1. 确认 `backend/.env`、`frontend/.env.development`、`frontend/.env.production`、`frontend/tsconfig.app.json` 中的 region 值正确
2. 物理删除其他两个城市的目录：`rm -rf regions/ganzhou regions/hefei`（留下自己的 + `_common/`）
3. 删除 `regions/_common` 以外的无关文件，打 zip

交付物中不含其他客户数据，满足数据隔离合规要求。

## 新增城市完整作业手册（★ 重点）

假设要新增 `xiamen`（厦门）：

### 步骤 1：搭骨架（5 分钟）

```powershell
# 1.1 创建目录
mkdir regions/xiamen
mkdir regions/xiamen/map
mkdir regions/xiamen/osm
mkdir regions/xiamen/db/postgres
mkdir regions/xiamen/db/neo4j
mkdir regions/xiamen/db/tdengine
mkdir regions/xiamen/ml_models

# 1.2 拷贝占位配置
Copy-Item regions/ganzhou/region.config.json regions/xiamen/region.config.json
```

### 步骤 2：编写 `regions/xiamen/region.config.json`

| 字段 | 含义 | 获取方式 |
|---|---|---|
| `code` | 城市编码（英文小写） | 与目录名一致 |
| `displayName` | 前端显示名 | 手填 |
| `fullName` | 区域全称 | 手填，如「厦门市九龙江流域」 |
| `osmBounds` | OSM 切片边界（纬度/经度） | 从 OpenStreetMap Export 页面框选后读取 |
| `normalMapBounds` | 法线贴图覆盖的地理边界 | 应**比 osmBounds 略大**（外扩 1-2°），保证地形无黑边 |
| `center` | 前端默认相机朝向点 | `[lon, lat]`，取市中心即可 |
| `normalMapFile` | 固定写 `normal_map.png` | 静态 import 限制，不能改 |
| `riversFile` | 固定写 `rivers.json` | 同上 |
| `roadsFile` | 固定写 `roads.json` | 同上 |
| `stationCountHint` | 预计站点数量（仅作 UI 提示） | 业务给出即可 |

**完整样例**见 [ganzhou/region.config.json](./ganzhou/region.config.json) 与 [hefei/region.config.json](./hefei/region.config.json)。

### 步骤 3：准备地图资产（1-2 天）

```powershell
# 3.1 把 OSM 原始切片放到 regions/xiamen/osm/xiamen.osm
#     方法 A：OpenStreetMap Export 下载
#     方法 B：Overpass Turbo 查询导出
#     方法 C：geofabrik.de 按省下载 *.osm.pbf 后切片

# 3.2 提取河网 / 路网（在项目根目录执行）
node scripts/extract-rivers.mjs --region xiamen
node scripts/extract-roads.mjs --region xiamen
#   产物：regions/xiamen/map/rivers.json, roads.json

# 3.3 生成法线贴图 normal_map.png
#     - 分辨率建议 4096×4096 或 8192×8192
#     - 覆盖范围严格按 region.config.json 中的 normalMapBounds
#     - 工具：QGIS + DEM 数据（30m 精度的 ALOS / SRTM）
#     - 参考 ganzhou/map/normal_map.png 的色域风格
#     产物：regions/xiamen/map/normal_map.png
```

### 步骤 4：准备数据库种子（2-3 天）

#### 4.1 PostgreSQL 种子

```powershell
# 从 ganzhou 拷贝 10 个初始化文件做模板
Copy-Item regions/ganzhou/db/postgres/*.sql regions/xiamen/db/postgres/
```

需要按城市修改的文件（约 5 个）：

| 文件 | 改什么 |
|---|---|
| `05_seed_stations.sql` | 站点清单（station_code、lat/lon、河流归属） |
| `06_seed_rivers.sql` | 河流干支清单 |
| `07_seed_pollution_sources.sql` | 污染源点位与行业类别 |
| `08_seed_administrative.sql` | 行政区划（街道/乡镇边界） |
| `09_seed_metrics_baseline.sql` | 指标基线（氨氮、COD 等上下限，按流域水质目标） |

**纯 schema 类脚本（01/02/03/04/10）通常无需改动**。

#### 4.2 Neo4j 种子

```powershell
Copy-Item regions/ganzhou/db/neo4j/*.cypher regions/xiamen/db/neo4j/
```

6 个 Cypher 都需要按城市数据改写，参考 [ganzhou/db/neo4j/](./ganzhou/db/neo4j/)。
**建议**：保留 `01_knowledge_graph.cypher` 的 schema/约束部分不动，只改具体实例（站点、河流、污染源、事件）。

#### 4.3 TDengine stations.json

```json
// regions/xiamen/db/tdengine/stations.json
[
  {
    "station_code": "ST_XM_001",
    "station_name": "九龙江北溪断面",
    "latitude": 24.75,
    "longitude": 117.68,
    "river_code": "R001"
  }
  // ... 更多站点
]
```

`scripts/seed_tdengine.py --region xiamen` 会自动读取此文件，90 天仿真时序由脚本内置的高斯随机游走生成。

### 步骤 5：AI 模型（可选，1 天）

如果该城市需要站点级 LSTM AutoEncoder：

```powershell
# 训练（在 backend/.venv 中执行）
python backend/app/ai/training.py --region xiamen --station ST_XM_001

# 训练产物会自动落到 regions/xiamen/ml_models/
#   ST_XM_001_station_lstm.pt
#   ST_XM_001_station_meta.json
```

无 AI 模型时后端会降级为规则告警（3σ 法），功能不受阻。

### 步骤 6：接入 & 自测

```powershell
# 6.1 修改 backend/.env
REGION_CODE=xiamen
MODEL_PATH=D:/code/racing_project/ai-water-env/regions/xiamen/ml_models

# 6.2 修改 frontend/.env.development 与 .env.production
VITE_REGION=xiamen

# 6.3 修改 frontend/tsconfig.app.json，把 ganzhou 替换为 xiamen

# 6.4 重建基础设施 + 数据
docker compose down -v
python deploy/init_all.py --region xiamen --up

# 6.5 启动前后端验收
cd backend;  python -m uvicorn app.main:app --port 8000 --reload
cd frontend; npm run dev
```

### 步骤 7：验收清单

| # | 项目 | 通过标准 |
|---|---|---|
| 1 | 3D 地图 | 地形贴图覆盖目标城市，无黑边 / UV 错位 |
| 2 | 河网 / 路网 | 河流支流可见、路网密度符合预期 |
| 3 | 站点列表 API | `GET /stations` 返回数量与 `stationCountHint` 一致 |
| 4 | 站点时序 | 任选一个站点查看 7 天趋势，数据连续无断点 |
| 5 | 溯源 | 任选一次告警跑溯源，图谱返回污染源候选 |
| 6 | 扩散预测 | 扩散模拟返回下游影响范围，覆盖真实河段 |
| 7 | 告警规则 | 伪造一次超标数据，规则告警触发 |
| 8 | AI 模型（可选） | 有训练产物时，异常检测 p 值 < 0.01 触发 |

## 三人分工建议（当前交付）

| 分支 | 负责人 | 交付目标 | 当前状态 |
|---|---|---|---|
| `main` / `region/ganzhou` | 你 | 赣州（参考实现） | ✅ 已完成 |
| `region/hefei` | 合肥交付人 | 合肥巢湖流域 | 🟡 骨架已就位，待填充地图/DB/模型 |
| `region/nanchang` | 南昌交付人 | 南昌赣江下游段 | 🟡 骨架已就位，待填充地图/DB/模型 |

每人独立在自己的分支上按上文「新增城市完整作业手册」推进，交付前执行：

```powershell
# 只保留自己城市 + _common
git rm -rf regions/ganzhou regions/nanchang   # 合肥交付人示例
# 检查 docker-compose / .env / tsconfig 是否还有其他城市引用
git grep -l "ganzhou\|nanchang"
# 清理后打 zip 交付
```

## 常见问题

| 症状 | 解决 |
|---|---|
| 前端地图空白 / 贴图歪 | 检查 `normalMapBounds` 是否覆盖 `osmBounds` 且比例正确 |
| `@region` 解析失败 | 清理 `frontend/node_modules/.vite` 后 `npm run dev` 重启 |
| PG 启动报 `duplicate schema` | `docker compose down -v` 后重跑，`initdb.d` 只在空卷时执行 |
| Neo4j 种子报冲突 | `python deploy/init_neo4j.py --region <code> --force` 清空重导 |
| TDengine 没数据 | 确认 `regions/<code>/db/tdengine/stations.json` 存在且格式正确 |
| 切换区域后前端仍显示旧城市 | 同时检查 `.env.development`、`.env.production`、`tsconfig.app.json` 三处 |

## 相关文档

- [deploy/README.md](../deploy/README.md) — 部署脚本使用
- [frontend/vite.config.ts](../frontend/vite.config.ts) — region alias 解析逻辑
- [scripts/seed_tdengine.py](../scripts/seed_tdengine.py) — TDengine 种子生成器
- [scripts/extract-rivers.mjs](../scripts/extract-rivers.mjs) / [extract-roads.mjs](../scripts/extract-roads.mjs) — OSM 提取器
