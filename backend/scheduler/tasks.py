"""
Scheduler de AXIOM v2.

Ejecuta tareas periódicas:
  - build_snapshot() cada 60 minutos → genera y guarda el régimen
"""
from __future__ import annotations
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def _run_sync_prices(pool) -> None:
    """Tarea periódica: sincroniza precios de coins."""
    from backend.services.coins_sync import sync_prices
    try:
        logger.info("[scheduler] Sincronizando precios de coins...")
        result = await sync_prices(pool)
        logger.info(f"[scheduler] Sync precios OK: {result['updated']} coins")
    except Exception as exc:
        logger.error(f"[scheduler] Error en sync precios: {exc}")


async def _run_sync_categories(pool) -> None:
    """Tarea semanal: sincroniza categorías de coins via scraping."""
    from backend.services.coins_sync import sync_categories
    try:
        logger.info("[scheduler] Sincronizando categorías de coins (scraping)...")
        result = await sync_categories(pool)
        logger.info(f"[scheduler] Sync categorías OK: {result['updated']} coins, {result['errors']} errores")
    except Exception as exc:
        logger.error(f"[scheduler] Error en sync categorías: {exc}")


async def _run_ohlcv_incremental(pool) -> None:
    """
    OBSOLETO — job desactivado (ver start_scheduler).
    Pedía ~2.400 coins de a una a CoinGecko contra un límite de ~30/min:
    nunca completaba. Reemplazado por _run_sync_pair_ohlcv.
    Se elimina junto con ohlcv_sync.py al cerrar la migración.
    """
    from backend.services.ohlcv_sync import sync_incremental
    try:
        logger.info("[scheduler] Iniciando sync OHLCV incremental...")
        result = await sync_incremental(pool)
        logger.info(f"[scheduler] OHLCV incremental OK: {result['inserted']} filas para {result['date']}, {result['errors']} errores")
    except Exception as exc:
        logger.error(f"[scheduler] Error en OHLCV incremental: {exc}")


async def _run_ohlcv_full_bg(pool) -> None:
    """
    OBSOLETO — job desactivado (ver start_scheduler).
    Además, su chequeo de cobertura medía cuántas coins tenían ALGUNA fila,
    no si los datos estaban frescos: daba 95,6% con 13 días de retraso.
    """
    from backend.services.ohlcv_sync import sync_full, get_sync_status
    try:
        status = await get_sync_status(pool)
        if status["coverage_pct"] >= 80:
            logger.info(f"[scheduler] OHLCV ya tiene {status['coverage_pct']}% cobertura — skip full sync")
            return
        logger.info(f"[scheduler] OHLCV cobertura {status['coverage_pct']}% — iniciando sync_full en background")
        result = await sync_full(pool)
        logger.info(f"[scheduler] OHLCV sync_full completado: {result['processed']} coins, {result['inserted']} filas")
    except Exception as exc:
        logger.error(f"[scheduler] Error en OHLCV sync_full: {exc}")


async def _run_sync_pairs(pool) -> None:
    """
    Cada 6 h: refresca el catálogo de pares tradeables de MEXC/CoinEx y los
    vincula con el catálogo de coins. Solo 2 llamadas (una por exchange).
    """
    from backend.services.pairs_sync import sync_pairs, vincular_coins
    try:
        logger.info("[scheduler] Sincronizando catálogo de pares...")
        r = await sync_pairs(pool)
        v = await vincular_coins(pool)
        logger.info(
            f"[scheduler] Pares OK: {r.get('procesados', 0)} procesados, "
            f"{r.get('deslistados', 0)} deslistados · "
            f"{v.get('vinculados', 0)} con coin, {v.get('sin_vinculo', 0)} sin coin"
        )
    except Exception as exc:
        logger.error(f"[scheduler] Error en sync de pares: {exc}")


