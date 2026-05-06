# 四栈版 PPT 讲解规划 · 总览

> 本 PPT 围绕「流域水环境 AI 智能监测与预警平台」按**四大技术栈维度**组织：硬件采集与传输 → 后端服务与数据层 → 前端可视化 → AI 智能分析。每部分 5 页，内容聚焦**设计 / 架构 / 技术细节 / 算法原理 / 协议规范**，不含代码、不做价值总结、不做指标对比。

---

## 1. 呈现顺序与主线

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         技术栈讲解主线（先硬后软）                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   [A 硬件]  ──→  [B 后端]  ──→  [C 前端]  ──→  [D AI]                         │
│   物理感知       数据接入        人机交互        智能决策                      │
│     │              │                │               │                        │
│     │              │                │               │                        │
│   传感器           单体服务         可视化           引擎 + 智能体             │
│   主控芯片         多模数据库       三维地图         LSTM / 图 / 知识          │
│   Modbus+MQTT      MQTT 订阅        ECharts         三层知识推理               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
   物理世界 ────→ 数据世界 ────→ 展示世界 ────→ 智能世界
```

**叙事脉络**：
- **Part A**：水环境现场如何把物理量变成可校验的数字帧上云
- **Part B**：帧进入系统后如何被接纳、清洗、分流落库
- **Part C**：数据如何在大屏与管理台被人看见、被人操作
- **Part D**：数据如何被 AI 理解、关联并输出可执行的处置建议

---

## 2. 页面索引

| Part | 页码 | 标题 | 核心关键词 |
|------|------|------|-----------|
| **A 硬件采集与传输** | A-P1 | 场景差异与感知需求 | 四类场景 · 指标清单 · 采样差异 |
| | A-P2 | 水质传感器矩阵与测量原理 | 常规五参数 · 营养盐 · 有机物 · 藻类 |
| | A-P3 | 主控选型与现场总线接口 | STM32F407VET6 · RS485 · Modbus-RTU |
| | A-P4 | 远程通信方案与可靠性工程保障 | 4G/NB/LoRa · 双通道 · OTA · IP68 |
| | A-P5 | 数据校验与 MQTT 上行协议 | CRC16-MODBUS · MQTT · 自定义 JSON |
| **B 后端服务与数据层** | B-P1 | 模块化单体架构与模块边界 | 单体 vs 微服务 · 五大模块 · 共享层 |
| | B-P2 | 单体运行时与数据接入层 | Lifespan · APIRouter · paho-mqtt |
| | B-P3 | DataProcessor 预处理管道 | 验证 · IsolationForest · DO/TLI/WQI |
| | B-P4 | 多模数据库选型与三库职责 | TDengine · PostGIS+pgvector · Neo4j |
| | B-P5 | 应用入口、跨域与反向代理 | 8000 单进程 · CORS · Vite/Nginx |
| **C 前端可视化** | C-P1 | 前端架构与技术栈 | React 19 · Vite 8 · AntD + Tailwind |
| | C-P2 | 状态管理与数据通信 | Zustand · Axios · MQTT.js |
| | C-P3 | 可视化体系（ECharts） | 图表矩阵 · 增量渲染 · LTTB |
| | C-P4 | 地理信息与三维渲染（Three.js） | 四图层 · Mercator · 相机联动 |
| | C-P5 | 路由权限、工程化与交互规范 | Lazy · manualChunks · 四级预警色 |
| **D AI 智能分析** | D-P1 | 智能体与三引擎总架构 | 大脑 vs 工具 · 主动/被动 · 闭环 |
| | D-P2 | 时序引擎：阈值 + LSTM 自编码器 | 阈值 · LSTM(2×64) · 重建误差 |
| | D-P3 | 图计算引擎：溯源三步 + 下游影响 | FLOWS_TO · 反向三步 · 四级预警 |
| | D-P4 | 知识推理引擎：规则 + 案例 + 预案 | 48 规则 · 16 维向量 · 12 预案 |
| | D-P5 | 智能体编排：双输出 + Tool Calling | LLM · Tools · Machine/Human |

合计 **20 页**（4 × 5）。

---

## 3. 各部分串场衔接话术

### 开场 → Part A 硬件
> 「流域水环境平台的起点不在算法、不在大屏，而在江河边那一个个传感器箱。我们先看物理世界：传感器怎么选、数据怎么采、帧怎么校验、怎么上云。」

### Part A → Part B 后端
> 「当一条带 CRC16 校验位的 Modbus 帧在现场被拼装、经 MCU 转成 MQTT JSON 直推 EMQX 之后，它接下来的旅程就交给后端。我们进入第二部分：这条报文是如何被接纳、清洗、分流到三个不同形态的数据库的。」

### Part B → Part C 前端
> 「后端把数据分别沉到了时序库、关系+空间+向量库和图库。但数据沉下去不是终点，要让调度值班员一眼看得见、点得动。下面进入前端：我们是怎么把三类异构数据组织进一套可视化体系的。」

### Part C → Part D AI
> 「到这里，我们已经完成了一条**数据驱动**的链路：采集 → 接入 → 可视化。但光看得见还不够——能不能让系统自己发现问题、追到源头、给出处置建议？这就是最后一部分 AI 要解决的三件事。」

### Part D → 结尾
> 「三大引擎 + 智能体编排，把数据驱动升级成决策驱动。异常被时序引擎发现、被图计算引擎追溯、被知识推理引擎匹配预案，再由智能体统一输出给下游系统和现场人员。——这就是四栈之上，水环境平台的完整技术闭环。」

---

## 4. 讲解风格与排版约定

- **每页 PPT** 遵循统一结构：页眉页码 → 主标题 → ASCII 布局示意 → 讲稿要点（3~6 条） → 下一页过渡句
- **不出现代码段**：若需呈现数据结构，使用自然语言或字段列表
- **不做价值总结**：每页结束以「技术事实」收尾，不说「提升了多少 / 节省了多少」
- **技术细节优先**：凡能给出参数、版本号、阈值、数据类型的地方，都给具体值
- **四级预警色**统一：critical=红 / high=橙 / medium=黄 / low=绿，跨 Part 保持一致

---

## 5. 技术名词对照表（主持人串场用）

| 术语 | 英文 / 缩写 | 出现在 | 一句话释义 |
|------|------------|--------|-----------|
| Modbus-RTU | — | A-P3 / A-P5 | 串行总线主从协议，本项目跑在 RS485 上挂多传感器 |
| CRC16-MODBUS | — | A-P5 | 多项式 0xA001、初值 0xFFFF 的循环冗余校验 |
| HJ212 | — | A-P5 | 环保行业报文协议；**本项目未使用**，仅作对比口径 |
| STM32F407VET6 | — | A-P3 | 本项目主控芯片，Cortex-M4F @168MHz、LQFP-100 |
| IWDG | Independent Watchdog | A-P3 / A-P4 | STM32 独立看门狗，防 MCU 死锁的兜底 |
| MQTT | Message Queuing Telemetry Transport | A-P5 / B-P2 / B-P5 | 物联网轻量发布订阅协议 |
| QoS 0/1/2 | Quality of Service | A-P5 | MQTT 三档消息投递可靠性：最多一次 / 至少一次 / 恰好一次 |
| EMQX | — | A-P5 / B-P2 / B-P5 | 本项目使用的 MQTT Broker |
| 模块化单体 | Modular Monolith | B-P1 | 单一进程按业务域划分模块的架构范式 |
| FastAPI Lifespan | — | B-P2 | FastAPI 应用启动/关闭统一钩子 |
| paho-mqtt | — | B-P2 | Python MQTT 客户端库，本项目后端订阅所用 |
| IsolationForest | — | B-P3 | 基于随机树隔离路径深度的无监督异常检测算法 |
| DO 饱和度 | Dissolved Oxygen Saturation | B-P3 | 按 Henry 定律用温盐压补偿的氧饱和度 |
| TLI | Trophic Level Index | B-P3 | 富营养化指数，TN/TP/Chla 综合 |
| WQI | Water Quality Index | B-P3 | 综合水质标识指数 |
| TDengine | — | B-P4 | 时序数据库，本项目承载水质时序 |
| PostGIS | — | B-P4 | PostgreSQL 空间扩展，提供 geography + GiST |
| pgvector | — | B-P4 / D-P4 | PostgreSQL 向量扩展，承载 16 维案例向量 |
| IVFFlat | Inverted File with Flat quantizer | B-P4 / D-P4 | 近似最近邻索引算法，lists/probes 调精度性能 |
| Neo4j | — | B-P4 / D-P3 / D-P4 | 图数据库，承载流域拓扑与知识图谱 |
| CORS | Cross-Origin Resource Sharing | B-P5 / C-P5 | 浏览器跨域资源共享策略 |
| Vite | — | C-P1 / C-P5 | 前端构建工具，本项目版本 8 |
| Zustand | — | C-P2 | 轻量 React 状态管理库 |
| ECharts | — | C-P3 | Apache 开源图表库，本项目版本 6 |
| LTTB | Largest-Triangle-Three-Buckets | C-P3 | 保形态的时序降采样算法 |
| Three.js | — | C-P4 | WebGL 三维图形库 |
| Mercator 投影 | — | C-P4 | 把经纬度映射为平面坐标的常用投影 |
| Raycaster | — | C-P4 | Three.js 射线检测器，用于命中三维场景物体 |
| React.lazy | — | C-P5 | React 的路由级代码懒加载 |
| manualChunks | — | C-P5 | Vite/Rollup 打包分块策略 |
| LSTM | Long Short-Term Memory | D-P2 | 长短期记忆循环神经网络 |
| 自编码器 | Autoencoder | D-P2 | 编码器-解码器结构，学习正常模式低维表示 |
| MSE | Mean Squared Error | D-P2 | 均方误差，自编码器重建损失 |
| FLOWS_TO | — | D-P3 | Neo4j 关系类型，表达水流上下游 |
| Cypher | — | D-P3 / D-P4 | Neo4j 声明式图查询语言 |
| Tool Calling / Function Calling | — | D-P5 | LLM 调用外部工具的协议范式 |
| Machine / Human 双输出 | — | D-P5 | 智能体同时产出结构化 JSON 与自然语言 |

---

## 6. 与「技术部分 PPT」复用关系

Part D 的内部结构大量复用原 `技术部分PPT.md`：

| 本 PPT 页 | 复用原 PPT 页 |
|-----------|--------------|
| D-P1 总架构 | P1.6 |
| D-P2 LSTM 结构图 | P2.2 + P2.2.1 |
| D-P3 图计算 | P3.2 + P3.3 + P3.4 |
| D-P4 规则加权 + 案例向量 + 预案匹配 | P4.2 + P4.3 + P4.4 |
| D-P5 双输出 + Tool Calling | P2.3 |

Part A / B / C 为全新章节，无复用。
