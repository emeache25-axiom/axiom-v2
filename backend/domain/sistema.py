"""
AXIOM — Capacidades de sistema.
════════════════════════════════════════════════════════════════════════════
Capacidades que no cuelgan de una entidad concreta (Coin, Par, Mercado,
Watchlist) sino que operan sobre el conjunto. Se declaran con entidad="sistema":
el registro les pasa el pool directamente, sin construir receptor.

Acá viven el screener de pares y la selección de activos sugeridos.

Ver AXIOM_registro_capacidades.md y AXIOM_principios_fundacionales.md.
"""
from __future__ import annotations
import logging

from backend.domain.registry import capacidad, Param

logger = logging.getLogger(__name__)


# Columnas por las que se puede ordenar. Espejo de _ORDEN en backend/api/pairs.py:
# el widget de la tabla ofrece ordenar por cualquier columna visible, así que
# ambas fuentes tienen que aceptar el mismo conjunto. Si divergen, ordenar por
# una columna desde el chat falla con 400.
_ORDEN_SQL = {
    "par":         "p.pair_symbol",
    "exchange":    "p.exchange",
    "precio":      "p.last_price",
    "volumen":     "p.volume_24h",
    "cambio":      "p.change_24h",
    "volatilidad": "p.volatility_30d",
    "desvio":      "p.volatility_std",
    "repetible":   "p.range_days_pct",
    "impulso":     "p.impulso_oh",
    "impulso_rep": "p.impulso_dias_pct",
    "spread":      "p.spread_pct",
    "velas":       "p.candles_count",
    "coin":        "c.name",
    "rank":        "c.rank",
}
# Sentido por defecto: texto ascendente, métricas descendente, spread y rank
# ascendente (menos es mejor).
_DIR_DEFAULT = {
    "par": "asc", "exchange": "asc", "coin": "asc",
    "spread": "asc", "rank": "asc",
}