async def _run_sync_tickers(pool) -> None:
    """
    Cada 15 min: refresca precio, volumen 24h, variación y spread de TODOS los
    pares. Solo 2 llamadas — es lo que mantiene vivo el ranking del screener.
    """
    from backend.services.pairs_sync import sync_tickers
    try:
        r = await sync_tickers(pool)
        logger.info(f"[scheduler] Tickers OK: {r.get('actualizados', 0)} pares")
    except Exception as exc:
        logger.error(f"[scheduler] Error en sync de tickers: {exc}")


async def _run_sync_pair_ohlcv(pool) -> None:
    """
    Diario (00:30 UTC): velas diarias de los pares con volumen sobre el umbral,
    desde los exchanges. Recalcula las tres métricas de volatilidad que ordenan
    el screener. Tarda ~2-3 min para ~2.100 pares.
    """
    from backend.services.pair_ohlcv_sync import sync_pair_ohlcv
    try:
        logger.info("[scheduler] Iniciando sync de velas por par...")
        r = await sync_pair_ohlcv(pool)
        logger.info(
            f"[scheduler] Velas OK: {r.get('ok', 0)}/{r.get('procesados', 0)} pares "
            f"con velas, {r.get('sin_velas', 0)} sin datos"
        )
    except Exception as exc:
        logger.error(f"[scheduler] Error en sync de velas por par: {exc}")


async def _run_snapshot(pool) -> None:
    """Tarea periódica: construye y guarda un snapshot del régimen."""
    from backend.services.snapshot import build_snapshot
    try:
        logger.info("[scheduler] Construyendo snapshot...")
        snap = await build_snapshot(pool)
        r = snap["regimes"]
        logger.info(
            f"[scheduler] Snapshot #{snap['snapshot_id']} guardado — "
            f"BTC ${snap['btc_price']:,.0f} | "
            f"L:{r['largo']['regime']} {r['largo']['conviction']}% | "
            f"M:{r['medio']['regime']} {r['medio']['conviction']}% | "
            f"C:{r['corto']['regime']} {r['corto']['conviction']}%"
        )
    except Exception as exc:
        logger.error(f"[scheduler] Error en snapshot: {exc}")


async def _run_evaluate_alerts(pool) -> None:
    """Evalúa alertas de precio y notifica por Telegram."""
    from backend.services.alert_service import evaluate_alerts
    try:
        result = await evaluate_alerts(pool)
        if result["triggered"]:
            logger.info(f"[scheduler] Alertas: {result['triggered']} disparada(s)")
    except Exception as exc:
        logger.error(f"[scheduler] Error evaluando alertas: {exc}")


async def _run_bot_cycle(pool) -> None:
    """Ciclo del bot de paper-trading."""
    from backend.services.bot_service import run_bot_cycle
    try:
        await run_bot_cycle(pool)
    except Exception as exc:
        logger.error(f"[scheduler] Error en bot: {exc}")


async def _run_strat_cycle(pool) -> None:
    """Ciclo del bot v2 (estrategias paper-trading)."""
    from backend.strat.execution_engine import run_cycle
    try:
        await run_cycle(pool)
    except Exception as exc:
        logger.error(f"[scheduler] Error en bot v2: {exc}")


