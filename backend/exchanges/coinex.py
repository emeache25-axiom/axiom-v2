"""
AXIOM v2 — Adaptador CoinEx.
════════════════════════════════════════════════════════════════════════════
Exchange operable, foco de los pares satoshi /BTC (ONT, ROSE, etc.).
Capacidades completas: precio tiempo real, OHLCV, vela en vivo, order book.

Protocolos (validados en producción con el capturador de order book):
  - REST v2:  https://api.coinex.com/v2/spot/*   (kline, ticker, depth)
  - WS v2:    wss://socket.coinex.com/v2/spot     (gzip, depth.subscribe, ...)
  - Los mensajes del WS vienen comprimidos con GZIP → hay que descomprimir.
  - Keepalive: server.ping cada <60s.
"""
from __future__ import annotations
import asyncio
import gzip
import json
import logging
from typing import Optional, Callable, Awaitable
from datetime import datetime, timezone

import httpx

from .base import ExchangeAdapter

logger = logging.getLogger(__name__)

_REST = "https://api.coinex.com"
_WS   = "wss://socket.coinex.com/v2/spot"
_TIMEOUT = 10.0

# timeframe canónico → período CoinEx
_TF = {
    "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1hour", "4h": "4hour", "1d": "1day",
    "1w": "1week", "1M": "1month",
}

try:
    import websockets
except ImportError:
    websockets = None


def _decode(raw):
    """CoinEx comprime los mensajes del WS con gzip."""
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw


