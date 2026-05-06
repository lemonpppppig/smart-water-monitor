"""
数据模块 - 数据库连接管理
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.data.config import settings
from app.data.models.db_models import Base

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

# 异步会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db():
    """获取数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """初始化数据库表"""
    import logging
    from sqlalchemy import text
    logger = logging.getLogger(__name__)

    # 1. 建表（已存在的跳过）
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 2. 独立事务为老表追加 module_keys 列，避免把 create_all 拖下水；
    #    成功/失败都打 log，便于线上排查
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE mqtt_connections ADD COLUMN IF NOT EXISTS module_keys VARCHAR(128) DEFAULT ''"
            ))
        logger.info("[data] mqtt_connections.module_keys 列已就绪（原已存在则无变动）")
    except Exception as e:
        logger.warning(
            "[data] 无法为 mqtt_connections 补加 module_keys 列（将按旧表结构运行，模块绑定会失效）：%s", e
        )
