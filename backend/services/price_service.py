"""
Servicio de precios en tiempo real.
Prioridad: Binance → MEXC → CoinEx → PostgreSQL (CoinGecko)

FIX: antes todas las funciones forzaban el sufijo USDT (symbol+"USDT"), por lo
que un par /BTC mostraba su precio en dólares. Ahora reciben el pair_symbol real
(ej. ONTBTC) y el quote, y consultan el par correcto. Si no viene pair_symbol,
se arma {symbol}USDT para mantener compatibilidad con el comportamiento anterior.
"""
from __future__ import annotations
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 5.0


def _resolve_symbol(symbol: str, pair_symbol: str | None, quote: str | None) -> str:
    """Devuelve el símbolo de mercado a consultar.
    - Si viene pair_symbol explícito (ej. ONTBTC), se usa tal cual.
    - Si no, se arma {symbol}{quote or 'USDT'} (compatibilidad)."""
    if pair_symbol:
        return pair_symbol.upper()
    q = (quote or "USDT").upper()
    return f"{symbol.upper()}{q}"


async def _binance_price(market: str) -> dict | None:
    """Precio desde Binance. market ej: BTCUSDT, ONTBTC"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.binance.com/api/v3/ticker/24hr",
                params={"symbol": market}
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
        logger.debug(f"[price] binance {market}: {e}")
        return None


async def _mexc_price(market: str) -> dict | None:
    """Precio desde MEXC. market ej: BTCUSDT, ONTBTC"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.mexc.com/api/v3/ticker/24hr",
                params={"symbol": market}
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
        logger.debug(f"[price] mexc {market}: {e}")
        return None


async def _coinex_price(market: str) -> dict | None:
    """Precio desde CoinEx. market ej: BTCUSDT, ONTBTC"""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                "https://api.coinex.com/v1/market/ticker",
                params={"market": market}
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
        logger.debug(f"[price] coinex {market}: {e}")
        return None


async def get_price(symbol: str, exchange: str, db_price: dict | None = None,
                    pair_symbol: str | None = None, quote: str | None = None) -> dict:
    """
    Obtiene precio según el exchange configurado, para el PAR correcto.
    - pair_symbol: símbolo real del par (ej. ONTBTC). Si viene, manda.
    - quote: moneda de cotización (BTC/USDT), usado si no hay pair_symbol.
    Fallback: datos de PostgreSQL (CoinGecko, siempre en USD).
    """
    price_data = None
    market = _resolve_symbol(symbol, pair_symbol, quote)

    if exchange == "binance":
        price_data = await _binance_price(market)
    elif exchange == "mexc":
        price_data = await _mexc_price(market)
    elif exchange == "coinex":
        price_data = await _coinex_price(market)

    # Fallback a datos de PostgreSQL (CoinGecko).
    # OJO: el precio de CoinGecko está en USD. Solo es representativo para pares
    # /USDT. Para pares /BTC no hay equivalencia directa, así que si el quote es
    # BTC y no pudimos traer el precio del par real, es mejor devolver sin precio
    # que mostrar un valor en USD que confunde.
    if price_data is None and db_price:
        q = (quote or "USDT").upper()
        if q == "USDT":
            price_data = {
                "price":      db_price.get("price"),
                "change_24h": db_price.get("change_24h"),
                "volume_24h": db_price.get("volume_24h"),
                "high_24h":   None,
                "low_24h":    None,
                "exchange":   "coingecko",
            }
        else:
            # par no-USDT sin precio del exchange: no inventamos un precio en USD
            price_data = {
                "price":      None,
                "change_24h": None,
                "volume_24h": None,
                "high_24h":   None,
                "low_24h":    None,
                "exchange":   exchange,
            }

    return price_data or {}


async def get_prices_batch(items: list[dict], pool) -> list[dict]:
    """
    Obtiene precios para todos los items de la watchlist en paralelo.
    items: lista de {id, symbol, exchange, pair_symbol?, quote?, ...}
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
        price    = await get_price(
            item["symbol"], item["exchange"], db_price,
            pair_symbol=item.get("pair_symbol"),
            quote=item.get("quote"),
        )
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
