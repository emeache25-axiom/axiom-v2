"""
AXIOM v2 — Candles API (vela en vivo).

WS /api/candles/ws?exchange=&pair=&timeframe=
El gráfico se conecta a la combinación par+timeframe que está mostrando y recibe
la vela en curso en tiempo real (para actualizar la última vela del chart).
Al cambiar de par o timeframe, el gráfico cierra esta conexión y abre otra.
"""
from __future__ import annotations
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.candle_stream import subscribe, unsubscribe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/candles", tags=["candles"])


@router.websocket("/ws")
async def candles_ws(ws: WebSocket):
    await ws.accept()
    exchange = ws.query_params.get("exchange")
    pair     = ws.query_params.get("pair")
    tf       = ws.query_params.get("timeframe", "1d")

    if not exchange or not pair or exchange == "coingecko":
        # sin fuente de vela en vivo para esta combinación
        await ws.send_text(json.dumps({"type": "unsupported"}))
        await ws.close()
        return

    async def on_candle(candle: dict):
        try:
            await ws.send_text(json.dumps({"type": "candle", "candle": candle}))
        except Exception:
            pass

    await subscribe(exchange, pair, tf, on_candle)
    try:
        while True:
            await ws.receive_text()   # mantener viva; ignorar lo que mande
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        unsubscribe(exchange, pair, tf, on_candle)
