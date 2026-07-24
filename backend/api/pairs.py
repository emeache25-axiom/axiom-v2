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

# Columnas ordenables (whitelist: evita inyección SQL).
# La dirección la define el parámetro `dir`, no la columna.
_ORDEN = {
    "par":         "p.pair_symbol",
    "exchange":    "p.exchange",
    "precio":      "p.last_price",
    "volumen":     "p.volume_24h",
    "cambio":      "p.change_24h",
    "volatilidad": "p.volatility_30d",   # rango diario medio (principal)
    "desvio":      "p.volatility_std",   # desvío de retornos
    "repetible":   "p.range_days_pct",   # % días sobre umbral
    "spread":      "p.spread_pct",
    "velas":       "p.candles_count",
    "coin":        "c.name",
    "rank":        "c.rank",
}

# Dirección por defecto de cada columna (la que tiene más sentido al elegirla).
# Texto ascendente; métricas descendente; spread ascendente (menos es mejor).
_DIR_DEFAULT = {
    "par": "asc", "exchange": "asc", "coin": "asc",
    "spread": "asc", "rank": "asc",
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


@router.post("/sync-spread")
async def sync_spread(
    request: Request,
    min_volumen: float = Query(0, description="Solo pares de CoinEx sobre este volumen (0 = todos)"),
):
    """
    Trae los libros de órdenes de CoinEx para calcular el spread.
    Su ticker masivo no da bid/ask, así que hace falta una llamada por par:
    ~2 minutos para los 1.110 pares. MEXC ya lo trae en el ticker.
    """
    from backend.services import pairs_sync
    return await pairs_sync.sync_tickers(
        request.app.state.db_pool,
        con_spread_coinex=True,
        min_volumen_spread=min_volumen,
    )


@router.post("/sync-velas")
async def sync_velas(
    request: Request,
    min_volumen: float = Query(1000, description="Volumen 24h mínimo en USD"),
    umbral_rango: float = Query(3.0, description="% de rango que cuenta como 'día que se movió'"),
    limite: int = Query(0, description="Tope de pares (0 = todos)"),
):
    """
    Trae velas diarias de los pares sobre el umbral de volumen y calcula las
    tres métricas de volatilidad. Puede tardar varios minutos con el universo
    completo (~2.100 pares).
    """
    from backend.services import pair_ohlcv_sync
    return await pair_ohlcv_sync.sync_pair_ohlcv(
        request.app.state.db_pool,
        min_volumen=min_volumen,
        umbral_rango=umbral_rango,
        limite=limite or None,
    )


@router.get("/estado-velas")
async def estado_velas(request: Request):
    """Cuántas velas hay, de cuántos pares, y desde cuándo."""
    from backend.services import pair_ohlcv_sync
    return await pair_ohlcv_sync.estado(request.app.state.db_pool)


@router.get("/")
async def listar(
    request: Request,
    quote: str = Query("", description="Filtrar por moneda de cotización: BTC, USDT…"),
    exchange: str = Query("", description="Filtrar por exchange: mexc, coinex"),
    min_volumen: float = Query(0, description="Volumen 24h mínimo en USD"),
    max_spread: float = Query(0, description="Spread máximo en % (0 = sin filtro)"),
    min_volatilidad: float = Query(0, description="Rango diario promedio mínimo en %"),
    min_repetible: float = Query(0, description="% mínimo de días que superan el umbral de rango"),
    max_mcap: float = Query(0, description="Market cap máximo en USD (0 = sin filtro)"),
    supercat: str = Query("", description="Sector de la coin"),
    solo_con_info: bool = Query(False, description="Solo pares con coin identificada en CoinGecko"),
    solo_tradeables: bool = Query(True),
    orden: str = Query("volumen", description="par|exchange|precio|volumen|cambio|volatilidad|desvio|repetible|spread|velas|coin|rank"),
    dir: str = Query("", description="asc | desc (vacío = default de la columna)"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, description="Desde qué fila (paginación)"),
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
    if min_repetible > 0:
        where.append(f"p.range_days_pct >= {_arg(min_repetible)}")
    if solo_con_info:
        where.append("p.coin_id IS NOT NULL")
    if max_mcap > 0:
        where.append(f"(c.market_cap IS NULL OR c.market_cap <= {_arg(max_mcap)})")
    if supercat:
        where.append(f"c.supercat = {_arg(supercat)}")

    # ORDER BY: columna desde la whitelist, dirección validada.
    # NULLS LAST siempre, para que los pares sin métrica queden al final
    # independientemente del sentido.
    col = _ORDEN.get(orden, _ORDEN["volumen"])
    sentido = (dir or "").lower()
    if sentido not in ("asc", "desc"):
        sentido = _DIR_DEFAULT.get(orden, "desc")
    order_by = f"{col} {sentido.upper()} NULLS LAST"

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    # Total de coincidencias (sin paginar) — necesario para saber cuántas
    # páginas hay. Se cuenta con los mismos filtros que la consulta principal.
    sql_count = f"""
        SELECT COUNT(*)
        FROM pairs p
        LEFT JOIN coins c ON c.id = p.coin_id
        {where_sql}
    """

    sql = f"""
        SELECT p.id, p.exchange, p.pair_symbol, p.base, p.quote,
               p.last_price, p.volume_24h, p.change_24h, p.spread_pct,
               p.volatility_30d, p.volatility_std, p.range_days_pct, p.candles_count,
               p.coin_id, c.name, c.rank, c.market_cap, c.supercat, c.image
        FROM pairs p
        LEFT JOIN coins c ON c.id = p.coin_id
        {where_sql}
        ORDER BY {order_by}
        LIMIT {int(limit)} OFFSET {int(offset)}
    """

    async with pool.acquire() as conn:
        total = await conn.fetchval(sql_count, *args)
        rows = await conn.fetch(sql, *args)

    def _f(v):
        return float(v) if v is not None else None

    return {
        "total": total,                    # coincidencias totales (sin paginar)
        "mostrados": len(rows),            # filas en esta página
        "offset": offset,
        "limit": limit,
        "paginas": (total + limit - 1) // limit if total else 0,
        "pagina": offset // limit + 1 if limit else 1,
        "orden": orden,
        "dir": sentido,
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
            # Las tres métricas de volatilidad
            "volatilidad": _f(r["volatility_30d"]),      # rango diario medio (principal)
            "desvio": _f(r["volatility_std"]),           # desvío de retornos
            "dias_repetible_pct": _f(r["range_days_pct"]),  # % días sobre umbral
            "velas": r["candles_count"],
            # Info de la coin: presente si está en el catálogo de CoinGecko.
            # Muchos pares de MEXC/CoinEx no lo están (se conservan igual porque
            # siguen siendo operables) → tiene_info=false y coin=null.
            "tiene_info": r["coin_id"] is not None,
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
