"""
AXIOM v2 — Order Book API.

Endpoints para la sección de microestructura (dentro de la pantalla BOT):
  GET /api/orderbook/pairs           → pares que se están capturando + estado
  GET /api/orderbook/latest/{pair}   → último snapshot (libro completo, N niveles)
  GET /api/orderbook/series/{pair}   → serie temporal de spread/imbalance/mid

Lee de la tabla ob_snapshots (poblada por el capturador WebSocket de CoinEx).
Los precios se exponen en SATOSHIS (×1e8) para legibilidad en pares /BTC.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request, Query, HTTPException
from typing import Optional

router = APIRouter(prefix="/api/orderbook", tags=["orderbook"])

_SAT = 1e8  # 1 BTC = 1e8 satoshis


def _to_sat(v):
    return round(v * _SAT, 4) if v is not None else None


@router.get("/pairs")
async def get_pairs(request: Request):
    """Pares capturados, con conteo y último timestamp (estado de la captura)."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT pair,
                   count(*)            AS snapshots,
                   min(ts)             AS first_ts,
                   max(ts)             AS last_ts
            FROM ob_snapshots
            GROUP BY pair
            ORDER BY pair
        """)
    return {"pairs": [
        {
            "pair":      r["pair"],
            "snapshots": r["snapshots"],
            "first_ts":  r["first_ts"].isoformat() if r["first_ts"] else None,
            "last_ts":   r["last_ts"].isoformat()  if r["last_ts"]  else None,
        }
        for r in rows
    ]}


@router.get("/latest/{pair}")
async def get_latest(request: Request, pair: str):
    """Último snapshot de un par: libro completo (N niveles) + métricas.
    Precios en satoshis para legibilidad."""
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM ob_snapshots
            WHERE pair = $1
            ORDER BY ts DESC
            LIMIT 1
        """, pair.upper())
    if not row:
        raise HTTPException(status_code=404, detail=f"Sin datos para {pair}")

    def _levels(raw):
        if not raw:
            return []
        data = json.loads(raw) if isinstance(raw, str) else raw
        out = []
        for lvl in data:
            try:
                out.append({"price_sat": round(float(lvl[0]) * _SAT, 4),
                            "volume":    float(lvl[1])})
            except (TypeError, ValueError, IndexError):
                continue
        return out

    return {
        "pair":       row["pair"],
        "ts":         row["ts"].isoformat(),
        "best_bid":   _to_sat(row["best_bid"]),
        "best_ask":   _to_sat(row["best_ask"]),
        "mid":        _to_sat(row["mid"]),
        "spread_pct": round(row["spread_pct"], 4) if row["spread_pct"] is not None else None,
        "imbalance":  round(row["imbalance"], 4)  if row["imbalance"]  is not None else None,
        "bids":       _levels(row["bids"]),
        "asks":       _levels(row["asks"]),
    }


@router.get("/series/{pair}")
async def get_series(
    request: Request,
    pair: str,
    minutes: int = Query(60, ge=1, le=1440),   # ventana hacia atrás, default 1h
    max_points: int = Query(300, ge=10, le=2000),
):
    """Serie temporal de spread, imbalance y mid para graficar.
    Submuestrea si hay más puntos que max_points (para no saturar el front)."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ts, mid, spread_pct, imbalance
            FROM ob_snapshots
            WHERE pair = $1 AND ts > now() - ($2 || ' minutes')::interval
            ORDER BY ts ASC
        """, pair.upper(), str(minutes))

    # submuestreo uniforme si hay demasiados puntos
    if len(rows) > max_points:
        step = len(rows) / max_points
        rows = [rows[int(i * step)] for i in range(max_points)]

    return {
        "pair": pair.upper(),
        "points": [
            {
                "ts":        r["ts"].isoformat(),
                "mid_sat":   _to_sat(r["mid"]),
                "spread_pct": round(r["spread_pct"], 4) if r["spread_pct"] is not None else None,
                "imbalance": round(r["imbalance"], 4)   if r["imbalance"]  is not None else None,
            }
            for r in rows
        ],
    }
