"""
水环境AI智能监测与预警平台 - 单体后端
合并 gateway + station / data / alert / ai / report 五个服务
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import logging

from app.config import settings

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理 - 合并所有服务的初始化与清理"""
    logger.info(f"Starting {settings.SERVICE_NAME}...")

    # ---------- Station: 初始化数据库 ----------
    try:
        from app.station.database import init_db as station_init_db
        await station_init_db()
        logger.info("[station] Database initialized")
    except Exception as e:
        logger.error(f"[station] Database init failed: {e}")

    # ---------- Alert: 初始化数据库 ----------
    try:
        from app.alert.database import init_db as alert_init_db
        await alert_init_db()
        logger.info("[alert] Database initialized")
    except Exception as e:
        logger.error(f"[alert] Database init failed: {e}")

    # ---------- Report: 初始化数据库 ----------
    try:
        from app.report.database import init_db as report_init_db
        await report_init_db()
        logger.info("[report] Database initialized")
    except Exception as e:
        logger.error(f"[report] Database init failed: {e}")

    # ---------- Notification: 初始化数据库 ----------
    try:
        from app.notification.database import init_db as notification_init_db
        await notification_init_db()
        logger.info("[notification] Database initialized")
    except Exception as e:
        logger.error(f"[notification] Database init failed: {e}")

    # ---------- System: 初始化数据库（用户/角色/日志）+ 内置角色/admin ----------
    try:
        from app.system.database import init_db as system_init_db
        await system_init_db()
        logger.info("[system] Database initialized (roles/users/logs)")
    except Exception as e:
        logger.error(f"[system] Database init failed: {e}")

    # ---------- Data: 初始化数据库 + 加载 MQTT 连接配置 ----------
    try:
        from app.data.database import init_db as data_init_db, AsyncSessionLocal as data_session_factory
        await data_init_db()
        logger.info("[data] Database initialized")

        # 从数据库加载已有的 MQTT 连接配置到内存缓存
        from app.data.models.mqtt_connection import get_connection_store
        mqtt_store = get_connection_store()
        async with data_session_factory() as session:
            await mqtt_store.load_from_db(session)
    except Exception as e:
        logger.error(f"[data] Database init failed: {e}")

    # ---------- Data: 启动 MQTT 订阅者 ----------
    ingestion = None
    try:
        from app.data.core.ingestion import get_ingestion_service
        ingestion = get_ingestion_service()
        ingestion.start_mqtt_subscriber()
        logger.info("[data] MQTT subscriber started")

        # 自动恢复已保存的外部 MQTT 连接订阅（延迟 + 并发 + DNS 预探，不阻塞 startup）
        from app.data.models.mqtt_connection import get_connection_store, ConnectionStatus
        mqtt_store = get_connection_store()
        saved_conns = mqtt_store.get_all()
        if saved_conns:
            logger.info(
                f"[data] 将在 startup 后后台恢复 {len(saved_conns)} 个 MQTT 连接（2s 后启动）"
            )

            async def _probe_and_connect(conn):
                """单个连接恢复：先 DNS 预探（2s），给过再走 paho connect。"""
                import socket
                loop = asyncio.get_running_loop()
                host = conn.broker_host
                port = int(conn.broker_port or 1883)
                try:
                    # DNS + TCP 快速探测，超时 2s
                    await asyncio.wait_for(
                        loop.getaddrinfo(host, port, type=socket.SOCK_STREAM),
                        timeout=2.0,
                    )
                except Exception as e:
                    mqtt_store.update_status(conn.id, ConnectionStatus.ERROR, f"DNS不可达: {e}")
                    logger.warning(f"[data] MQTT 连接 '{conn.name or conn.id}' 跳过 (DNS不可达 {host})")
                    return
                # DNS 通过才真正 connect（connect 自身是同步，用线程池隔离）
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(ingestion.start_external_subscriber, conn),
                        timeout=10.0,
                    )
                    mqtt_store.update_status(conn.id, ConnectionStatus.CONNECTED)
                    logger.info(f"[data] MQTT 连接 '{conn.name or conn.id}' 已自动恢复")
                except Exception as e:
                    mqtt_store.update_status(conn.id, ConnectionStatus.ERROR, str(e))
                    logger.warning(f"[data] MQTT 连接 '{conn.name or conn.id}' 恢复失败: {e}")

            async def _resume_all():
                # 延迟 2s，让 startup 和第一批请求先跑
                await asyncio.sleep(2.0)
                await asyncio.gather(*(_probe_and_connect(c) for c in saved_conns))

            asyncio.create_task(_resume_all())
    except Exception as e:
        logger.warning(f"[data] Failed to start MQTT subscriber: {e}")

    # ---------- AI: 初始化多智能体集群 ----------
    persister = None
    try:
        # 1) 先初始化 AI 任务持久化表
        from app.ai.database import init_db as ai_init_db
        await ai_init_db()
        logger.info("[ai] Database initialized")
    except Exception as e:
        logger.error(f"[ai] Database init failed: {e}")

    try:
        from app.ai.agents.monitor_agent import MonitorAgent
        from app.ai.agents.analysis_agent import AnalysisAgent
        from app.ai.agents.decision_agent import DecisionAgent
        # 复用 api/ai.py 模块级的 coordinator，避免出现两个实例违和
        from app.ai.api.ai import coordinator

        app.state.coordinator = coordinator

        monitor = MonitorAgent(coordinator)
        analysis = AnalysisAgent(coordinator)
        decision = DecisionAgent(coordinator)

        app.state.monitor_agent = monitor
        app.state.analysis_agent = analysis
        app.state.decision_agent = decision

        # 2) 启动后台持久化同步器
        from app.ai.persistence import CoordinatorPersister
        persister = CoordinatorPersister(coordinator, interval=2.0)
        persister.start()
        app.state.ai_persister = persister

        logger.info("[ai] Multi-agent cluster initialized")
    except Exception as e:
        logger.error(f"[ai] Failed to init multi-agent cluster: {e}")

    yield

    # ==================== 关闭清理 ====================
    logger.info(f"Shutting down {settings.SERVICE_NAME}...")

    # Data: 停止 MQTT
    try:
        if ingestion:
            ingestion.stop()
    except Exception as e:
        logger.error(f"[data] Error stopping ingestion: {e}")

    # AI: 停止 Agent
    try:
        if hasattr(app.state, "ai_persister") and app.state.ai_persister:
            await app.state.ai_persister.stop()
        if hasattr(app.state, "monitor_agent"):
            app.state.monitor_agent.stop()
        if hasattr(app.state, "analysis_agent"):
            app.state.analysis_agent.stop()
        if hasattr(app.state, "decision_agent"):
            app.state.decision_agent.stop()
        from app.ai.api.ai import graph_engine
        graph_engine.close()
    except Exception as e:
        logger.error(f"[ai] Error during shutdown: {e}")


