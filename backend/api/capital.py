"""
API del módulo Capital — AXIOM v2.

Endpoint:
  GET /api/capital/suggestion → asignación sugerida según régimen largo actual
"""
from fastapi import APIRouter, Request, HTTPException

router = APIRouter(prefix="/api/capital", tags=["capital"])

# Tabla de asignación por régimen largo
_ALLOCATION = {
    "ACUMULACION":  {"largo": 50, "medio": 25, "corto": 15, "stables": 10},
    "ALCISTA_A":    {"largo": 40, "medio": 30, "corto": 20, "stables": 10},
    "ALCISTA_B":    {"largo": 30, "medio": 30, "corto": 25, "stables": 15},
    "DISTRIBUCION": {"largo": 15, "medio": 20, "corto": 15, "stables": 50},
    "BAJISTA":      {"largo":  0, "medio": 10, "corto": 10, "stables": 80},
}

# Contexto explicativo por régimen
_CONTEXT = {
    "ACUMULACION": (
        "El mercado se encuentra en fase de acumulación estructural. "
        "Los indicadores de ciclo largo sugieren que el precio está subvaluado "
        "respecto a su valor histórico. Es el momento de mayor exposición "
        "en activos de largo plazo."
    ),
    "ALCISTA_A": (
        "El ciclo largo muestra señales alcistas tempranas. "
        "El mercado está saliendo de la acumulación con momentum creciente. "
        "Se puede aumentar gradualmente la exposición en activos de corto plazo "
        "sin reducir el núcleo de largo."
    ),
    "ALCISTA_B": (
        "El mercado está en tendencia alcista tardía. Los indicadores de ciclo "
        "muestran valuaciones elevadas. Es momento de reducir exposición en largo "
        "y aumentar la reserva en stables para proteger ganancias."
    ),
    "DISTRIBUCION": (
        "El ciclo largo indica distribución activa. Los holders de largo plazo "
        "están tomando ganancias. Se recomienda reducir fuertemente la exposición "
        "y acumular stables como protección ante una reversión."
    ),
    "BAJISTA": (
        "El mercado está en tendencia bajista estructural. La prioridad es "
        "preservar capital. La exposición mínima en activos de riesgo se mantiene "
        "solo para no perder el posicionamiento en caso de reversión inesperada."
    ),
}


@router.get("/suggestion")
async def get_capital_suggestion(request: Request):
    """
    Devuelve la asignación de capital sugerida basada en el régimen largo actual.
    """
    # Traer el último snapshot
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
        raise HTTPException(status_code=404, detail="No hay snapshots disponibles")

    regime_largo = row["regime_largo"]
    allocation   = _ALLOCATION.get(regime_largo, _ALLOCATION["ACUMULACION"])
    context      = _CONTEXT.get(regime_largo, "")

    return {
        "based_on": {
            "snapshot_id":  row["id"],
            "created_at":   row["created_at"].isoformat(),
            "btc_price":    float(row["btc_price"]),
        },
        "regimes": {
            "largo": {
                "regime":      row["regime_largo"],
                "conviction":  row["conviction_largo"],
                "is_confirmed":row["confirmed_largo"],
            },
            "medio": {
                "regime":      row["regime_medio"],
                "conviction":  row["conviction_medio"],
                "is_confirmed":row["confirmed_medio"],
            },
            "corto": {
                "regime":      row["regime_corto"],
                "conviction":  row["conviction_corto"],
                "is_confirmed":row["confirmed_corto"],
            },
        },
        "allocation": allocation,
        "context":    context,
    }
