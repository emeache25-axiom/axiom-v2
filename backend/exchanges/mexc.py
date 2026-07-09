"""
AXIOM v2 — Adaptador MEXC (completo, con tiempo real vía protobuf).
════════════════════════════════════════════════════════════════════════════
Exchange operable. REST en JSON (precio, OHLCV, order book). Tiempo real vía
WebSocket con PROTOBUF (validado en vivo): deals para precio, kline para vela.

Los esquemas protobuf compilados viven en ./_mexc_proto/*_pb2.py (generados con
grpcio-tools desde github.com/mexcdevelop/websocket-proto, Apache-2.0).

REST: https://api.mexc.com
WS:   wss://wbs-api.mexc.com/ws   (protobuf; canales con sufijo .pb)
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import sys
from typing import Optional, Callable, Awaitable
from datetime import datetime, timezone

import httpx

from .base import ExchangeAdapter

logger = logging.getLogger(__name__)

_REST = "https://api.mexc.com"
_WS   = "wss://wbs-api.mexc.com/ws"
_TIMEOUT = 10.0

_TF = {
    "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "60m", "4h": "4h", "1d": "1d",
    "1w": "1W", "1M": "1M",
}
# timeframe canónico -> intervalo de kline en el WS protobuf de MEXC
_TF_WS = {
    "5m": "Min5", "15m": "Min15", "30m": "Min30",
    "1h": "Min60", "4h": "Hour4", "1d": "Day1",
    "1w": "Week1", "1M": "Month1",
}

try:
    import websockets
except ImportError:
    websockets = None

# Carga de los esquemas protobuf compilados. Los _pb2.py se importan entre si sin
# ruta, asi que hay que agregar esa carpeta al sys.path antes de importarlos.
_PROTO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_mexc_proto")
_wrapper_pb2 = None
_PROTO_OK = False
try:
    if _PROTO_DIR not in sys.path:
        sys.path.insert(0, _PROTO_DIR)
    import PushDataV3ApiWrapper_pb2 as _wrapper_pb2  # noqa: E402
    _PROTO_OK = True
except Exception as e:
    logger.warning(f"[mexc] protobuf no disponible ({e}); tiempo real deshabilitado")


class Mexc(ExchangeAdapter):
    name = "mexc"
    label = "MEXC"
    operable = True
    capabilities = {"price_rt", "price_ref", "ohlcv", "candle_rt", "orderbook"}

    # -- Precio (REST) --
    async def get_price(self, symbol: str) -> dict:
        symbol = symbol.upper()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/api/v3/ticker/24hr", params={"symbol": symbol})
            if r.status_code != 200:
                return self._price_obj()
            d = r.json()
            if isinstance(d, list):
                d = d[0] if d else {}
            if not d:
                return self._price_obj()
            def f(k):
                v = d.get(k)
                return float(v) if v not in (None, "") else None
            return self._price_obj(
                price=f("lastPrice"), bid=f("bidPrice"), ask=f("askPrice"),
                change_24h=f("priceChangePercent"),
                high_24h=f("highPrice"), low_24h=f("lowPrice"),
                volume_24h=f("quoteVolume"),
                ts=int(datetime.now(timezone.utc).timestamp()),
            )

    # -- Precio en tiempo real (WS protobuf, canal deals) --
    async def watch_price(self, symbol: str,
                          on_update: Callable[[dict], Awaitable[None]]):
        if websockets is None:
            raise RuntimeError("falta la libreria 'websockets'")
        if not _PROTO_OK:
            raise RuntimeError("esquemas protobuf de MEXC no disponibles (_mexc_proto/*_pb2.py)")
        symbol = symbol.upper()
        canal = f"spot@public.aggre.deals.v3.api.pb@100ms@{symbol}"
        backoff = 2
        while True:
            try:
                async with websockets.connect(_WS, ping_interval=None, max_size=2**22) as ws:
                    await ws.send(json.dumps({"method": "SUBSCRIPTION", "params": [canal]}))
                    ping = asyncio.create_task(self._ping_loop(ws))
                    backoff = 2
                    try:
                        async for raw in ws:
                            if isinstance(raw, str):
                                continue
                            msg = _wrapper_pb2.PushDataV3ApiWrapper()
                            try:
                                msg.ParseFromString(raw)
                            except Exception:
                                continue
                            if msg.WhichOneof("body") != "publicAggreDeals":
                                continue
                            deals = msg.publicAggreDeals.deals
                            if not deals:
                                continue
                            last = deals[-1]
                            price = float(last.price)
                            await on_update(self._price_obj(
                                price=price, bid=price, ask=price,
                                ts=int(last.time) // 1000 if last.time else
                                   int(datetime.now(timezone.utc).timestamp()),
                            ))
                    finally:
                        ping.cancel()
            except Exception as e:
                logger.warning(f"[mexc.watch_price] {symbol} caido: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _ping_loop(self, ws):
        while True:
            await asyncio.sleep(20)
            try:
                await ws.send(json.dumps({"method": "PING"}))
            except Exception:
                return

    # -- Velas (REST) --
    async def get_ohlcv(self, symbol: str, timeframe: str,
                        start_ms: Optional[int] = None,
                        end_ms: Optional[int] = None,
                        limit: int = 1000) -> list[dict]:
        symbol = symbol.upper()
        interval = _TF.get(timeframe)
        if not interval:
            return []
        params = {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)}
        if start_ms: params["startTime"] = start_ms
        if end_ms:   params["endTime"]   = end_ms
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/api/v3/klines", params=params)
            if r.status_code != 200:
                return []
            return [
                self._candle(row[0] // 1000, row[1], row[2], row[3], row[4], row[5])
                for row in r.json()
            ]

    # -- Vela en vivo (WS protobuf, canal kline) --
    async def watch_candle(self, symbol: str, timeframe: str,
                           on_update: Callable[[dict], Awaitable[None]]):
        if websockets is None:
            raise RuntimeError("falta la libreria 'websockets'")
        if not _PROTO_OK:
            raise RuntimeError("esquemas protobuf de MEXC no disponibles")
        symbol = symbol.upper()
        interval = _TF_WS.get(timeframe)
        if not interval:
            raise ValueError(f"timeframe invalido: {timeframe}")
        canal = f"spot@public.kline.v3.api.pb@{symbol}@{interval}"
        backoff = 2
        while True:
            try:
                async with websockets.connect(_WS, ping_interval=None, max_size=2**22) as ws:
                    await ws.send(json.dumps({"method": "SUBSCRIPTION", "params": [canal]}))
                    ping = asyncio.create_task(self._ping_loop(ws))
                    backoff = 2
                    try:
                        async for raw in ws:
                            if isinstance(raw, str):
                                continue
                            msg = _wrapper_pb2.PushDataV3ApiWrapper()
                            try:
                                msg.ParseFromString(raw)
                            except Exception:
                                continue
                            if msg.WhichOneof("body") != "publicSpotKline":
                                continue
                            k = msg.publicSpotKline
                            await on_update(self._candle(
                                int(k.windowStart),
                                k.openingPrice, k.highestPrice, k.lowestPrice,
                                k.closingPrice, k.volume))
                    finally:
                        ping.cancel()
            except Exception as e:
                logger.warning(f"[mexc.watch_candle] {symbol} caido: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    # -- Order book (REST) --
    async def get_orderbook(self, symbol: str, depth: int = 10) -> dict:
        symbol = symbol.upper()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/api/v3/depth",
                            params={"symbol": symbol, "limit": depth})
            if r.status_code != 200:
                return {"ts": None, "bids": [], "asks": []}
            d = r.json()
            return {
                "ts":   int(datetime.now(timezone.utc).timestamp()),
                "bids": [[p, q] for p, q in d.get("bids", [])],
                "asks": [[p, q] for p, q in d.get("asks", [])],
            }
