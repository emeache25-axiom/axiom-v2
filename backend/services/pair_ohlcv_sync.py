"""
AXIOM v2 — Sincronización de VELAS por par y métricas de volatilidad.
════════════════════════════════════════════════════════════════════════════
Trae velas diarias de los pares tradeables desde MEXC/CoinEx (rápidos, con
volumen real) y calcula las métricas que ordenan el screener.

TRES MÉTRICAS DE VOLATILIDAD (las tres se calculan y persisten):

  1. volatility_30d   — RANGO DIARIO PROMEDIO: media de (high-low)/low × 100.
                        MÉTRICA PRINCIPAL de ordenamiento. Responde "¿cuánto se
                        mueve un día típico?".
  2. volatility_std   — DESVÍO DE RETORNOS: desviación estándar de los retornos
                        diarios × 100. La volatilidad estadística clásica;
                        penaliza los saltos bruscos.
  3. range_days_pct   — % DE DÍAS SOBRE UMBRAL: qué porcentaje de los últimos
                        30 días tuvo un rango mayor a `umbral_rango`. Mide la
                        REPETIBILIDAD de la oscilación — el criterio más fiel
                        para range trading.

Alcance: pares con volume_24h por encima del umbral (configurable, 10.000 USD
por defecto). Con ~2.100 pares y exchanges que permiten cientos de llamadas por
minuto, el sync tarda minutos — no las horas imposibles de CoinGecko.

Ver AXIOM_modelo_pares.md.
"""
from __future__ import annotations
import asyncio
import logging
import statistics
from datetime import datetime, timezone

from backend.exchanges import get_adapter

logger = logging.getLogger(__name__)

# Cuántas velas diarias traer y sobre cuántas calcular las métricas
DIAS_HISTORIA = 60          # se guardan
DIAS_METRICAS = 30          # se analizan
MIN_VELAS = 10              # mínimo para que las métricas signifiquen algo

# Umbral por defecto para range_days_pct: % de rango que cuenta como "se movió"
UMBRAL_RANGO_DEFAULT = 3.0

# Concurrencia: cuántos pares se piden a la vez por exchange.
# Los exchanges permiten cientos por minuto; 8 es conservador y estable.
CONCURRENCIA = 8


# ══ Cálculo de métricas ═══════════════════════════════════════════════════════

def calcular_metricas(velas: list[dict], umbral_rango: float = UMBRAL_RANGO_DEFAULT) -> dict:
    """
    Calcula las tres métricas sobre las últimas DIAS_METRICAS velas.
    Devuelve None en las que no se puedan calcular (pocas velas, datos inválidos).
    """
    vals = velas[-DIAS_METRICAS:] if len(velas) > DIAS_METRICAS else velas
    if len(vals) < MIN_VELAS:
        return {"volatility_30d": None, "volatility_std": None,
                "range_days_pct": None, "candles_count": len(velas)}

    rangos = []       # (high-low)/low × 100 por vela
    retornos = []     # (close_hoy - close_ayer)/close_ayer por vela
    prev_close = None

    for v in vals:
        try:
            hi, lo, cl = float(v["high"]), float(v["low"]), float(v["close"])
        except (TypeError, ValueError, KeyError):
            continue
        if lo > 0 and hi >= lo:
            rangos.append((hi - lo) / lo * 100.0)
        if prev_close and prev_close > 0 and cl > 0:
            retornos.append((cl - prev_close) / prev_close)
        prev_close = cl

    if not rangos:
        return {"volatility_30d": None, "volatility_std": None,
                "range_days_pct": None, "candles_count": len(velas)}

    # 1) Rango diario promedio (métrica principal)
    rango_medio = sum(rangos) / len(rangos)

    # 2) Desvío estándar de los retornos diarios, en %
    std = statistics.stdev(retornos) * 100.0 if len(retornos) >= 2 else None

    # 3) % de días cuyo rango supera el umbral
    dias_ok = sum(1 for r in rangos if r >= umbral_rango)
    pct_ok = dias_ok / len(rangos) * 100.0

    return {
        "volatility_30d": round(rango_medio, 4),
        "volatility_std": round(std, 4) if std is not None else None,
        "range_days_pct": round(pct_ok, 2),
        "candles_count": len(velas),
    }


# ══ Descarga de velas ═════════════════════════════════════════════════════════

