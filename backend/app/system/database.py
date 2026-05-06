"""数据库连接管理 - System（与 notification/alert 模式一致）"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.system.config import settings
from app.system.models import Base

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db():
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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 初始化内置角色/用户
    try:
        from app.system.services import bootstrap_defaults
        async with AsyncSessionLocal() as session:
            await bootstrap_defaults(session)
            await session.commit()
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning(f"[system] bootstrap defaults failed: {exc}")
