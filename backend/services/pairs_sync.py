"""
AXIOM v2 — Sincronización del catálogo de PARES.
════════════════════════════════════════════════════════════════════════════
Puebla y mantiene la tabla `pairs`: todos los pares tradeables en MEXC y CoinEx.

Tres funciones:
  · sync_pairs(pool)    → catálogo (2 llamadas, cada 6 h)
  · sync_tickers(pool)  → volumen/precio/spread (2 llamadas, cada 15-30 min)
  · vincular_coins(pool)→ resuelve pair.coin_id contra el catálogo de coins

Principio de diseño: si MEXC/CoinEx listan algo que CoinGecko no indexa, el par
se guarda igual (coin_id = NULL). Sigue siendo operable; solo queda sin metadata.

Ver AXIOM_modelo_pares.md.
"""
from __future__ import annotations
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 30.0

# Exchanges del universo operable. Binance queda fuera a propósito:
# está disponible como adaptador, pero no se opera ahí.
EXCHANGES = ("mexc", "coinex")


# ══ 1. CATÁLOGO DE PARES ══════════════════════════════════════════════════════

async def _fetch_mexc_pairs() -> list[dict]:
    """Todos los pares spot de MEXC. Una sola llamada."""
    url = "https://api.mexc.com/api/v3/exchangeInfo"
    out = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(url)
        if r.status_code != 200:
            logger.warning("[sync_pairs] MEXC exchangeInfo HTTP %s", r.status_code)
            return out
        for s in (r.json().get("symbols") or []):
            base = (s.get("baseAsset") or "").upper()
            quote = (s.get("quoteAsset") or "").upper()
            sym = (s.get("symbol") or "").upper()
            if not (base and quote and sym):
                continue
            estado = str(s.get("status", "")).upper()
            out.append({
                "exchange": "mexc",
                "pair_symbol": sym,
                "base": base,
                "quote": quote,
                "tradeable": estado in ("ENABLED", "TRADING", "1"),
            })
    return out


async def _fetch_coinex_pairs() -> list[dict]:
    """
    Todos los pares spot de CoinEx. Una sola llamada.
    CoinEx devuelve base_ccy/quote_ccy por separado: no hace falta parsear
    el símbolo (que sería ambiguo con quotes como USDT vs USDC).
    """
    url = "https://api.coinex.com/v2/spot/market"
    out = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(url)
        if r.status_code != 200:
            logger.warning("[sync_pairs] CoinEx market HTTP %s", r.status_code)
            return out
        body = r.json()
        if body.get("code") != 0:
            logger.warning("[sync_pairs] CoinEx code=%s", body.get("code"))
            return out
        for m in (body.get("data") or []):
            base = (m.get("base_ccy") or "").upper()
            quote = (m.get("quote_ccy") or "").upper()
            sym = (m.get("market") or "").upper()
            if not (base and quote and sym):
                continue
            out.append({
                "exchange": "coinex",
                "pair_symbol": sym,
                "base": base,
                "quote": quote,
                "tradeable": m.get("status") == "online" or m.get("status") is None,
            })
    return out


