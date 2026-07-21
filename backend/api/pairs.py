"""
AXIOM v2 — API del catálogo de PARES.
════════════════════════════════════════════════════════════════════════════
Endpoints sobre la tabla `pairs`: el universo de lo que se puede operar.

  GET  /api/pairs/estado   → resumen del catálogo
  POST /api/pairs/sync     → refrescar catálogo + tickers + vínculos (manual)
  GET  /api/pairs/         → listado filtrable y ordenable (base del screener)
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, Request, Query

from backend.services import pairs_sync

router = APIRouter(prefix="/api/pairs", tags=["pairs"])
logger = logging.getLogger(__name__)

# Columnas por las que se puede ordenar (whitelist: evita inyección)
_ORDEN = {
    "volumen":     "p.volume_24h DESC NULLS LAST",
    "volatilidad": "p.volatility_30d DESC NULLS LAST",
    "spread":      "p.spread_pct ASC NULLS LAST",
    "cambio":      "p.change_24h DESC NULLS LAST",
    "rank":        "c.rank ASC NULLS LAST",
}


@router.get("/estado")
async def estado(request: Request):
    """Resumen del catálogo: cuántos pares hay, cuántos vinculados, etc."""
    return await pairs_sync.estado(request.app.state.db_pool)


@router.post("/sync")
async def sync(request: Request, tickers: bool = True, vincular: bool = True):
    """
    Refresca el catálogo. Por defecto hace las tres cosas:
    catálogo de pares → tickers (volumen/precio/spread) → vínculo con coins.
    """
    pool = request.app.state.db_pool
    out = {"pairs": await pairs_sync.sync_pairs(pool)}
    if tickers:
        out["tickers"] = await pairs_sync.sync_tickers(pool)
    if vincular:
        out["vinculos"] = await pairs_sync.vincular_coins(pool)
    out["estado"] = await pairs_sync.estado(pool)
    return out


@router.get("/")
async def listar(
    request: Request,
    quote: str = Query("", description="Filtrar por moneda de cotización: BTC, USDT…"),
    exchange: str = Query("", description="Filtrar por exchange: mexc, coinex"),
    min_volumen: float = Query(0, description="Volumen 24h mínimo en USD"),
    max_spread: float = Query(0, description="Spread máximo en % (0 = sin filtro)"),
    min_volatilidad: float = Query(0, description="Volatilidad 30d mínima en %"),
    max_mcap: float = Query(0, description="Market cap máximo en USD (0 = sin filtro)"),
    supercat: str = Query("", description="Sector de la coin"),
    solo_tradeables: bool = Query(True),
    orden: str = Query("volumen", description="volumen | volatilidad | spread | cambio | rank"),
    limit: int = Query(50, ge=1, le=500),
):
    """
    Listado de pares con la metadata de su coin. Es la base del screener:
    filtra por atributos del PAR (volumen, spread, volatilidad, quote) y de la
    COIN (market cap, sector) en una sola consulta.
    """
    pool = request.app.state.db_pool
    where, args = [], []

    def _arg(v):
        args.append(v)
        return f"${len(args)}"

    if solo_tradeables:
        where.append("p.tradeable")
    if quote:
        where.append(f"p.quote = {_arg(quote.upper())}")
    if exchange:
        where.append(f"p.exchange = {_arg(exchange.lower())}")
    if min_volumen > 0:
        where.append(f"p.volume_24h >= {_arg(min_volumen)}")
    if max_spread > 0:
        where.append(f"p.spread_pct <= {_arg(max_spread)}")
    if min_volatilidad > 0:
        where.append(f"p.volatility_30d >= {_arg(min_volatilidad)}")
    if max_mcap > 0:
        where.append(f"(c.market_cap IS NULL OR c.market_cap <= {_arg(max_mcap)})")
    if supercat:
        where.append(f"c.supercat = {_arg(supercat)}")

    sql = f"""
        SELECT p.id, p.exchange, p.pair_symbol, p.base, p.quote,
               p.last_price, p.volume_24h, p.change_24h, p.spread_pct,
               p.volatility_30d, p.range_days_pct, p.candles_count,
               p.coin_id, c.name, c.rank, c.market_cap, c.supercat, c.image
        FROM pairs p
        LEFT JOIN coins c ON c.id = p.coin_id
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY {_ORDEN.get(orden, _ORDEN["volumen"])}
        LIMIT {int(limit)}
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)

    def _f(v):
        return float(v) if v is not None else None

    return {
        "total": len(rows),
        "orden": orden,
        "pares": [{
            "id": r["id"],
            "exchange": r["exchange"],
            "par": r["pair_symbol"],
            "base": r["base"],
            "quote": r["quote"],
            "precio": _f(r["last_price"]),
            "volumen_24h": _f(r["volume_24h"]),
            "cambio_24h": _f(r["change_24h"]),
            "spread_pct": _f(r["spread_pct"]),
            "volatilidad_30d": _f(r["volatility_30d"]),
            "dias_con_rango_pct": _f(r["range_days_pct"]),
            "velas": r["candles_count"],
            "coin": {
                "id": r["coin_id"],
                "nombre": r["name"],
                "rank": r["rank"],
                "market_cap": _f(r["market_cap"]),
                "sector": r["supercat"],
                "image": r["image"],
            } if r["coin_id"] else None,
        } for r in rows],
    }
