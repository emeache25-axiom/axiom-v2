"""
AXIOM v2 — Punto de entrada de la aplicación.
"""
import os
from contextlib import asynccontextmanager

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse

# Cargar variables de entorno desde .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en .env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Maneja el ciclo de vida del pool de conexiones a PostgreSQL."""
    # Startup: crear pool de conexiones
    app.state.db_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=1,
        max_size=5,
    )
    print("[AXIOM v2] Pool de PostgreSQL inicializado")
    yield
    # Shutdown: cerrar pool
    await app.state.db_pool.close()
    print("[AXIOM v2] Pool de PostgreSQL cerrado")


app = FastAPI(
    title="AXIOM v2",
    description="Cockpit personal de trading profesional",
    version="0.0.1",
    lifespan=lifespan,
)


@app.get("/")
async def root():
    """Health check básico."""
    return {
        "name": "AXIOM v2",
        "status": "online",
        "version": "0.0.1",
    }


@app.get("/health/db")
async def db_health():
    """Verifica que PostgreSQL responde."""
    async with app.state.db_pool.acquire() as conn:
        result = await conn.fetchrow(
            "SELECT current_database() AS db, current_user AS user, version() AS version"
        )
    return JSONResponse({
        "database": result["db"],
        "user": result["user"],
        "version": result["version"].split(" on ")[0],
    })
