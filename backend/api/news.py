"""
API del módulo Noticias — AXIOM v2.
"""
from fastapi import APIRouter, Query
from typing import Optional
from backend.services.news_service import get_news, RSS_FEEDS

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("/")
async def get_news_feed(
    limit: int   = Query(150, ge=1, le=150),
    source: Optional[str] = Query(None),
):
    return await get_news(limit=limit, source=source)


@router.get("/sources")
async def get_sources():
    return {"sources": [f["name"] for f in RSS_FEEDS]}


@router.post("/refresh")
async def refresh_news():
    import backend.services.news_service as ns
    ns._news_cache = []
    ns._last_fetch = None
    data = await get_news()
    return {"status": "ok", "articles": data["total"]}
