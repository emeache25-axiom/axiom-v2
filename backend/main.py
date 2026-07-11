"""
AXIOM v2 — Punto de entrada de la aplicación.
"""
import os
import time
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.api.regime import router as regime_router
from backend.api.market import router as market_router
from backend.api.capital import router as capital_router
from backend.api.news import router as news_router
from backend.api.charts import router as charts_router
from backend.api.watchlist import router as watchlist_router
from backend.api.strat import router as strat_router
from backend.strat import load_strategies
from backend.api.alerts import router as alerts_router
from backend.api.bot import router as bot_router
from backend.scheduler.tasks import start_scheduler, stop_scheduler
from backend.api.orderbook import router as orderbook_router
from backend.api.prices import router as prices_router
from backend.services.price_stream import run_price_stream
from backend.api.candles import router as candles_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en .env")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Versión basada en el timestamp de arranque
# Cada restart del servicio invalida el cache del browser
_CACHE_VER = str(int(time.time()))


def _inject_version(html: str) -> str:
    """Agrega ?v=<timestamp> a todos los .css y .js del HTML."""
    import re
    html = re.sub(r'(href="/static/[^"]+\.css)"', rf'\1?v={_CACHE_VER}"', html)
    html = re.sub(r'(src="/static/[^"]+\.js)"',  rf'\1?v={_CACHE_VER}"', html)
    return html

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=1, max_size=5,
    )
    logging.info("[AXIOM v2] Pool de PostgreSQL inicializado")
    start_scheduler(app.state.db_pool)
    import asyncio
    from backend.services.orderbook_capture import run_capture
    from backend.services.price_stream import run_price_stream
    app.state.ob_task = asyncio.create_task(run_capture(app.state.db_pool))
    logging.info("[AXIOM v2] Capturador de order book iniciado")
    app.state.price_task = asyncio.create_task(run_price_stream(app.state.db_pool))
    logging.info("[AXIOM v2] Servicio de precio en vivo iniciado")
    yield
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
app.include_router(market_router)
app.include_router(capital_router)
app.include_router(news_router)
app.include_router(charts_router)
app.include_router(watchlist_router)
app.include_router(strat_router)
app.include_router(prices_router)
app.include_router(candles_router)
load_strategies()
app.include_router(alerts_router)
app.include_router(bot_router)
app.include_router(orderbook_router)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


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


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Sirve index.html con cache busting automático en cada restart."""
    html = (FRONTEND_DIR / "index.html").read_text()
    html = _inject_version(html)
    return HTMLResponse(html)