@capacidad(
    nombre="buscar_pares",
    descripcion=(
        "Busca pares TRADEABLES en MEXC y CoinEx (unos 3.200) filtrando por "
        "moneda de cotización, exchange, volumen, volatilidad, repetibilidad, "
        "spread y capitalización de la coin. Ordenable por cualquiera de esas "
        "métricas. Es la herramienta indicada para encontrar pares que oscilan "
        "de forma repetible (range trading), pares que suben desde la apertura "
        "(impulso), pares con spread bajo, o pares de baja capitalización "
        "contra BTC. Trabaja sobre PARES OPERABLES, no "
        "sobre coins: un mismo activo puede aparecer en varios exchanges."
    ),
    entidad="sistema",
    categoria="par",
    costo="barato",
    devuelve=(
        "lista de pares con exchange, símbolo del par, precio, volumen 24h, "
        "variación 24h, las tres métricas de volatilidad (rango diario "
        "promedio, desvío de retornos, % de días sobre umbral), las dos de "
        "impulso (promedio open→high y % de días con impulso), spread, "
        "cantidad de velas, y datos de la coin si está identificada"
    ),
    mide=(
        "volumen 24h en USD y precio del ticker del exchange (refrescado cada "
        "15 min); rango diario promedio (high−low)/low % sobre las últimas 30 "
        "velas diarias; desvío estándar de los retornos diarios %; porcentaje "
        "de días cuyo rango superó el 3%; el impulso promedio "
        "(high−open)/open % —cuánto sube desde la apertura hasta el máximo— y "
        "el % de días con impulso sobre 1,5%; spread (ask−bid)/mid % del libro"
    ),
    infiere=(
        "nada — entrega métricas medidas, no lecturas. Ordenar por una métrica "
        "NO significa que los primeros sean mejores para operar: es solo el "
        "orden de esa métrica"
    ),
    no_sabe=(
        "si las métricas se sostendrán: son la foto de los últimos 30 días y "
        "un patrón puede romperse. Si hay liquidez suficiente para entrar o "
        "salir en tamaño: el volumen es del mercado entero, no de la "
        "profundidad del libro, y los pares con mejor spread suelen ser los de "
        "menor volumen. Si un par sin velas suficientes es poco volátil o "
        "simplemente nuevo. Tampoco sabe nada de las coins que no están en el "
        "catálogo de CoinGecko: esos pares aparecen sin capitalización ni sector"
    ),
    fuente=(
        "tabla `pairs` (catálogo cada 6 h, tickers cada 15 min, spread de "
        "CoinEx cada hora) y tabla `pair_ohlcv` (velas diarias, sync 00:30 UTC)"
    ),
    metodo=(
        "filtro y ORDER BY en SQL sobre métricas precalculadas por el sync de "
        "velas; el spread se toma del último libro capturado"
    ),
    parametros=[
        Param("quote", str,
              "Moneda de cotización del par. BTC para operar contra bitcoin.",
              opciones=("BTC", "USDT", "USDC", "ETH"), ejemplos=("BTC",)),
        Param("exchange", str, "Exchange donde opera el par.",
              opciones=("mexc", "coinex")),
        Param("min_volumen", float,
              "Volumen 24h mínimo en USD. Por defecto 1000.", default=1000.0),
        Param("min_volatilidad", float,
              "Rango diario promedio mínimo en % (ej. 5 = se mueve al menos 5% por día)."),
        Param("min_repetible", float,
              "Porcentaje mínimo de días que superan el umbral de rango "
              "(ej. 80 = osciló fuerte el 80% de los días)."),
        Param("min_impulso", float,
              "Impulso mínimo en %: cuánto sube en promedio desde la apertura "
              "hasta el máximo del día. A diferencia del rango, mide solo el "
              "tramo alcista."),
        Param("min_impulso_rep", float,
              "Porcentaje mínimo de días con impulso sobre el umbral "
              "(ej. 70 = subió desde la apertura el 70% de los días)."),
        Param("max_spread", float,
              "Spread máximo en % (ej. 0.05). Crítico para operar en rangos chicos."),
        Param("max_mcap", float,
              "Capitalización máxima de la coin en USD. Para baja capitalización, "
              "usar por ejemplo 100000000 (100 millones)."),
        Param("solo_con_info", bool,
              "Si es true, solo pares cuya coin está identificada en el catálogo.",
              default=False),
        Param("orden", str, "Métrica de ordenamiento.",
              opciones=tuple(_ORDEN_SQL), default="volumen"),
        Param("dir", str, "Sentido del orden.", opciones=("asc", "desc")),
        Param("limit", int, "Máximo de resultados (tope 50).", default=20),
    ],
)
async def buscar_pares(pool, quote=None, exchange=None, min_volumen=1000.0,
                       min_volatilidad=None, min_repetible=None, max_spread=None,
                       min_impulso=None, min_impulso_rep=None,
                       max_mcap=None, solo_con_info=False,
                       orden="volumen", dir=None, limit=20) -> dict:
    """Screener sobre el universo de pares tradeables."""
    where, args = ["p.tradeable"], []

    def _arg(v):
        args.append(v)
        return f"${len(args)}"

    if quote:
        where.append(f"p.quote = {_arg(quote.upper())}")
    if exchange:
        where.append(f"p.exchange = {_arg(exchange.lower())}")
    if min_volumen:
        where.append(f"p.volume_24h >= {_arg(float(min_volumen))}")
    if min_volatilidad:
        where.append(f"p.volatility_30d >= {_arg(float(min_volatilidad))}")
    if min_repetible:
        where.append(f"p.range_days_pct >= {_arg(float(min_repetible))}")
    if max_spread:
        where.append(f"p.spread_pct <= {_arg(float(max_spread))}")
    if min_impulso:
        where.append(f"p.impulso_oh >= {_arg(float(min_impulso))}")
    if min_impulso_rep:
        where.append(f"p.impulso_dias_pct >= {_arg(float(min_impulso_rep))}")
    if max_mcap:
        where.append(f"(c.market_cap IS NULL OR c.market_cap <= {_arg(float(max_mcap))})")
    if solo_con_info:
        where.append("p.coin_id IS NOT NULL")

    col = _ORDEN_SQL.get(orden, _ORDEN_SQL["volumen"])
    sentido = (dir or "").lower()
    if sentido not in ("asc", "desc"):
        sentido = _DIR_DEFAULT.get(orden, "desc")
    limit = max(1, min(int(limit or 20), 50))

    sql = f"""
        SELECT p.exchange, p.pair_symbol, p.base, p.quote,
               p.last_price, p.volume_24h, p.change_24h, p.spread_pct,
               p.volatility_30d, p.volatility_std, p.range_days_pct,
               p.impulso_oh, p.impulso_dias_pct,
               p.candles_count, p.coin_id, c.name, c.rank, c.market_cap, c.supercat
        FROM pairs p
        LEFT JOIN coins c ON c.id = p.coin_id
        WHERE {" AND ".join(where)}
        ORDER BY {col} {sentido.upper()} NULLS LAST
        LIMIT {limit}
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)

    def _f(v):
        return float(v) if v is not None else None

    pares = [{
        "exchange":    r["exchange"],
        "par":         r["pair_symbol"],
        "base":        r["base"],
        "quote":       r["quote"],
        "precio":      _f(r["last_price"]),
        "volumen_24h": _f(r["volume_24h"]),
        "cambio_24h":  _f(r["change_24h"]),
        "spread_pct":  _f(r["spread_pct"]),
        "rango_diario_pct":   _f(r["volatility_30d"]),
        "desvio_retornos_pct": _f(r["volatility_std"]),
        "dias_repetible_pct": _f(r["range_days_pct"]),
        "impulso_pct":        _f(r["impulso_oh"]),
        "impulso_dias_pct":   _f(r["impulso_dias_pct"]),
        "velas":       r["candles_count"],
        "coin": {
            "id": r["coin_id"], "nombre": r["name"], "rank": r["rank"],
            "market_cap": _f(r["market_cap"]), "sector": r["supercat"],
        } if r["coin_id"] else None,
    } for r in rows]

    return {
        "total": len(pares),
        "orden": f"{orden} {sentido}",
        "pares": pares,
    }


@capacidad(
    nombre="coins_sugeridas",
    descripcion=(
        "Las coins que AXIOM sugiere hoy según el régimen de mercado vigente, "
        "en tres canastas por horizonte temporal: largo plazo (12-36 meses), "
        "medio plazo (2-12 semanas) y corto plazo (horas a días). Incluye el "
        "contexto del régimen, nivel de riesgo y notas operativas. Usar cuando "
        "se pregunte qué mirar o qué sugiere el sistema."
    ),
    entidad="sistema",
    categoria="mercado",
    costo="medio",
    devuelve=(
        "tres canastas (largo, medio, corto) con sus coins, más el régimen que "
        "las motiva, el nivel de riesgo y notas operativas por horizonte"
    ),
    mide=(
        "el régimen vigente de cada temporalidad, y el precio, capitalización, "
        "volumen y variaciones de las coins del top 300 sobre las que se aplica "
        "el criterio de selección"
    ),
    infiere=(
        "la selección ENTERA es una inferencia: qué coins entran en cada "
        "canasta se decide con reglas heurísticas condicionadas al régimen "
        "(por ejemplo, en régimen de acumulación prioriza capitalización alta). "
        "Esas reglas son un criterio elegido, no un resultado medido"
    ),
    no_sabe=(
        "si las coins sugeridas van a rendir: la selección responde al régimen "
        "actual, no a una predicción de precio. No incorpora noticias, "
        "fundamentos del proyecto ni eventos de calendario. No es una "
        "recomendación de compra: es una lista de candidatas a analizar, y la "
        "decisión es del operador"
    ),
    fuente="tabla `coins` (top 300, sync cada 6 h) y tabla `snapshots` (job horario)",
    metodo=(
        "reglas heurísticas por temporalidad condicionadas al régimen vigente, "
        "aplicadas sobre el top 300 por capitalización"
    ),
)
async def coins_sugeridas(pool) -> dict:
    """Canastas sugeridas según el régimen vigente."""
    from backend.services.selection_service import get_asset_selection
    return await get_asset_selection(pool)
