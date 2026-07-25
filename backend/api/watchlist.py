"""
API de Watchlist — AXIOM v2 (modelo de PARES).

La watchlist sigue PARES, no coins. Una fila = un par (base+quote+exchange).
Solo los pares en mexc/coinex son operables por el bot (campo `operable`).

Cambios clave respecto al modelo viejo:
  - /search devuelve coins Y sus pares operables (vía pair_discovery)
  - / (POST) agrega un par concreto (base, quote, exchange, pair_symbol)
  - cada item expone base/quote/exchange/operable/bot_enabled
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services.price_service import get_prices_batch
from backend.strat.pair_discovery import discover_pairs

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

_OPERABLE_EXCHANGES = ("mexc", "coinex")


class PairAdd(BaseModel):
    coin_id:     str
    base:        str
    quote:       str = "USDT"
    exchange:    str = "coingecko"
    pair_symbol: Optional[str] = None      # si no viene, se arma {base}{quote}
    notes:       Optional[str] = None


class WatchlistUpdate(BaseModel):
    notes:       Optional[str] = None
    position:    Optional[int] = None
    bot_enabled: Optional[bool] = None


def _fmt(r) -> dict:
    sp = None
    if r.get("sparkline"):
        try:
            sp = json.loads(r["sparkline"]) if isinstance(r["sparkline"], str) else r["sparkline"]
        except Exception:
            sp = None
    return {
        "id":          r["id"],
        "coin_id":     r["coin_id"],
        "base":        r["base"],
        "name":        r["name"],
        "quote":       r["quote"],
        "exchange":    r["exchange"],
        "pair_symbol": r["pair_symbol"],
        "operable":    r["operable"],
        "bot_enabled": r["bot_enabled"],
        "notes":       r["notes"],
        "position":    r["position"],
        "price":       float(r["price"])      if r.get("price")      else None,
        "change_24h":  float(r["change_24h"]) if r.get("change_24h") else None,
        "change_7d":   float(r["change_7d"])  if r.get("change_7d")  else None,
        "volume_24h":  float(r["volume_24h"]) if r.get("volume_24h") else None,
        "high_24h":    float(r["high_24h"])   if r.get("high_24h")   else None,
        "low_24h":     float(r["low_24h"])    if r.get("low_24h")    else None,
        "image":       r.get("image"),
        "sparkline":   sp or [],
        # label legible del par para la UI
        "label":       f"{r['base']}/{r['quote']}",
    }


@router.get("/")
async def get_watchlist(request: Request):
    """Lista de pares con precios actuales."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT w.id, w.coin_id, w.base, w.name, w.quote, w.exchange,
                   w.pair_symbol, w.operable, w.bot_enabled, w.notes, w.position,
                   c.price, c.change_24h, c.change_7d, c.volume_24h,
                   c.image, c.sparkline
            FROM watchlist w
            LEFT JOIN coins c ON c.id = w.coin_id
            ORDER BY w.position ASC, w.created_at ASC
        """)

    items = [dict(r) for r in rows]
    # get_prices_batch espera la clave 'symbol'; en el modelo de pares el
    # símbolo base vive en 'base'. Alias para compatibilidad.
    for it in items:
        it["symbol"] = it["base"]
    prices = await get_prices_batch(items, request.app.state.db_pool)
    # mezclar precios por id
    pmap = {p["id"]: p for p in prices}
    out = []
    for it in items:
        merged = {**it, **{k: pmap.get(it["id"], {}).get(k) for k in
                  ("price", "change_24h", "high_24h", "low_24h")}}
        # conservar los de coins si batch no trajo
        for k in ("price", "change_24h", "change_7d", "volume_24h", "image", "sparkline"):
            if merged.get(k) is None and it.get(k) is not None:
                merged[k] = it[k]
        out.append(_fmt(merged))
    return {"items": out}


@router.get("/prices")
async def get_watchlist_prices(request: Request):
    """Solo precios — para polling cada 15s."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT w.id, w.coin_id, w.base AS symbol, w.exchange,
                   w.quote, w.pair_symbol
            FROM watchlist w
            ORDER BY w.position ASC
        """)
    items = [dict(r) for r in rows]
    prices = await get_prices_batch(items, request.app.state.db_pool)
    return {"prices": [
        {
            "id":         p["id"],
            "coin_id":    p["coin_id"],
            "price":      p.get("price"),
            "change_24h": p.get("change_24h"),
            "high_24h":   p.get("high_24h"),
            "low_24h":    p.get("low_24h"),
            "exchange":   p.get("exchange"),
        }
        for p in prices
    ]}


@router.post("/")
async def add_pair(request: Request, body: PairAdd):
    """Agregar un par a la watchlist."""
    quote = body.quote.upper()
    base = body.base.upper()
    pair_symbol = (body.pair_symbol or f"{base}{quote}").upper()
    operable = body.exchange in _OPERABLE_EXCHANGES

    async with request.app.state.db_pool.acquire() as conn:
        coin = await conn.fetchrow("SELECT id, name FROM coins WHERE id = $1", body.coin_id)
        if not coin:
            raise HTTPException(404, "Coin no encontrada")

        exists = await conn.fetchval(
            "SELECT id FROM watchlist WHERE coin_id=$1 AND quote=$2 AND exchange=$3",
            body.coin_id, quote, body.exchange
        )
        if exists:
            raise HTTPException(409, "Ese par ya está en la watchlist")

        max_pos = await conn.fetchval("SELECT COALESCE(MAX(position), 0) FROM watchlist")
        row = await conn.fetchrow("""
            INSERT INTO watchlist
                (coin_id, base, name, quote, exchange, pair_symbol, operable, notes, position)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id, coin_id, base, name, quote, exchange, pair_symbol,
                      operable, bot_enabled, notes, position
        """, body.coin_id, base, coin["name"], quote, body.exchange,
            pair_symbol, operable, body.notes, max_pos + 1)

    return {"item": dict(row)}


@router.put("/{item_id}")
async def update_watchlist_item(request: Request, item_id: int, body: WatchlistUpdate):
    """Modificar notas, orden, o el toggle de bot."""
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT operable FROM watchlist WHERE id = $1", item_id)
        if not row:
            raise HTTPException(404, "Item no encontrado")

        # No permitir activar el bot en pares no operables
        if body.bot_enabled and not row["operable"]:
            raise HTTPException(400, "Este par no es operable (solo mexc/coinex)")

        updates, values, i = [], [], 1
        if body.notes is not None:
            updates.append(f"notes = ${i}"); values.append(body.notes); i += 1
        if body.position is not None:
            updates.append(f"position = ${i}"); values.append(body.position); i += 1
        if body.bot_enabled is not None:
            updates.append(f"bot_enabled = ${i}"); values.append(body.bot_enabled); i += 1
        if not updates:
            raise HTTPException(400, "Nada que actualizar")
        values.append(item_id)
        await conn.execute(
            f"UPDATE watchlist SET {', '.join(updates)} WHERE id = ${i}", *values
        )
    return {"status": "ok"}


@router.delete("/{item_id}")
async def remove_pair(request: Request, item_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        result = await conn.execute("DELETE FROM watchlist WHERE id = $1", item_id)
    if result == "DELETE 0":
        raise HTTPException(404, "Item no encontrado")
    return {"status": "ok"}


@router.get("/search")
async def search_coins(request: Request, q: str = "", limit: int = 10):
    """
    Busca coins y, para cada una, descubre sus pares operables en MEXC/CoinEx.
    Devuelve la coin + lista de pares disponibles para elegir al agregar.
    """
    if len(q) < 2:
        return {"results": []}
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, symbol, name, image, rank, price
            FROM coins
            WHERE symbol ILIKE $1 OR name ILIKE $2
            ORDER BY rank ASC NULLS LAST
            LIMIT $3
        """, f"{q}%", f"%{q}%", limit)

    results = []
    for r in rows:
        sym = r["symbol"].upper()
        try:
            pairs = await discover_pairs(sym)
        except Exception:
            pairs = []
        # Siempre ofrecer también CoinGecko (solo seguimiento, no operable)
        pairs.append({
            "exchange": "coingecko", "base": sym, "quote": "USD",
            "pair_symbol": sym, "operable": False,
        })
        results.append({
            "id":     r["id"],
            "symbol": sym,
            "name":   r["name"],
            "image":  r["image"],
            "rank":   r["rank"],
            "price":  float(r["price"]) if r["price"] else None,
            "pairs":  pairs,
        })
    return {"results": results}


