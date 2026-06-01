"""
Servicio de precios en tiempo real.
Prioridad: Binance → MEXC → CoinEx → PostgreSQL (CoinGecko)
"""
from __future__ import annotations
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 5.0


async def _binance_price(symbol: str) -> dict | None:
    """Precio desde Binance. symbol ej: BTCUSDT"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.binance.com/api/v3/ticker/24hr",
                params={"symbol": f"{symbol.upper()}USDT"}
            )
            if r.status_code != 200:
                return None
            d = r.json()
            return {
                "price":      float(d["lastPrice"]),
                "change_24h": float(d["priceChangePercent"]),
                "volume_24h": float(d["quoteVolume"]),
                "high_24h":   float(d["highPrice"]),
                "low_24h":    float(d["lowPrice"]),
                "exchange":   "binance",
            }
    except Exception as e:
        logger.debug(f"[price] binance {symbol}: {e}")
        return None


async def _mexc_price(symbol: str) -> dict | None:
    """Precio desde MEXC."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.mexc.com/api/v3/ticker/24hr",
                params={"symbol": f"{symbol.upper()}USDT"}
            )
            if r.status_code != 200:
                return None
            d = r.json()
            return {
                "price":      float(d["lastPrice"]),
                "change_24h": float(d["priceChangePercent"]),
                "volume_24h": float(d["quoteVolume"]),
                "high_24h":   float(d["highPrice"]),
                "low_24h":    float(d["lowPrice"]),
                "exchange":   "mexc",
            }
    except Exception as e:
        logger.debug(f"[price] mexc {symbol}: {e}")
        return None


async def _coinex_price(symbol: str) -> dict | None:
    """Precio desde CoinEx."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.coinex.com/v1/market/ticker",
                params={"market": f"{symbol.upper()}USDT"}
            )
            if r.status_code != 200:
                return None
            d = r.json()
            if d.get("code") != 0:
                return None
            t = d["data"]["ticker"]
            return {
                "price":      float(t["last"]),
                "change_24h": round((float(t["last"]) - float(t["open"])) / float(t["open"]) * 100, 2),
                "volume_24h": float(t["vol"]),
                "high_24h":   float(t["high"]),
                "low_24h":    float(t["low"]),
                "exchange":   "coinex",
            }
    except Exception as e:
        logger.debug(f"[price] coinex {symbol}: {e}")
        return None


async def get_price(symbol: str, exchange: str, db_price: dict | None = None) -> dict:
    """
    Obtiene precio según el exchange configurado.
    Fallback: datos de PostgreSQL (CoinGecko).
    """
    price_data = None

    if exchange == "binance":
        price_data = await _binance_price(symbol)
    elif exchange == "mexc":
        price_data = await _mexc_price(symbol)
    elif exchange == "coinex":
        price_data = await _coinex_price(symbol)

    # Fallback a datos de PostgreSQL
    if price_data is None and db_price:
        price_data = {
            "price":      db_price.get("price"),
            "change_24h": db_price.get("change_24h"),
            "volume_24h": db_price.get("volume_24h"),
            "high_24h":   None,
            "low_24h":    None,
            "exchange":   "coingecko",
        }

    return price_data or {}


async def get_prices_batch(items: list[dict], pool) -> list[dict]:
    """
    Obtiene precios para todos los items de la watchlist en paralelo.
    items: lista de {id, symbol, exchange, ...}
    """
    # Traer precios de PostgreSQL como fallback
    if items:
        coin_ids = [item["coin_id"] for item in items]
        async with pool.acquire() as conn:
            db_rows = await conn.fetch("""
                SELECT id, price, change_24h, change_7d, volume_24h, image, sparkline
                FROM coins WHERE id = ANY($1)
            """, coin_ids)
        db_map = {r["id"]: dict(r) for r in db_rows}
    else:
        db_map = {}

    # Fetch en paralelo
    async def fetch_one(item):
        db_price = db_map.get(item["coin_id"])
        price    = await get_price(item["symbol"], item["exchange"], db_price)
        return {
            **item,
            "price":      price.get("price"),
            "change_24h": price.get("change_24h"),
            "change_7d":  float(db_price["change_7d"]) if db_price and db_price.get("change_7d") else None,
            "volume_24h": price.get("volume_24h"),
            "high_24h":   price.get("high_24h"),
            "low_24h":    price.get("low_24h"),
            "exchange":   price.get("exchange", item["exchange"]),
            "image":      db_price.get("image") if db_price else None,
            "sparkline":  db_price.get("sparkline") if db_price else None,
        }

    results = await asyncio.gather(*[fetch_one(item) for item in items])
    return list(results)
