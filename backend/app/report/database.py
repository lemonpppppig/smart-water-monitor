"""
数据库连接管理
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from app.report.config import settings
from app.report.models import Base

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
    """初始化数据库表（含幂等列补齐，兼容老库）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 幂等补列：历史老库可能缺失的列
    import logging
    logger = logging.getLogger(__name__)
    ddl_statements = [
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_name VARCHAR(256)",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS station_id UUID",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS content JSON",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS file_path VARCHAR(512)",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS file_format VARCHAR(16)",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS file_size INTEGER",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(16)",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS error_message TEXT",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
        "ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
        # report_templates 表的安全补列
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS content_structure JSON",
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS is_default VARCHAR(16) DEFAULT 'false'",
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS is_enabled VARCHAR(16) DEFAULT 'true'",
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
        "ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
        # scheduled_reports 表的安全补列
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS station_ids JSON",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS cron_expression VARCHAR(64)",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS recipients JSON",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS is_enabled VARCHAR(16) DEFAULT 'true'",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
        "ALTER TABLE scheduled_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
    ]
    try:
        from sqlalchemy import text
        async with engine.begin() as conn:
            for stmt in ddl_statements:
                try:
                    await conn.execute(text(stmt))
                except Exception as inner_exc:
                    logger.warning(f"[report] DDL skipped: {stmt} -> {inner_exc}")
    except Exception as exc:
        logger.warning(f"[report] idempotent ALTER failed: {exc}")
