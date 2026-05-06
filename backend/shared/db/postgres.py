"""
PostgreSQL数据库连接封装
使用SQLAlchemy 2.0异步模式
"""
from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
import os

# 数据库配置（优先读 env，缺省 fallback 到本地 docker-compose 依赖的默认端口）
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://water:water123@localhost:5432/water_env",
)

# 创建异步引擎
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
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

# 声明基类
Base = declarative_base()


class PostgresDB:
    """PostgreSQL数据库管理类"""
    
    def __init__(self):
        self.engine = engine
        self.session_factory = AsyncSessionLocal
    
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取数据库会话（上下文管理器）"""
        async with self.session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
    
    async def check_connection(self) -> bool:
        """检查数据库连接"""
        try:
            async with self.session_factory() as session:
                result = await session.execute(text("SELECT 1"))
                return result.scalar() == 1
        except Exception:
            return False
    
    async def close(self):
        """关闭数据库连接"""
        await self.engine.dispose()


# 全局数据库实例
_postgres_db: Optional[PostgresDB] = None


def get_postgres_db() -> PostgresDB:
    """获取PostgreSQL数据库实例（单例）"""
    global _postgres_db
    if _postgres_db is None:
        _postgres_db = PostgresDB()
    return _postgres_db


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI依赖：获取数据库会话"""
    db = get_postgres_db()
    async for session in db.get_session():
        yield session