async def sync_pairs(pool) -> dict:
    """
    Refresca el catálogo de pares. Upsert por (exchange, pair_symbol).
    Los pares que dejan de aparecer se marcan tradeable=false (no se borran:
    conservan su historia de velas y pueden volver a listarse).
    """
    mexc, coinex = await asyncio.gather(
        _fetch_mexc_pairs(), _fetch_coinex_pairs(), return_exceptions=True)

    pares = []
    for res, nombre in ((mexc, "mexc"), (coinex, "coinex")):
        if isinstance(res, Exception):
            logger.warning("[sync_pairs] %s falló: %s", nombre, res)
        else:
            pares.extend(res)

    if not pares:
        logger.warning("[sync_pairs] sin datos de ningún exchange — se aborta")
        return {"insertados": 0, "actualizados": 0, "deslistados": 0}

    vistos = {(p["exchange"], p["pair_symbol"]) for p in pares}
    faltantes = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany("""
                INSERT INTO pairs (exchange, pair_symbol, base, quote, tradeable,
                                   first_seen, last_seen, updated_at)
                VALUES ($1,$2,$3,$4,$5, now(), now(), now())
                ON CONFLICT (exchange, pair_symbol) DO UPDATE SET
                    base = EXCLUDED.base,
                    quote = EXCLUDED.quote,
                    tradeable = EXCLUDED.tradeable,
                    last_seen = now(),
                    updated_at = now()
            """, [(p["exchange"], p["pair_symbol"], p["base"], p["quote"],
                   p["tradeable"]) for p in pares])

            # Marcar como no tradeables los que ya no aparecen en su exchange
            filas = await conn.fetch(
                "SELECT id, exchange, pair_symbol FROM pairs WHERE tradeable")
            faltantes = [r["id"] for r in filas
                         if (r["exchange"], r["pair_symbol"]) not in vistos
                         and r["exchange"] in EXCHANGES]
            if faltantes:
                await conn.execute(
                    "UPDATE pairs SET tradeable=false, updated_at=now() "
                    "WHERE id = ANY($1::bigint[])", faltantes)

        total = await conn.fetchval("SELECT COUNT(*) FROM pairs")

    logger.info("[sync_pairs] %s pares procesados · %s deslistados · total en base: %s",
                len(pares), len(faltantes), total)
    return {"procesados": len(pares), "deslistados": len(faltantes), "total": total}


# ══ 2. TICKERS (volumen, precio, spread) ══════════════════════════════════════

async def _fetch_mexc_tickers() -> dict:
    """{pair_symbol: {...}} — una llamada trae TODOS los pares."""
    out = {}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://api.mexc.com/api/v3/ticker/24hr")
        if r.status_code != 200:
            return out
        for t in r.json():
            sym = (t.get("symbol") or "").upper()
            if not sym:
                continue
            out[sym] = {
                "last": _f(t.get("lastPrice")),
                "volume": _f(t.get("quoteVolume")),   # en moneda quote
                "change": _f(t.get("priceChangePercent")),
                "bid": _f(t.get("bidPrice")),
                "ask": _f(t.get("askPrice")),
            }
    return out


async def _fetch_coinex_tickers() -> dict:
    out = {}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://api.coinex.com/v2/spot/ticker")
        if r.status_code != 200:
            return out
        body = r.json()
        if body.get("code") != 0:
            return out
        for t in (body.get("data") or []):
            sym = (t.get("market") or "").upper()
            if not sym:
                continue
            last = _f(t.get("last"))
            open_ = _f(t.get("open"))
            change = None
            if last is not None and open_:
                change = (last - open_) / open_ * 100
            out[sym] = {
                "last": last,
                "volume": _f(t.get("value")),      # volumen en quote
                "change": change,
                # El ticker de CoinEx no trae bid/ask; quedan None.
                "bid": None,
                "ask": None,
            }
    return out