@router.get("/suggested")
async def get_suggested(request: Request):
    """Coins sugeridas por régimen: largo / medio / corto plazo."""
    from backend.services.selection_service import get_asset_selection
    return await get_asset_selection(request.app.state.db_pool)


@router.get("/screener")
async def screener(
    request:     Request,
    type:        str   = "basic",       # basic | open_high
    supercat:    str   = "",
    quote:       str   = "",            # filtro por cotización en open_high (BTC, USDT)
    min_change:  float = -999,
    max_change:  float = 999,
    min_mcap:    float = 0,
    max_mcap:    float = 1e15,
    sort_by:     str   = "rank",
    sort_dir:    str   = "asc",
    # Parámetros del screener open→high
    min_range:   float = 3.0,           # % mínimo de (high-open)/open por vela
    min_pct_ok:  float = 80.0,          # % mínimo de velas que deben cumplir
    min_candles: int   = 20,            # mínimo de velas para ser válido
    limit:       int   = 100,
):
    """Screener: básico (coins) y open→high estructural (pares).

    El screener de volatilidad estructural se movió a /api/pairs/ (screener de
    pares), que es su lugar natural: opera sobre pares tradeables, no coins.
    """
    valid_sort = {"rank","change_24h","change_7d","volume_24h","market_cap",
                  "price","avg_oh_pct","pct_velas_ok","volatilidad"}
    valid_dir  = {"asc","desc"}
    if sort_by  not in valid_sort: sort_by  = "rank"
    if sort_dir not in valid_dir:  sort_dir = "asc"

    async with request.app.state.db_pool.acquire() as conn:

        # ── Screener open→high (sobre pair_ohlcv, por PAR) ──────────────────
        # El screener de volatilidad estructural fue reemplazado por el screener
        # de PARES (/api/pairs/). Acá queda open→high, migrado a pair_ohlcv:
        # opera sobre el par que se va a operar, no sobre la coin en USD.
        if type == "open_high":
            order_col = {
                "avg_oh_pct":   "cs.avg_oh_pct",
                "pct_velas_ok": "cs.velas_ok::float / cs.total_velas",
                "volume_24h":   "p.volume_24h",
                "volatilidad":  "p.volatility_30d",
                "rank":         "c.rank",
                "change_24h":   "p.change_24h",
                "market_cap":   "c.market_cap",
            }.get(sort_by, "cs.avg_oh_pct")
            order_dir = sort_dir.upper()

            quote_f = quote

            rows = await conn.fetch(f"""
                WITH candle_stats AS (
                    SELECT
                        o.pair_id,
                        COUNT(*)                                                    AS total_velas,
                        COUNT(*) FILTER (
                            WHERE o.open > 0
                              AND (o.high - o.open) / o.open * 100 >= $1
                        )                                                           AS velas_ok,
                        AVG((o.high - o.open) / NULLIF(o.open, 0) * 100)          AS avg_oh_pct,
                        MAX((o.high - o.open) / NULLIF(o.open, 0) * 100)          AS max_oh_pct
                    FROM pair_ohlcv o
                    WHERE o.date >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY o.pair_id
                    HAVING COUNT(*) >= $2
                )
                SELECT
                    p.id AS pair_id, p.exchange, p.pair_symbol, p.base, p.quote,
                    p.last_price, p.change_24h, p.volume_24h,
                    p.volatility_30d, p.spread_pct,
                    p.coin_id, c.name, c.image, c.rank, c.market_cap, c.supercat,
                    cs.total_velas, cs.velas_ok,
                    ROUND(cs.velas_ok::numeric / cs.total_velas * 100, 1) AS pct_velas_ok,
                    ROUND(cs.avg_oh_pct::numeric, 2)                      AS avg_oh_pct,
                    ROUND(cs.max_oh_pct::numeric, 2)                      AS max_oh_pct
                FROM candle_stats cs
                JOIN pairs p ON p.id = cs.pair_id
                LEFT JOIN coins c ON c.id = p.coin_id
                WHERE cs.velas_ok::float / cs.total_velas >= $3 / 100.0
                  AND p.tradeable
                  AND ($4 = '' OR p.quote = $4)
                  AND (c.market_cap IS NULL OR c.market_cap BETWEEN $5 AND $6)
                ORDER BY {order_col} {order_dir} NULLS LAST
                LIMIT $7
            """, min_range, min_candles, min_pct_ok,
                 quote_f, min_mcap, max_mcap, limit)

            return {
                "type":    "open_high",
                "total":   len(rows),
                "params":  {"min_range": min_range, "min_pct_ok": min_pct_ok},
                "results": [
                    {
                        "pair_id":      r["pair_id"],
                        "exchange":     r["exchange"],
                        "par":          r["pair_symbol"],
                        "base":         r["base"],
                        "quote":        r["quote"],
                        "price":        float(r["last_price"])   if r["last_price"]   else None,
                        "change_24h":   float(r["change_24h"])   if r["change_24h"]   else None,
                        "volume_24h":   float(r["volume_24h"])   if r["volume_24h"]   else None,
                        "volatilidad":  float(r["volatility_30d"])if r["volatility_30d"]else None,
                        "spread_pct":   float(r["spread_pct"])   if r["spread_pct"]   else None,
                        "total_velas":  r["total_velas"],
                        "velas_ok":     r["velas_ok"],
                        "pct_velas_ok": float(r["pct_velas_ok"]) if r["pct_velas_ok"] else None,
                        "avg_oh_pct":   float(r["avg_oh_pct"])   if r["avg_oh_pct"]   else None,
                        "max_oh_pct":   float(r["max_oh_pct"])   if r["max_oh_pct"]   else None,
                        "tiene_info":   r["coin_id"] is not None,
                        "coin": {
                            "id":         r["coin_id"],
                            "nombre":     r["name"],
                            "image":      r["image"],
                            "rank":       r["rank"],
                            "market_cap": float(r["market_cap"]) if r["market_cap"] else None,
                            "sector":     r["supercat"],
                        } if r["coin_id"] else None,
                    }
                    for r in rows
                ],
            }

        # ── Screener básico ───────────────────────────────────────────────────
        order_col = {
            "rank":       "rank",
            "change_24h": "change_24h",
            "change_7d":  "change_7d",
            "volume_24h": "volume_24h",
            "market_cap": "market_cap",
            "price":      "price",
        }.get(sort_by, "rank")

        rows = await conn.fetch(f"""
            SELECT id, symbol, name, image, rank,
                   price, change_24h, change_7d, volume_24h, market_cap, supercat
            FROM coins
            WHERE rank IS NOT NULL
              AND ($1 = '' OR supercat = $1)
              AND (change_24h IS NULL OR change_24h BETWEEN $2 AND $3)
              AND (market_cap  IS NULL OR market_cap  BETWEEN $4 AND $5)
            ORDER BY {order_col} {sort_dir} NULLS LAST
            LIMIT $6
        """, supercat, min_change, max_change, min_mcap, max_mcap, limit)

        return {
            "type":    "basic",
            "total":   len(rows),
            "results": [
                {
                    "id":         r["id"],
                    "symbol":     r["symbol"],
                    "name":       r["name"],
                    "image":      r["image"],
                    "rank":       r["rank"],
                    "price":      float(r["price"])      if r["price"]      else None,
                    "change_24h": float(r["change_24h"]) if r["change_24h"] else None,
                    "change_7d":  float(r["change_7d"])  if r["change_7d"]  else None,
                    "volume_24h": float(r["volume_24h"]) if r["volume_24h"] else None,
                    "market_cap": float(r["market_cap"]) if r["market_cap"] else None,
                    "supercat":   r["supercat"],
                }
                for r in rows
            ],
        }
