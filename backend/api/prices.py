"""
AXIOM v2 — Prices API.

  GET  /api/prices/live  → estado actual (REST, para debug/fallback).
  WS   /api/prices/ws    → precios en vivo empujados al frontend (latido ~1.5s).

El WebSocket es la fuente única de precio de la UI: watchlist, panel lateral y
header del gráfico se conectan (vía PriceService) y muestran el mismo dato.

Diseño para escala (~100 pares, varias pestañas):
  - Un solo "latido" global lee el estado de price_stream y lo envía a TODOS los
    clientes conectados. No es trabajo por-cliente por-par: es un broadcast.
  - Se mandan solo los pares que cambiaron desde el último envío a ese cliente
    (por simplicidad inicial, se manda el snapshot completo; para 100 pares es
    un JSON de pocos KB, aceptable cada 1.5s).
"""
from __future__ import annotations
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.price_stream import get_prices, track, untrack

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/prices", tags=["prices"])

_HEARTBEAT_S = 1.5

# clientes WS conectados
_clients: set[WebSocket] = set()
_broadcaster_task: asyncio.Task | None = None


@router.get("/live")
async def live_prices():
    """Estado actual de los precios en vivo (REST, para debug/fallback)."""
    prices = get_prices()
    return {"count": len(prices), "prices": list(prices.values())}


class TrackReq(BaseModel):
    exchange:    str
    pair_symbol: str
    coin_id:     str | None = None
    quote:       str | None = None
    source:      str = "chart"   # "watchlist" | "chart"


@router.post("/track")
async def track_pair(req: TrackReq):
    """Empieza a seguir un par en caliente (o suma un motivo). Idempotente."""
    track(req.exchange, req.pair_symbol, req.coin_id, req.source, quote=req.quote)
    return {"ok": True, "tracking": f"{req.exchange}:{req.pair_symbol.upper()}", "source": req.source}


@router.post("/untrack")
async def untrack_pair(req: TrackReq):
    """Quita un motivo; si no queda ninguno, deja de seguir el par."""
    untrack(req.exchange, req.pair_symbol, req.source)
    return {"ok": True, "released": f"{req.exchange}:{req.pair_symbol.upper()}", "source": req.source}


async def _broadcaster():
    """Único latido global: envía el snapshot de precios a todos los clientes."""
    while True:
        await asyncio.sleep(_HEARTBEAT_S)
        if not _clients:
            continue
        payload = json.dumps({"type": "prices", "prices": list(get_prices().values())})
        muertos = []
        for ws in list(_clients):
            try:
                await ws.send_text(payload)
            except Exception:
                muertos.append(ws)
        for ws in muertos:
            _clients.discard(ws)


@router.websocket("/ws")
async def prices_ws(ws: WebSocket):
    global _broadcaster_task
    await ws.accept()
    _clients.add(ws)
    # arrancar el latido global la primera vez que hay un cliente
    if _broadcaster_task is None or _broadcaster_task.done():
        _broadcaster_task = asyncio.create_task(_broadcaster())
    # enviar el estado actual de inmediato (no esperar el primer latido)
    try:
        await ws.send_text(json.dumps({"type": "prices", "prices": list(get_prices().values())}))
    except Exception:
        pass
    try:
        # mantener viva la conexión; el cliente puede mandar pings que ignoramos
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _clients.discard(ws)
