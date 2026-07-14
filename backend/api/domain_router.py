"""
AXIOM v2 — Router de prueba de la capa de dominio.
════════════════════════════════════════════════════════════════════════════
Endpoints TEMPORALES para ejercer la capa de dominio sin migrar las pantallas.
Sirven para validar que las entidades y el compositor funcionan contra los datos
reales. Se elimina o reemplaza cuando las pantallas consuman el dominio.

Rutas:
  GET /api/domain/coin/{coin_id}?caps=precio_ref,metadata_mercado,alertas
  GET /api/domain/mercado?caps=regimen_global,feed_noticias
  GET /api/domain/watchlist            → grupos + pares
  GET /api/domain/par/{coin_id}/{exchange}/{quote}?caps=precio_puntual,capacidades
"""
from __future__ import annotations
from fastapi import APIRouter, Request, Query

router = APIRouter(prefix="/api/domain", tags=["domain-test"])


def _caps(caps: str | None) -> list[str]:
    if not caps:
        return []
    return [c.strip() for c in caps.split(",") if c.strip()]


@router.get("/coin/{coin_id}")
async def domain_coin(request: Request, coin_id: str,
                      caps: str = Query("precio_ref,metadata_mercado")):
    domain = request.app.state.domain
    coin = domain.coin(coin_id)
    data = await coin.overview(_caps(caps))
    return {"coin_id": coin_id, "data": data}


@router.get("/mercado")
async def domain_mercado(request: Request,
                         caps: str = Query("regimen_global")):
    domain = request.app.state.domain
    mercado = domain.mercado()
    data = await mercado.overview(_caps(caps))
    return {"data": data}


@router.get("/watchlist")
async def domain_watchlist(request: Request, grupo: str | None = None):
    domain = request.app.state.domain
    wl = domain.watchlist()
    return {
        "listas": await wl.listas(),
        "pares":  await wl.pares_seguidos(grupo),
    }


@router.get("/par/{coin_id}/{exchange}/{quote}")
async def domain_par(request: Request, coin_id: str, exchange: str, quote: str,
                     caps: str = Query("precio_puntual,capacidades")):
    domain = request.app.state.domain
    par = domain.par(coin_id, exchange, quote)
    data = await par.overview(_caps(caps))
    # set no es serializable → convertir capabilities a lista
    if isinstance(data.get("capacidades"), dict):
        caps_val = data["capacidades"].get("capabilities")
        if isinstance(caps_val, set):
            data["capacidades"]["capabilities"] = sorted(caps_val)
    return {"par": f"{coin_id}:{exchange}:{quote}", "data": data}
