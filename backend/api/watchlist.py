"""
API de Watchlist — AXIOM v2.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.services.price_service import get_prices_batch

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistAdd(BaseModel):
    coin_id:  str
    exchange: str = "coingecko"
    notes:    Optional[str] = None


class WatchlistUpdate(BaseModel):
    exchange: Optional[str] = None
    notes:    Optional[str] = None
    position: Optional[int] = None


def _fmt(r) -> dict:
    sp = None
    if r.get("sparkline"):
        try:
            sp = json.loads(r["sparkline"]) if isinstance(r["sparkline"], str) else r["sparkline"]
        except Exception:
            sp = None
    return {
        "id":         r["id"],
        "coin_id":    r["coin_id"],
        "symbol":     r["symbol"],
        "name":       r["name"],
        "exchange":   r["exchange"],
        "notes":      r["notes"],
        "position":   r["position"],
        "price":      float(r["price"])      if r.get("price")      else None,
        "change_24h": float(r["change_24h"]) if r.get("change_24h") else None,
        "change_7d":  float(r["change_7d"])  if r.get("change_7d")  else None,
        "volume_24h": float(r["volume_24h"]) if r.get("volume_24h") else None,
        "high_24h":   float(r["high_24h"])   if r.get("high_24h")   else None,
        "low_24h":    float(r["low_24h"])    if r.get("low_24h")    else None,
        "image":      r.get("image"),
        "sparkline":  sp or [],
    }


@router.get("/")
async def get_watchlist(request: Request):
    """Lista completa con precios actuales."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT w.id, w.coin_id, w.symbol, w.name, w.exchange,
                   w.notes, w.position,
                   c.price, c.change_24h, c.change_7d, c.volume_24h,
                   c.image, c.sparkline
            FROM watchlist w
            LEFT JOIN coins c ON c.id = w.coin_id
            ORDER BY w.position ASC, w.created_at ASC
        """)

    items = [dict(r) for r in rows]

    # Obtener precios frescos desde exchanges
    prices = await get_prices_batch(items, request.app.state.db_pool)

    return {"items": [_fmt(p) for p in prices]}


@router.get("/prices")
async def get_watchlist_prices(request: Request):
    """Solo precios — para polling cada 15s."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT w.id, w.coin_id, w.symbol, w.exchange
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
async def add_to_watchlist(request: Request, body: WatchlistAdd):
    """Agregar coin a la watchlist."""
    async with request.app.state.db_pool.acquire() as conn:
        # Verificar que la coin existe
        coin = await conn.fetchrow(
            "SELECT id, symbol, name FROM coins WHERE id = $1", body.coin_id
        )
        if not coin:
            raise HTTPException(status_code=404, detail="Coin no encontrada")

        # Verificar que no está ya en la watchlist
        exists = await conn.fetchval(
            "SELECT id FROM watchlist WHERE coin_id = $1", body.coin_id
        )
        if exists:
            raise HTTPException(status_code=409, detail="Coin ya está en la watchlist")

        # Obtener la posición máxima
        max_pos = await conn.fetchval("SELECT COALESCE(MAX(position), 0) FROM watchlist")

        row = await conn.fetchrow("""
            INSERT INTO watchlist (coin_id, symbol, name, exchange, notes, position)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, coin_id, symbol, name, exchange, notes, position
        """, body.coin_id, coin["symbol"].upper(), coin["name"],
            body.exchange, body.notes, max_pos + 1)

    return {"item": dict(row)}


@router.put("/{item_id}")
async def update_watchlist_item(request: Request, item_id: int, body: WatchlistUpdate):
    """Modificar exchange, notas u orden."""
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM watchlist WHERE id = $1", item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Item no encontrado")

        updates = []
        values  = []
        i       = 1
        if body.exchange is not None:
            updates.append(f"exchange = ${i}"); values.append(body.exchange); i+=1
        if body.notes is not None:
            updates.append(f"notes = ${i}"); values.append(body.notes); i+=1
        if body.position is not None:
            updates.append(f"position = ${i}"); values.append(body.position); i+=1

        if not updates:
            raise HTTPException(status_code=400, detail="Nada que actualizar")

        values.append(item_id)
        await conn.execute(
            f"UPDATE watchlist SET {', '.join(updates)} WHERE id = ${i}",
            *values
        )

    return {"status": "ok"}


@router.delete("/{item_id}")
async def remove_from_watchlist(request: Request, item_id: int):
    """Eliminar coin de la watchlist."""
    async with request.app.state.db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM watchlist WHERE id = $1", item_id
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Item no encontrado")
    return {"status": "ok"}


@router.get("/search")
async def search_coins(request: Request, q: str = "", limit: int = 10):
    """Buscar coins para agregar a la watchlist."""
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

    return {"results": [
        {
            "id":     r["id"],
            "symbol": r["symbol"],
            "name":   r["name"],
            "image":  r["image"],
            "rank":   r["rank"],
            "price":  float(r["price"]) if r["price"] else None,
        }
        for r in rows
    ]}


@router.get("/suggested")
async def get_suggested(request: Request):
    """Coins sugeridas por régimen: largo / medio / corto plazo."""
    from backend.services.selection_service import get_asset_selection
    return await get_asset_selection(request.app.state.db_pool)


@router.get("/screener")
async def screener(
    request:    Request,
    supercat:   str   = "",
    min_change: float = -999,
    max_change: float = 999,
    min_mcap:   float = 0,
    max_mcap:   float = 1e15,
    sort_by:    str   = "rank",
    sort_dir:   str   = "asc",
    limit:      int   = 100,
):
    """Screener con filtros sobre la tabla coins."""
    valid_sort   = {"rank","change_24h","change_7d","volume_24h","market_cap","price"}
    valid_dir    = {"asc","desc"}
    if sort_by  not in valid_sort:  sort_by  = "rank"
    if sort_dir not in valid_dir:   sort_dir = "asc"

    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT id, symbol, name, image, rank,
                   price, change_24h, change_7d, volume_24h, market_cap, supercat
            FROM coins
            WHERE rank IS NOT NULL
              AND ($1 = '' OR supercat = $1)
              AND (change_24h IS NULL OR change_24h BETWEEN $2 AND $3)
              AND (market_cap  IS NULL OR market_cap  BETWEEN $4 AND $5)
            ORDER BY {sort_by} {sort_dir} NULLS LAST
            LIMIT $6
        """, supercat, min_change, max_change, min_mcap, max_mcap, limit)

    return {
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
        "total": len(rows),
    }
