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

    _scheduler.start()
    logger.info("[scheduler] Scheduler iniciado — snapshot cada 60 minutos")


def stop_scheduler() -> None:
    """Detiene el scheduler. Llamar al apagar la app."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[scheduler] Scheduler detenido")
