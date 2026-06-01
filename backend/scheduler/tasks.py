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

    _scheduler.start()
    logger.info("[scheduler] Scheduler iniciado — snapshot/60min · precios/6h · categorías/7d")


def stop_scheduler() -> None:
    """Detiene el scheduler. Llamar al apagar la app."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[scheduler] Scheduler detenido")
