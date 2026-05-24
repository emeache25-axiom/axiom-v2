"""
Capa 4 — API del módulo Régimen.

Endpoints:
  GET /api/regime/current  → snapshot actual (construye uno nuevo)
  GET /api/regime/latest   → último snapshot guardado en PostgreSQL
"""
from fastapi import APIRouter, Request, HTTPException
from backend.services.snapshot import build_snapshot

router = APIRouter(prefix="/api/regime", tags=["regime"])


@router.get("/current")
async def get_current_regime(request: Request):
    """
    Construye un snapshot nuevo llamando a todas las APIs externas.
    Guarda en PostgreSQL y devuelve el resultado.
    """
    try:
        snapshot = await build_snapshot(request.app.state.db_pool)
        return snapshot
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/latest")
async def get_latest_regime(request: Request):
    """
    Devuelve el último snapshot guardado en PostgreSQL.
    Más rápido que /current — no llama a APIs externas.
    """
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT
                id, created_at, btc_price,
                regime_largo,  conviction_largo,  consensus_largo,  confirmed_largo,
                regime_medio,  conviction_medio,  consensus_medio,  confirmed_medio,
                regime_corto,  conviction_corto,  consensus_corto,  confirmed_corto
            FROM snapshots
            ORDER BY created_at DESC
            LIMIT 1
        """)

    if not row:
        raise HTTPException(status_code=404, detail="No hay snapshots guardados")

    return {
        "snapshot_id": row["id"],
        "created_at":  row["created_at"].isoformat(),
        "btc_price":   float(row["btc_price"]),
        "regimes": {
            "largo": {
                "regime":      row["regime_largo"],
                "conviction":  row["conviction_largo"],
                "consensus":   row["consensus_largo"],
                "is_confirmed":row["confirmed_largo"],
            },
            "medio": {
                "regime":      row["regime_medio"],
                "conviction":  row["conviction_medio"],
                "consensus":   row["consensus_medio"],
                "is_confirmed":row["confirmed_medio"],
            },
            "corto": {
                "regime":      row["regime_corto"],
                "conviction":  row["conviction_corto"],
                "consensus":   row["consensus_corto"],
                "is_confirmed":row["confirmed_corto"],
            },
        },
    }