# 创建 FastAPI 应用
app = FastAPI(
    title="水环境AI智能监测与预警平台",
    description="站点管理、数据接入、预警分析、AI引擎、报告生成",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 健康检查
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.SERVICE_NAME,
        "version": "1.0.0",
    }


# ==================== 注册所有路由 ====================
from app.station.api.stations import router as stations_router
from app.station.api.metric_catalog import router as metric_catalog_router
from app.station.api.map_features import router as map_features_router
from app.data.api.data import router as data_router
from app.data.api.mqtt import router as mqtt_router
from app.alert.api.alerts import router as alerts_router
from app.ai.api.ai import router as ai_router
from app.ai.api.graph_admin import router as graph_admin_router
from app.ai.api.knowledge_docs import router as knowledge_docs_router
from app.report.api.reports import router as reports_router
from app.notification.api.notifications import router as notifications_router
from app.system.api.auth import router as auth_router
from app.system.api.users import router as users_router
from app.system.api.roles import router as roles_router
from app.system.api.logs import router as logs_router

app.include_router(stations_router, prefix="/api/v1")
app.include_router(metric_catalog_router, prefix="/api/v1")
app.include_router(map_features_router, prefix="/api/v1")
app.include_router(data_router, prefix="/api/v1")
app.include_router(mqtt_router, prefix="/api/v1")
app.include_router(alerts_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(graph_admin_router, prefix="/api/v1")
app.include_router(knowledge_docs_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(roles_router, prefix="/api/v1")
app.include_router(logs_router, prefix="/api/v1")

# ==================== 操作日志中间件 ====================
try:
    from app.system.middleware import OperationLogMiddleware
    app.add_middleware(OperationLogMiddleware)
except Exception as e:
    logger.warning(f"[system] OperationLogMiddleware register failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.SERVICE_PORT)