def start_scheduler(pool) -> None:
    """
    Inicia el scheduler. Llamar una vez al arranque de la app.

    Args:
        pool: asyncpg connection pool (de app.state.db_pool)
    """
    global _scheduler

    _scheduler = AsyncIOScheduler()

    # Snapshot cada 60 minutos
    _scheduler.add_job(
        _run_snapshot,
        trigger="interval",
        minutes=60,
        args=[pool],
        id="snapshot_job",
        name="Régimen snapshot",
        misfire_grace_time=300,   # si se perdió, tiene 5 min para ejecutarse
        coalesce=True,            # si se acumularon, ejecutar solo una vez
    )
    # Evaluar alertas de precio cada 1 minuto
    _scheduler.add_job(
        _run_evaluate_alerts,
        trigger="interval",
        minutes=1,
        args=[pool],
        id="alerts_job",
        name="Evaluar alertas de precio",
        misfire_grace_time=30,
        coalesce=True,
    )
    # Bot de paper-trading cada 5 minutos
    _scheduler.add_job(
        _run_bot_cycle,
        trigger="interval",
        minutes=5,
        args=[pool],
        id="bot_job",
        name="Bot paper-trading",
        misfire_grace_time=60,
        coalesce=True,
    )

    # Sync precios cada 6 horas
    _scheduler.add_job(
        _run_sync_prices,
        trigger="interval",
        hours=6,
        args=[pool],
        id="sync_prices_job",
        name="Sync precios coins",
        misfire_grace_time=300,
        coalesce=True,
    )

    # Sync categorías cada 7 días
    _scheduler.add_job(
        _run_sync_categories,
        trigger="interval",
        days=7,
        args=[pool],
        id="sync_categories_job",
        name="Sync categorías coins",
        misfire_grace_time=600,
        coalesce=True,
    )

    # ── OHLCV de coins en USD (CoinGecko) — DESACTIVADO ──────────────────────
    # El sync incremental pedía ~2.400 coins de a UNA a CoinGecko (límite
    # ~30/min): nunca terminaba y devolvía 0 filas con 2.392 errores diarios.
    # Reemplazado por el sync de velas POR PAR desde los exchanges (abajo).
    # Se elimina junto con ohlcv_sync.py cuando termine la migración de los
    # screeners a pair_ohlcv. Ver AXIOM_modelo_pares.md §6.2.
    #
    # _scheduler.add_job(
    #     _run_ohlcv_incremental, trigger="cron", hour=0, minute=1,
    #     timezone="UTC", args=[pool], id="ohlcv_incremental_job",
    #     name="OHLCV sync diario", misfire_grace_time=1800, coalesce=True,
    # )
    # _asyncio.get_event_loop().create_task(_run_ohlcv_full_bg(pool))

    # ── PARES (el universo tradeable) ────────────────────────────────────────

    # Catálogo de pares cada 6 h — 2 llamadas
    _scheduler.add_job(
        _run_sync_pairs,
        trigger="interval",
        hours=6,
        args=[pool],
        id="sync_pairs_job",
        name="Sync catálogo de pares",
        misfire_grace_time=600,
        coalesce=True,
    )

    # Tickers cada 15 min — 2 llamadas; mantiene vivo el ranking
    _scheduler.add_job(
        _run_sync_tickers,
        trigger="interval",
        minutes=15,
        args=[pool],
        id="sync_tickers_job",
        name="Sync tickers de pares",
        misfire_grace_time=300,
        coalesce=True,
    )

    # Velas por par + métricas de volatilidad — diario 00:30 UTC
    _scheduler.add_job(
        _run_sync_pair_ohlcv,
        trigger="cron",
        hour=0,
        minute=30,
        timezone="UTC",
        args=[pool],
        id="sync_pair_ohlcv_job",
        name="Velas por par (screener)",
        misfire_grace_time=3600,
        coalesce=True,
    )

    # Bot v2 — ciclo de estrategias cada 5 minutos
    _scheduler.add_job(
        _run_strat_cycle,
        trigger="interval",
        minutes=5,
        args=[pool],
        id="strat_job",
        name="Bot v2 estrategias",
        misfire_grace_time=60,
        coalesce=True,
    )
    _scheduler.start()
    logger.info(
        "[scheduler] Scheduler iniciado — snapshot/60min · alertas/1min · "
        "bots/5min · precios coins/6h · categorías/7d · "
        "pares/6h · tickers/15min · velas por par/00:30UTC"
    )


def stop_scheduler() -> None:
    """Detiene el scheduler. Llamar al apagar la app."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[scheduler] Scheduler detenido")
