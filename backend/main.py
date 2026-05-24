"""
AXIOM v2 — Punto de entrada de la aplicación.
"""
import os
import logging
from contextlib import asynccontextmanager

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from backend.api.regime import router as regime_router
from backend.scheduler.tasks import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en .env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.db_pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=1, max_size=5,
    )
    logging.info("[AXIOM v2] Pool de PostgreSQL inicializado")
    start_scheduler(app.state.db_pool)
    yield
    # Shutdown
    stop_scheduler()
    await app.state.db_pool.close()
    logging.info("[AXIOM v2] Pool de PostgreSQL cerrado")


app = FastAPI(
    title="AXIOM v2",
    description="Cockpit personal de trading profesional",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(regime_router)


@app.get("/")
async def root():
    return {"name": "AXIOM v2", "status": "online", "version": "0.1.0"}


@app.get("/health/db")
async def db_health():
    async with app.state.db_pool.acquire() as conn:
        result = await conn.fetchrow(
            "SELECT current_database() AS db, current_user AS usr, version() AS version"
        )
    return JSONResponse({
        "database": result["db"],
        "user":     result["usr"],
        "version":  result["version"].split(" on ")[0],
    })
