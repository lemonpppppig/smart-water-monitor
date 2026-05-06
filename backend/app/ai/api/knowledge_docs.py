"""
知识文档库 API
路由前缀：/api/v1/ai/knowledge-docs
提供文档列表、详情、分类查询等只读接口
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/knowledge-docs", tags=["knowledge-docs"])


# ==================== Schema ====================

class KnowledgeDocSummary(BaseModel):
    """文档列表项（不含正文）"""
    id: str
    doc_code: str
    title: str
    category: str
    sub_category: Optional[str] = None
    summary: Optional[str] = None
    source: Optional[str] = None
    publish_date: Optional[str] = None
    effective_date: Optional[str] = None
    tags: List[str] = []
    sort_order: int = 0


class KnowledgeDocDetail(KnowledgeDocSummary):
    """文档详情（含正文）"""
    content: str


class KnowledgeDocListResponse(BaseModel):
    """文档列表响应"""
    items: List[KnowledgeDocSummary]
    total: int


# ==================== 数据库依赖 ====================

async def _get_pool():
    """获取 asyncpg 连接池"""
    import asyncpg
    from app.ai.config import settings
    dsn = settings.DATABASE_URL.replace("+asyncpg", "")
    return await asyncpg.create_pool(dsn, min_size=1, max_size=5)


_pool = None


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await _get_pool()
    return _pool


# ==================== 接口 ====================

@router.get("", response_model=KnowledgeDocListResponse)
async def list_documents(
    category: Optional[str] = Query(None, description="按分类过滤: regulation/standard/manual/policy"),
    keyword: Optional[str] = Query(None, description="标题/摘要关键字搜索"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    """获取文档列表（不含正文）"""
    pool = await get_pool()
    conditions = ["is_active = true"]
    params = []
    idx = 1

    if category:
        conditions.append(f"category = ${idx}")
        params.append(category)
        idx += 1

    if keyword:
        conditions.append(f"(title ILIKE ${idx} OR summary ILIKE ${idx})")
        params.append(f"%{keyword}%")
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * size

    async with pool.acquire() as conn:
        # 总数
        count_sql = f"SELECT count(*) FROM knowledge_documents WHERE {where}"
        total = await conn.fetchval(count_sql, *params)

        # 列表
        list_sql = f"""
            SELECT id, doc_code, title, category, sub_category, summary,
                   source, publish_date, effective_date, tags, sort_order
            FROM knowledge_documents
            WHERE {where}
            ORDER BY sort_order, publish_date DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        params.extend([size, offset])
        rows = await conn.fetch(list_sql, *params)

    items = [
        KnowledgeDocSummary(
            id=str(r["id"]),
            doc_code=r["doc_code"],
            title=r["title"],
            category=r["category"],
            sub_category=r["sub_category"],
            summary=r["summary"],
            source=r["source"],
            publish_date=r["publish_date"].isoformat() if r["publish_date"] else None,
            effective_date=r["effective_date"].isoformat() if r["effective_date"] else None,
            tags=r["tags"] or [],
            sort_order=r["sort_order"] or 0,
        )
        for r in rows
    ]
    return KnowledgeDocListResponse(items=items, total=total)


@router.get("/categories")
async def list_categories():
    """获取所有文档分类及数量"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT category, count(*) as cnt
            FROM knowledge_documents
            WHERE is_active = true
            GROUP BY category
            ORDER BY cnt DESC
        """)
    return {
        "categories": [{"category": r["category"], "count": r["cnt"]} for r in rows]
    }


@router.get("/{doc_id}", response_model=KnowledgeDocDetail)
async def get_document(doc_id: str):
    """获取文档详情（含正文 Markdown）"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # 支持按 UUID 或 doc_code 查询
        row = await conn.fetchrow("""
            SELECT id, doc_code, title, category, sub_category, summary,
                   content, source, publish_date, effective_date, tags, sort_order
            FROM knowledge_documents
            WHERE (id::text = $1 OR doc_code = $1) AND is_active = true
        """, doc_id)

    if not row:
        raise HTTPException(status_code=404, detail="文档不存在")

    return KnowledgeDocDetail(
        id=str(row["id"]),
        doc_code=row["doc_code"],
        title=row["title"],
        category=row["category"],
        sub_category=row["sub_category"],
        summary=row["summary"],
        content=row["content"],
        source=row["source"],
        publish_date=row["publish_date"].isoformat() if row["publish_date"] else None,
        effective_date=row["effective_date"].isoformat() if row["effective_date"] else None,
        tags=row["tags"] or [],
        sort_order=row["sort_order"] or 0,
    )