class CoinEx(ExchangeAdapter):
    name = "coinex"
    label = "CoinEx"
    operable = True
    # NOTA: CoinEx v2 spot NO tiene canal kline por WebSocket (validado en vivo:
    # kline.subscribe → "method not found"). La vela en vivo (candle_rt) se DERIVA
    # del stream de precio (state) o de trades (deals): al llegar cada tick se
    # actualiza la vela en curso. Por eso candle_rt no está en capabilities como
    # canal directo; se implementa en la capa de velas en vivo construyéndola.
    capabilities = {"price_rt", "price_ref", "ohlcv", "orderbook"}

    # ── Precio (REST) ───────────────────────────────────────────────────────────
    async def get_price(self, symbol: str) -> dict:
        symbol = symbol.upper()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/v2/spot/ticker", params={"market": symbol})
            if r.status_code != 200:
                return self._price_obj()
            body = r.json()
            if body.get("code") != 0:
                return self._price_obj()
            data = body.get("data") or []
            if not data:
                return self._price_obj()
            t = data[0]
            last  = float(t["last"])
            open_ = float(t.get("open", 0)) or None
            change = round((last - open_) / open_ * 100, 2) if open_ else None
            return self._price_obj(
                price=last,
                bid=float(t["last"]),   # v2 ticker no da bid/ask; se completa por WS/depth
                ask=float(t["last"]),
                change_24h=change,
                high_24h=float(t["high"]) if t.get("high") else None,
                low_24h=float(t["low"])  if t.get("low")  else None,
                volume_24h=float(t["volume"]) if t.get("volume") else None,
                ts=int(t.get("created_at", 0)) or None,
            )

    # ── Precio en tiempo real (WS) ────────────────────────────────────────────
    async def watch_price(self, symbol: str,
                          on_update: Callable[[dict], Awaitable[None]]):
        symbol = symbol.upper()
        async def _routed(pair, price):
            await on_update(price)
        await self.watch_prices([symbol], _routed)

    async def watch_prices(self, symbols, on_update):
        """Multi-par en UNA conexión. state.subscribe acepta market_list con
        varios mercados; state.update trae state_list con el 'market' de cada uno,
        así ruteamos cada precio a su par vía on_update(pair_symbol, price)."""
        if websockets is None:
            raise RuntimeError("falta la librería 'websockets'")
        markets = [s.upper() for s in symbols]
        backoff = 2
        while True:
            try:
                async with websockets.connect(_WS, ping_interval=None, max_size=2**22) as ws:
                    await ws.send(json.dumps({
                        "method": "state.subscribe",
                        "params": {"market_list": markets},
                        "id": 1,
                    }))
                    ping = asyncio.create_task(self._ping_loop(ws))
                    backoff = 2
                    try:
                        async for raw in ws:
                            try:
                                msg = json.loads(_decode(raw))
                            except Exception:
                                continue
                            if msg.get("method") != "state.update":
                                continue
                            data = msg.get("data") or {}
                            for st in (data.get("state_list") or []):
                                mkt = st.get("market")
                                if not mkt:
                                    continue
                                last = float(st["last"])
                                open_ = float(st.get("open", 0)) or None
                                change = round((last - open_) / open_ * 100, 2) if open_ else None
                                await on_update(mkt, self._price_obj(
                                    price=last, bid=last, ask=last,
                                    change_24h=change,
                                    high_24h=float(st["high"]) if st.get("high") else None,
                                    low_24h=float(st["low"])  if st.get("low")  else None,
                                    volume_24h=float(st["volume"]) if st.get("volume") else None,
                                    ts=int(datetime.now(timezone.utc).timestamp()),
                                ))
                    finally:
                        ping.cancel()
            except Exception as e:
                logger.warning(f"[coinex.watch_prices] {markets} caído: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _ping_loop(self, ws):
        pid = 1000
        while True:
            await asyncio.sleep(30)
            pid += 1
            try:
                await ws.send(json.dumps({"method": "server.ping", "params": [], "id": pid}))
            except Exception:
                return

    # ── Velas ─────────────────────────────────────────────────────────────────
    async def get_ohlcv(self, symbol: str, timeframe: str,
                        start_ms: Optional[int] = None,
                        end_ms: Optional[int] = None,
                        limit: int = 1000) -> list[dict]:
        symbol = symbol.upper()
        period = _TF.get(timeframe)
        if not period:
            return []
        params = {"market": symbol, "period": period, "limit": min(limit, 1000)}
        if start_ms: params["start_time"] = start_ms // 1000
        if end_ms:   params["end_time"]   = end_ms // 1000
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/v2/spot/kline", params=params)
            if r.status_code != 200:
                return []
            body = r.json()
            if body.get("code") != 0:
                return []
            return [
                self._candle(int(row["created_at"]) // 1000,
                             row["open"], row["high"], row["low"],
                             row["close"], row["volume"])
                for row in body.get("data", [])
            ]

    # ── Vela en vivo ──────────────────────────────────────────────────────────
    # CoinEx v2 spot NO tiene canal kline por WebSocket. La vela en vivo se
    # construye en la capa superior a partir de watch_price (state) o de un
    # stream de trades: cada tick actualiza la vela en curso (close=último precio,
    # high/low si excede, volume acumulado). No se implementa acá como canal.
    # (watch_candle hereda de la base y lanzará CapabilityError si se llama.)

    # ── Order book ──────────────────────────────────────────────────────────────
    async def get_orderbook(self, symbol: str, depth: int = 10) -> dict:
        symbol = symbol.upper()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/v2/spot/depth",
                            params={"market": symbol, "limit": depth, "interval": "0"})
            if r.status_code != 200:
                return {"ts": None, "bids": [], "asks": []}
            body = r.json()
            if body.get("code") != 0:
                return {"ts": None, "bids": [], "asks": []}
            d = (body.get("data") or {}).get("depth") or {}
            return {
                "ts":   int(datetime.now(timezone.utc).timestamp()),
                "bids": d.get("bids", []),
                "asks": d.get("asks", []),
            }

    async def watch_orderbook(self, symbol: str, depth: int,
                              on_update: Callable[[dict], Awaitable[None]]):
        """Reusa el protocolo depth.subscribe (el mismo del capturador)."""
        if websockets is None:
            raise RuntimeError("falta la librería 'websockets'")
        symbol = symbol.upper()
        backoff = 2
        while True:
            try:
                async with websockets.connect(_WS, ping_interval=None, max_size=2**22) as ws:
                    await ws.send(json.dumps({
                        "method": "depth.subscribe",
                        "params": {"market_list": [[symbol, depth, "0", True]]},
                        "id": 1,
                    }))
                    ping = asyncio.create_task(self._ping_loop(ws))
                    backoff = 2
                    try:
                        async for raw in ws:
                            try:
                                msg = json.loads(_decode(raw))
                            except Exception:
                                continue
                            if msg.get("method") != "depth.update":
                                continue
                            data = msg.get("data") or {}
                            if not data.get("is_full", False):
                                continue
                            d = data.get("depth") or {}
                            await on_update({
                                "ts":   int(datetime.now(timezone.utc).timestamp()),
                                "bids": d.get("bids", []),
                                "asks": d.get("asks", []),
                            })
                    finally:
                        ping.cancel()
            except Exception as e:
                logger.warning(f"[coinex.watch_orderbook] {symbol} caído: {e}; reconecta en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