async def _traer_velas(exchange: str, pair_symbol: str) -> list[dict]:
    """Velas diarias de un par, vía el adaptador del exchange."""
    try:
        adapter = get_adapter(exchange)
        velas = await adapter.get_ohlcv(pair_symbol, "1d", limit=DIAS_HISTORIA)
        # Orden cronológico ascendente (algunos exchanges devuelven al revés)
        if velas and len(velas) > 1 and velas[0]["time"] > velas[-1]["time"]:
            velas = list(reversed(velas))
        return velas or []
    except Exception as e:
        logger.debug("[pair_ohlcv] %s:%s → %s", exchange, pair_symbol, e)
        return []


async def _procesar_par(sem, pool, par: dict, umbral_rango: float) -> str:
    """Trae velas de un par, las persiste y actualiza sus métricas."""
    async with sem:
        velas = await _traer_velas(par["exchange"], par["pair_symbol"])

    if not velas:
        return "sin_velas"

    filas = []
    for v in velas:
        try:
            fecha = datetime.fromtimestamp(int(v["time"]), tz=timezone.utc).date()
            filas.append((
                par["id"], fecha,
                v.get("open"), v.get("high"), v.get("low"), v.get("close"),
                v.get("volume"),
            ))
        except Exception:
            continue

    if not filas:
        return "sin_velas"

    metricas = calcular_metricas(velas, umbral_rango)

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany("""
                INSERT INTO pair_ohlcv (pair_id, date, open, high, low, close, volume)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (pair_id, date) DO UPDATE SET
                    open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
                    close=EXCLUDED.close, volume=EXCLUDED.volume
            """, filas)

            await conn.execute("""
                UPDATE pairs SET
                    volatility_30d = $2,
                    volatility_std = $3,
                    range_days_pct = $4,
                    candles_count  = $5,
                    updated_at     = now()
                WHERE id = $1
            """, par["id"], metricas["volatility_30d"], metricas["volatility_std"],
                 metricas["range_days_pct"], metricas["candles_count"])

    return "ok"


# ══ Sync completo ═════════════════════════════════════════════════════════════

async def sync_pair_ohlcv(pool, min_volumen: float = 10_000.0,
                          umbral_rango: float = UMBRAL_RANGO_DEFAULT,
                          limite: int | None = None) -> dict:
    """
    Sincroniza velas diarias de los pares con volumen por encima del umbral.

    min_volumen  — volumen 24h mínimo en USD (configurable por el usuario)
    umbral_rango — % de rango que cuenta como "día que se movió" (para
                   range_days_pct)
    limite       — tope de pares a procesar (útil para pruebas)
    """
    async with pool.acquire() as conn:
        sql = """
            SELECT id, exchange, pair_symbol
            FROM pairs
            WHERE tradeable AND volume_24h >= $1
            ORDER BY volume_24h DESC NULLS LAST
        """
        if limite:
            sql += f" LIMIT {int(limite)}"
        pares = [dict(r) for r in await conn.fetch(sql, min_volumen)]

    if not pares:
        logger.warning("[pair_ohlcv] ningún par supera el umbral de %s USD", min_volumen)
        return {"procesados": 0, "ok": 0, "sin_velas": 0}

    logger.info("[pair_ohlcv] sincronizando %s pares (volumen >= %s)",
                len(pares), min_volumen)

    sem = asyncio.Semaphore(CONCURRENCIA)
    tareas = [_procesar_par(sem, pool, p, umbral_rango) for p in pares]
    resultados = await asyncio.gather(*tareas, return_exceptions=True)

    ok = sum(1 for r in resultados if r == "ok")
    sin_velas = sum(1 for r in resultados if r == "sin_velas")
    errores = sum(1 for r in resultados if isinstance(r, Exception))

    logger.info("[pair_ohlcv] completado: %s con velas · %s sin velas · %s errores",
                ok, sin_velas, errores)

    return {"procesados": len(pares), "ok": ok,
            "sin_velas": sin_velas, "errores": errores}


async def estado(pool) -> dict:
    """Resumen del estado de las velas, para inspección."""
    async with pool.acquire() as conn:
        return dict(await conn.fetchrow("""
            SELECT
                (SELECT COUNT(*) FROM pair_ohlcv)                          AS filas,
                (SELECT COUNT(DISTINCT pair_id) FROM pair_ohlcv)           AS pares_con_velas,
                (SELECT MIN(date) FROM pair_ohlcv)                         AS desde,
                (SELECT MAX(date) FROM pair_ohlcv)                         AS hasta,
                (SELECT COUNT(*) FROM pairs WHERE volatility_30d IS NOT NULL) AS con_metricas
        """))
