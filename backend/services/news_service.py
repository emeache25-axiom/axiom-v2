import httpx
import xml.etree.ElementTree as ET
import logging
from datetime import datetime, timezone
from typing import Optional
import asyncio
import re

logger = logging.getLogger(__name__)

RSS_FEEDS = [
    {"name": "CoinTelegraph",      "url": "https://cointelegraph.es/rss",                  "lang": "es", "category": "General"},
    {"name": "DiarioBitcoin",      "url": "https://www.diariobitcoin.com/feed",             "lang": "es", "category": "Bitcoin"},
    {"name": "Decrypt",            "url": "https://decrypt.co/es/feed",                    "lang": "es", "category": "General"},
    {"name": "Bitcoin.com",        "url": "https://news.bitcoin.com/es/feed/",              "lang": "es", "category": "General"},
    {"name": "NewsBTC",            "url": "https://www.newsbtc.com/es/feed/",               "lang": "es", "category": "General"},
    {"name": "CryptoBriefing",     "url": "https://es.cryptobriefing.com/feed/gn",          "lang": "es", "category": "General"},
    {"name": "AMBCrypto",          "url": "https://es.ambcrypto.com/feed/",                 "lang": "es", "category": "General"},
    {"name": "CoinTribune",        "url": "https://www.cointribune.com/es/feed/",           "lang": "es", "category": "General"},
    {"name": "CryptoRo",           "url": "https://crypto.ro/es/feed/",                     "lang": "es", "category": "General"},
]

_news_cache = []
_last_fetch = None
_CACHE_MINUTES = 30
_ITEMS_PER_FEED = 15  # Más ítems por feed para llegar a 150


async def fetch_feed(session: httpx.AsyncClient, feed: dict) -> list[dict]:
    try:
        r = await session.get(
            feed["url"], timeout=12,
            headers={"User-Agent": "AXIOM/1.0 RSS Reader"},
            follow_redirects=True
        )
        r.raise_for_status()
        root = ET.fromstring(r.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = []

        for item in root.findall(".//item")[:_ITEMS_PER_FEED]:
            title = item.findtext("title", "").strip()
            link  = item.findtext("link",  "").strip()
            desc  = item.findtext("description", "").strip()
            pub   = item.findtext("pubDate", "").strip()
            if not title or not link:
                continue
            image   = _extract_image(item, desc)
            desc    = re.sub(r'<[^>]+>', '', desc)[:300].strip()
            pub_dt  = _parse_date(pub)
            items.append({
                "title":        title,
                "link":         link,
                "summary":      desc,
                "image":        image,
                "source":       feed["name"],
                "lang":         feed["lang"],
                "category":     feed["category"],
                "published":    pub_dt.isoformat() if pub_dt else None,
                "published_ts": pub_dt.timestamp() if pub_dt else 0,
            })

        # Atom fallback
        if not items:
            for entry in root.findall("atom:entry", ns)[:_ITEMS_PER_FEED]:
                title   = entry.findtext("atom:title",   "", ns).strip()
                link_el = entry.find("atom:link", ns)
                link    = link_el.get("href", "") if link_el is not None else ""
                pub     = entry.findtext("atom:published", "", ns).strip()
                summary = re.sub(r'<[^>]+>', '', entry.findtext("atom:summary", "", ns))[:300]
                if not title or not link:
                    continue
                pub_dt = _parse_date(pub)
                items.append({
                    "title":        title,
                    "link":         link,
                    "summary":      summary,
                    "image":        None,
                    "source":       feed["name"],
                    "lang":         feed["lang"],
                    "category":     feed["category"],
                    "published":    pub_dt.isoformat() if pub_dt else None,
                    "published_ts": pub_dt.timestamp() if pub_dt else 0,
                })

        logger.info(f"Feed {feed['name']}: {len(items)} artículos")
        return items

    except Exception as e:
        logger.warning(f"Error fetching {feed['name']}: {e}")
        return []


def _extract_image(item, description: str) -> Optional[str]:
    # 1. media:content
    ns = {"media": "http://search.yahoo.com/mrss/"}
    media = item.find("media:content", ns)
    if media is not None:
        url = media.get("url", "")
        if url and url.startswith("http"):
            return url

    # 2. media:thumbnail
    thumb = item.find("media:thumbnail", ns)
    if thumb is not None:
        url = thumb.get("url", "")
        if url and url.startswith("http"):
            return url

    # 3. enclosure (cualquier tipo de imagen)
    enc = item.find("enclosure")
    if enc is not None:
        url = enc.get("url", "")
        if url and url.startswith("http"):
            return url

    # 4. content:encoded — buscar img src
    content_ns = {"content": "http://purl.org/rss/1.0/modules/content/"}
    encoded = item.find("content:encoded", content_ns)
    if encoded is not None and encoded.text:
        img_match = re.search(r'<img[^>]+src="([^"]+)"', encoded.text)
        if img_match:
            url = img_match.group(1)
            if url.startswith("http"):
                return url

    # 5. tag "content" sin namespace (usado por algunos feeds)
    for child in item:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if tag == 'content' and child.text and child.text.startswith('http'):
            if any(ext in child.text.lower() for ext in ['.jpg','.jpeg','.png','.webp','.gif']):
                return child.text

    # 6. img in description HTML
    img_match = re.search(r'<img[^>]+src="([^"]+)"', description or "")
    if img_match:
        url = img_match.group(1)
        if url.startswith("http"):
            return url

    return None


def _parse_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


async def get_news(limit: int = 150, lang: Optional[str] = None, source: Optional[str] = None) -> dict:
    global _news_cache, _last_fetch

    now = datetime.now(timezone.utc)

    if _news_cache and _last_fetch:
        elapsed = (now - _last_fetch).total_seconds() / 60
        if elapsed < _CACHE_MINUTES:
            articles = _news_cache
            if source:
                articles = [a for a in articles if a["source"].lower() == source.lower()]
            elif lang:
                articles = [a for a in articles if a["lang"] == lang]
            return {
                "articles": articles[:limit],
                "total": len(articles),
                "last_updated": _last_fetch.isoformat(),
                "from_cache": True
            }

    async with httpx.AsyncClient() as session:
        results = await asyncio.gather(
            *[fetch_feed(session, feed) for feed in RSS_FEEDS],
            return_exceptions=True
        )

    all_articles = []
    for result in results:
        if isinstance(result, list):
            all_articles.extend(result)

    all_articles.sort(key=lambda x: x.get("published_ts", 0), reverse=True)

    seen = set()
    unique = []
    for a in all_articles:
        key = a["title"][:50].lower()
        if key not in seen:
            seen.add(key)
            unique.append(a)

    _news_cache = unique
    _last_fetch = now

    articles = unique
    # Filtro por fuente (source) — reemplaza filtro de idioma
    if source:
        articles = [a for a in articles if a["source"].lower() == source.lower()]
    elif lang:
        articles = [a for a in articles if a["lang"] == lang]

    logger.info(f"Noticias actualizadas: {len(unique)} artículos únicos")

    return {
        "articles": articles[:limit],
        "total": len(articles),
        "last_updated": now.isoformat(),
        "from_cache": False
    }
