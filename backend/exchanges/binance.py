"""
AXIOM v2 — Adaptador Binance.
════════════════════════════════════════════════════════════════════════════
NO operable en AXIOM (decisión de trading), pero con datos COMPLETOS: sirve
para tener pares de Binance en la watchlist con gráfico en vivo y order book,
y sobre todo para backtesting (su histórico OHLCV es profundo y de calidad).

Binance sí tiene kline por WebSocket (a diferencia de CoinEx), así que la vela
en vivo es nativa. Todo JSON, sin gzip ni protobuf.

REST:  https://api.binance.com
WS:    wss://stream.binance.com:9443/ws/<stream>
"""
from __future__ import annotations
import asyncio
import json
import logging
from typing import Optional, Callable, Awaitable
from datetime import datetime, timezone

import httpx

from .base import ExchangeAdapter

logger = logging.getLogger(__name__)

_REST = "https://api.binance.com"
_WS   = "wss://stream.binance.com:9443/ws"
_TIMEOUT = 10.0

_TF = {
    "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "4h": "4h", "1d": "1d",
    "1w": "1w", "1M": "1M",
}

try:
    import websockets
except ImportError:
    websockets = None


class Binance(ExchangeAdapter):
    name = "binance"
    label = "Binance"
    operable = False          # no lo operamos, pero da todos los datos
    capabilities = {"price_rt", "price_ref", "ohlcv", "candle_rt", "orderbook"}

    # ── Precio (REST) ───────────────────────────────────────────────────────────
    async def get_price(self, symbol: str) -> dict:
        symbol = symbol.upper()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/api/v3/ticker/24hr", params={"symbol": symbol})
            if r.status_code != 200:
                return self._price_obj()
            d = r.json()
            return self._price_obj(
                price=float(d["lastPrice"]),
                bid=float(d["bidPrice"]) if d.get("bidPrice") else None,
                ask=float(d["askPrice"]) if d.get("askPrice") else None,
                change_24h=float(d["priceChangePercent"]),
                high_24h=float(d["highPrice"]),
                low_24h=float(d["lowPrice"]),
                volume_24h=float(d["quoteVolume"]),
                ts=int(datetime.now(timezone.utc).timestamp()),
            )

    # ── Precio en tiempo real (WS) ────────────────────────────────────────────
    async def watch_price(self, symbol: str,
                          on_update: Callable[[dict], Awaitable[None]]):
        if websockets is None:
            raise RuntimeError("falta la librería 'websockets'")
        stream = f"{symbol.lower()}@ticker"
        backoff = 2
        while True:
            try:
                async with websockets.connect(f"{_WS}/{stream}", ping_interval=20, max_size=2**22) as ws:
                    backoff = 2
                    async for raw in ws:
                        try:
                            d = json.loads(raw)
                        except Exception:
                            continue
                        if d.get("e") != "24hrTicker":
                            continue
                        await on_update(self._price_obj(
                            price=float(d["c"]),
                            bid=float(d["b"]) if d.get("b") else None,
                            ask=float(d["a"]) if d.get("a") else None,
                            change_24h=float(d["P"]),
                            high_24h=float(d["h"]),
                            low_24h=float(d["l"]),
                            volume_24h=float(d["q"]),
                            ts=int(d["E"]) // 1000 if d.get("E") else None,
                        ))
            except Exception as e:
                logger.warning(f"[binance.watch_price] {symbol} caído: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    # ── Velas (REST) ────────────────────────────────────────────────────────────
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

    # ── Vela en vivo (WS) ─────────────────────────────────────────────────────
    async def watch_candle(self, symbol: str, timeframe: str,
                           on_update: Callable[[dict], Awaitable[None]]):
        if websockets is None:
            raise RuntimeError("falta la librería 'websockets'")
        interval = _TF.get(timeframe)
        if not interval:
            raise ValueError(f"timeframe inválido: {timeframe}")
        stream = f"{symbol.lower()}@kline_{interval}"
        backoff = 2
        while True:
            try:
                async with websockets.connect(f"{_WS}/{stream}", ping_interval=20, max_size=2**22) as ws:
                    backoff = 2
                    async for raw in ws:
                        try:
                            d = json.loads(raw)
                        except Exception:
                            continue
                        if d.get("e") != "kline":
                            continue
                        k = d["k"]
                        await on_update(self._candle(
                            k["t"] // 1000, k["o"], k["h"], k["l"], k["c"], k["v"]))
            except Exception as e:
                logger.warning(f"[binance.watch_candle] {symbol} caído: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    # ── Order book ──────────────────────────────────────────────────────────────
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

    async def watch_orderbook(self, symbol: str, depth: int,
                              on_update: Callable[[dict], Awaitable[None]]):
        if websockets is None:
            raise RuntimeError("falta la librería 'websockets'")
        lvls = depth if depth in (5, 10, 20) else 10
        stream = f"{symbol.lower()}@depth{lvls}@100ms"
        backoff = 2
        while True:
            try:
                async with websockets.connect(f"{_WS}/{stream}", ping_interval=20, max_size=2**22) as ws:
                    backoff = 2
                    async for raw in ws:
                        try:
                            d = json.loads(raw)
                        except Exception:
                            continue
                        bids = d.get("bids") or d.get("b") or []
                        asks = d.get("asks") or d.get("a") or []
                        await on_update({
                            "ts":   int(datetime.now(timezone.utc).timestamp()),
                            "bids": [[p, q] for p, q in bids],
                            "asks": [[p, q] for p, q in asks],
                        })
            except Exception as e:
                logger.warning(f"[binance.watch_orderbook] {symbol} caído: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
