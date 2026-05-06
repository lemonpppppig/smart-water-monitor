# Smart Water Monitor — 智慧水环境 AI 监测平台

流域级水环境智能监测与预警系统，集成多源数据采集、时序分析、知识图谱推理和 AI 多智能体决策。

## 功能概览

| 模块 | 说明 |
|---|---|
| 3D 态势大屏 | Three.js 流域地图 + 实时水质热力图 |
| 站点管理 | 监测站 CRUD、MQTT 设备接入绑定 |
| 实时数据 | TDengine 时序存储、10 分钟级自动采集 |
| 预警中心 | 规则引擎触发 + AI 异常检测双通道 |
| AI 智能体 | 多 Agent 协作：监测→分析→溯源→决策→输出 |
| 知识图谱 | Neo4j 河流拓扑 / 污染源 / 监测站关系网络 |
| 水质预测 | LSTM 时序预测模型，支持多站点 |
| 应急处置 | 污染事件全流程跟踪与预案生成 |
| 知识文档库 | 法规标准 / 技术文档 Markdown 展示 |
| 报告生成 | 自动生成水质监测报告 |

## 技术栈

**前端**：React 19 + TypeScript + Vite + TailwindCSS + Three.js + Ant Design + ECharts

**后端**：FastAPI (Python 3.11) — 单体架构合并 5 个服务模块（station / data / alert / ai / report）

**数据层**：
- PostgreSQL (PostGIS + pgvector) — 业务主库
- TDengine 3.x — 时序数据
- Neo4j 5.x — 知识图谱
- EMQX 5.x — MQTT 消息中间件
- MinIO — 对象存储

## 项目结构

```
├── frontend/          # React 前端
├── backend/           # FastAPI 后端
│   └── app/
│       ├── station/   # 站点管理
│       ├── data/      # 数据采集与时序存储
│       ├── alert/     # 预警服务
│       ├── ai/        # AI 智能体 + 知识引擎
│       ├── report/    # 报告生成
│       └── notification/ # 通知推送
├── regions/           # 多城市区域数据（SQL/Cypher/配置）
├── deploy/            # 部署与初始化脚本
├── infrastructure/    # Docker 构建文件
├── scripts/           # 工具脚本
└── docker-compose.yml # 基础设施编排
```

## 快速开始

### 前置要求

- Docker Desktop
- Python 3.11 + uv
- Node.js 18+

### 一键启动

```powershell
# 1. 启动基础设施 + 初始化数据库（PostgreSQL / Neo4j / TDengine）
python deploy/init_all.py --up --region nanchang

# 2. 启动后端
cd backend
python run.py

# 3. 启动前端
cd frontend
npm install
npm run dev
```

前端默认 http://localhost:5173 ，后端 API http://localhost:8000/docs

## 多城市交付

项目支持按城市独立交付（赣州/合肥/南昌），通过 `regions/` 目录管理各城市的数据和配置：

```powershell
# 打包南昌交付物（含离线镜像）
.\deploy\pack-region.ps1 -Region nanchang -IncludeImages
```

详见 [deploy/README.md](deploy/README.md)

## 服务端口

| 组件 | 端口 | 默认账号 |
|---|---|---|
| 前端 | 5173 | — |
| 后端 API | 8000 | — |
| PostgreSQL | 5432 | water / water123 |
| TDengine | 6041 (REST) | root / taosdata |
| Neo4j | 7474 / 7687 | neo4j / water123 |
| EMQX | 1883 / 18083 | 匿名 |
| MinIO | 9000 / 9001 | water / water12345 |

## License

Private — All rights reserved.
