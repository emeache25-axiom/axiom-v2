"""
AXIOM v2 — Strategy Engine / Detección de Pares.

Dado un símbolo base (ej. DOGE), consulta MEXC y CoinEx para saber qué pares
operables existen (DOGE/USDT, DOGE/BTC) en cada exchange. Se usa al agregar a
la watchlist para ofrecer las opciones reales.

Cachea el listado completo de mercados de cada exchange (cambia poco) para no
machacar las APIs en cada búsqueda.
"""
from __future__ import annotations
import time
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 12.0
_QUOTES = ("USDT", "BTC")          # quotes que nos interesan
_CACHE_TTL = 3600                  # 1 hora: el listado de mercados cambia poco

# cache[exchange] = {"markets": set de (base, quote), "ts": epoch}
_cache: dict[str, dict] = {}
_lock = asyncio.Lock()


async def _load_mexc() -> set[tuple[str, str]]:
    """Set de (base, quote) operables en MEXC spot (status TRADING)."""
    url = "https://api.mexc.com/api/v3/exchangeInfo"
    out = set()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(url)
            if r.status_code != 200:
                return out
            for s in r.json().get("symbols", []):
                # MEXC marca los pares operables con status habilitado.
                status = str(s.get("status", "")).upper()
                if status not in ("ENABLED", "TRADING", "1"):
                    continue
                base = (s.get("baseAsset") or "").upper()
                quote = (s.get("quoteAsset") or "").upper()
                if quote in _QUOTES and base:
                    out.add((base, quote))
    except Exception as e:
        logger.warning(f"[pair_discovery] MEXC: {e}")
    return out


async def _load_coinex() -> set[tuple[str, str]]:
    """Set de (base, quote) operables en CoinEx spot (status online)."""
    url = "https://api.coinex.com/v2/spot/market"
    out = set()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(url)
            if r.status_code != 200:
                return out
            body = r.json()
            if body.get("code") != 0:
                return out
            for m in body.get("data", []):
                if m.get("status") != "online":
                    continue
                base = (m.get("base_ccy") or "").upper()
                quote = (m.get("quote_ccy") or "").upper()
                if quote in _QUOTES and base:
                    out.add((base, quote))
    except Exception as e:
        logger.warning(f"[pair_discovery] CoinEx: {e}")
    return out


async def _markets(exchange: str) -> set[tuple[str, str]]:
    now = time.time()
    c = _cache.get(exchange)
    if c and (now - c["ts"]) < _CACHE_TTL:
        return c["markets"]
    async with _lock:
        c = _cache.get(exchange)
        if c and (time.time() - c["ts"]) < _CACHE_TTL:
            return c["markets"]
        markets = await (_load_mexc() if exchange == "mexc" else _load_coinex())
        if markets:
            _cache[exchange] = {"markets": markets, "ts": time.time()}
        elif c:
            return c["markets"]   # usar viejo si la recarga falló
        return markets


async def discover_pairs(base_symbol: str) -> list[dict]:
    """
    Devuelve la lista de pares operables para un símbolo base, en MEXC y CoinEx.
    Cada item: {exchange, base, quote, pair_symbol, operable: True}.
    Pensado para ofrecer opciones al agregar a la watchlist.
    """
    base = base_symbol.upper()
    mexc, coinex = await asyncio.gather(_markets("mexc"), _markets("coinex"))

    pairs = []
    for quote in _QUOTES:
        if (base, quote) in mexc:
            pairs.append({
                "exchange": "mexc", "base": base, "quote": quote,
                "pair_symbol": f"{base}{quote}", "operable": True,
            })
        if (base, quote) in coinex:
            pairs.append({
                "exchange": "coinex", "base": base, "quote": quote,
                "pair_symbol": f"{base}{quote}", "operable": True,
            })
    return pairs