def _f(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


async def sync_tickers(pool) -> dict:
    """
    Refresca precio, volumen, variación y spread de todos los pares.
    Dos llamadas (una por exchange). Es lo que mantiene vivo el ranking.

    El volumen se normaliza a USD: los pares con quote USDT/USDC ya están en
    dólares; los que cotizan contra BTC/ETH se convierten con el precio de esa
    quote (tomado de los propios tickers).
    """
    mexc, coinex = await asyncio.gather(
        _fetch_mexc_tickers(), _fetch_coinex_tickers(), return_exceptions=True)
    mexc = {} if isinstance(mexc, Exception) else mexc
    coinex = {} if isinstance(coinex, Exception) else coinex

    if not mexc and not coinex:
        logger.warning("[sync_tickers] sin datos de ningún exchange")
        return {"actualizados": 0}

    # Precio de las quotes no-dólar, para normalizar el volumen a USD
    ref = {}
    for fuente in (mexc, coinex):
        for q in ("BTC", "ETH", "BNB"):
            p = (fuente.get(f"{q}USDT") or {}).get("last")
            if p and q not in ref:
                ref[q] = p
    ref["USDT"] = 1.0
    ref["USDC"] = 1.0
    ref["USD"] = 1.0

    async with pool.acquire() as conn:
        filas = await conn.fetch(
            "SELECT id, exchange, pair_symbol, quote FROM pairs WHERE exchange = ANY($1::text[])",
            list(EXCHANGES))

        updates = []
        for r in filas:
            fuente = mexc if r["exchange"] == "mexc" else coinex
            t = fuente.get(r["pair_symbol"])
            if not t:
                continue

            vol = t["volume"]
            if vol is not None:
                factor = ref.get((r["quote"] or "").upper())
                vol = vol * factor if factor else None

            spread = None
            if t["bid"] and t["ask"] and t["ask"] > 0:
                mid = (t["bid"] + t["ask"]) / 2
                if mid > 0:
                    spread = (t["ask"] - t["bid"]) / mid * 100

            updates.append((r["id"], t["last"], vol, t["change"],
                            t["bid"], t["ask"], spread))

        if updates:
            async with conn.transaction():
                await conn.executemany("""
                    UPDATE pairs SET
                        last_price = $2, volume_24h = $3, change_24h = $4,
                        bid = $5, ask = $6, spread_pct = $7, updated_at = now()
                    WHERE id = $1
                """, updates)

    logger.info("[sync_tickers] %s pares actualizados", len(updates))
    return {"actualizados": len(updates)}


# ══ 3. VINCULACIÓN PAR → COIN ═════════════════════════════════════════════════

async def vincular_coins(pool) -> dict:
    """
    Resuelve `pairs.coin_id` contra el catálogo de coins.

    Estrategia en capas:
      1. Alias manual (tabla pair_coin_alias) — máxima prioridad.
      2. Símbolo unívoco en `coins`.
      3. Símbolo ambiguo → desempate por market cap (el par listado suele ser
         el activo grande).
      4. Sin coincidencia → coin_id queda NULL (el par se conserva igual).
    """
    async with pool.acquire() as conn:
        # 1) Alias manuales
        alias = {(a["exchange"], a["base"].upper()): a["coin_id"]
                 for a in await conn.fetch(
                     "SELECT exchange, base, coin_id FROM pair_coin_alias")}

        # 2/3) Símbolo → coin, desempatando por market cap
        mapa = {}
        for row in await conn.fetch("""
            SELECT DISTINCT ON (upper(symbol)) upper(symbol) AS sym, id
            FROM coins
            ORDER BY upper(symbol), market_cap DESC NULLS LAST
        """):
            mapa[row["sym"]] = row["id"]

        pares = await conn.fetch(
            "SELECT id, exchange, base FROM pairs WHERE exchange = ANY($1::text[])",
            list(EXCHANGES))

        updates, sin_vinculo = [], 0
        for p in pares:
            base = (p["base"] or "").upper()
            cid = alias.get((p["exchange"], base)) or mapa.get(base)
            if cid:
                updates.append((p["id"], cid))
            else:
                sin_vinculo += 1

        if updates:
            async with conn.transaction():
                await conn.executemany(
                    "UPDATE pairs SET coin_id=$2, updated_at=now() WHERE id=$1",
                    updates)

    logger.info("[vincular_coins] %s vinculados · %s sin coin en el catálogo",
                len(updates), sin_vinculo)
    return {"vinculados": len(updates), "sin_vinculo": sin_vinculo}


# ══ Utilidad: estado ══════════════════════════════════════════════════════════

async def estado(pool) -> dict:
    """Resumen del catálogo, para inspección."""
    async with pool.acquire() as conn:
        return dict(await conn.fetchrow("""
            SELECT
                COUNT(*)                                        AS total,
                COUNT(*) FILTER (WHERE tradeable)               AS tradeables,
                COUNT(*) FILTER (WHERE coin_id IS NOT NULL)     AS con_coin,
                COUNT(*) FILTER (WHERE volume_24h > 10000)      AS vol_mayor_10k,
                COUNT(*) FILTER (WHERE quote = 'BTC')           AS pares_btc,
                COUNT(DISTINCT exchange)                        AS exchanges,
                MAX(updated_at)                                 AS ultimo_update
            FROM pairs
        """))
