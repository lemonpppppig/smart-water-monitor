"""
数据库连接管理
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from app.station.config import settings
from app.station.models import Base

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
    async with engine.begin() as conn:
        # 注意：生产环境不要使用drop_all
        # await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # 幂等补充列（软删除字段，旧表升级用）
    try:
        from sqlalchemy import text
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE stations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"
            ))
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning(f"[station] add deleted_at column failed: {exc}")

    # 写入指标目录默认值
    try:
        from app.station.services import MetricCatalogService
        async with AsyncSessionLocal() as session:
            await MetricCatalogService.bootstrap_defaults(session)
            await session.commit()
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning(f"[station] bootstrap metric catalog failed: {exc}")
