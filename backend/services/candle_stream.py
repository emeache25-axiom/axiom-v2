"""
AXIOM v2 — Servicio de vela en vivo (candle_stream).
════════════════════════════════════════════════════════════════════════════
Provee la VELA EN CURSO de un par + timeframe (el que muestra el gráfico), en
tiempo real, para que la última vela del chart crezca en vivo.

Fuentes por exchange:
  - MEXC:    watch_candle (kline protobuf) → la vela viene hecha.
  - CoinEx:  no hay kline WS → se DERIVA de deals (acumulando trades en la vela
             del período). Validado: OHLC coincide con el oficial; el volumen
             derivado es más fiel que el del REST para la vela en curso.
  - Binance: watch_candle (kline JSON) → vela hecha.

SEPARADO del price_stream (precio) y del capturador de order book. Cada uno su
responsabilidad. El candle_stream sigue SOLO los par+timeframe que algún gráfico
está mirando ahora; cuando nadie mira una combinación, la suelta.

WebSocket /api/candles/ws?exchange=&pair=&timeframe= : el gráfico se conecta a
la combinación que muestra; al cambiar de par o timeframe, se reconecta.
"""
from __future__ import annotations
import asyncio
import logging
import time
from datetime import datetime, timezone

from backend.exchanges import get_adapter

logger = logging.getLogger(__name__)

# segundos por timeframe canónico
_TF_SECONDS = {
    "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "4h": 14400, "1d": 86400,
    "1w": 604800, "1M": 2592000,
}

# Una "fuente" por combinación exchange:pair:timeframe que algún cliente mira.
# key = "exchange:PAIR:tf"
# value = {"task": Task, "candle": dict|None, "subs": set[callback], "adapter":...}
_sources: dict[str, dict] = {}


def _key(exchange: str, pair: str, tf: str) -> str:
    return f"{exchange.lower()}:{pair.upper()}:{tf}"


def _window_start(ts_sec: int, tf: str) -> int:
    step = _TF_SECONDS.get(tf, 60)
    return ts_sec - (ts_sec % step)


async def subscribe(exchange: str, pair: str, tf: str, callback):
    """Un cliente (gráfico) pide la vela en vivo de esta combinación.
    callback(candle_dict) se llama con cada actualización de la vela en curso."""
    key = _key(exchange, pair, tf)
    src = _sources.get(key)
    if src is None:
        src = {"candle": None, "subs": set()}
        _sources[key] = src
        src["task"] = asyncio.create_task(_run_source(exchange, pair, tf, key))
    src["subs"].add(callback)
    # entregar de inmediato la vela actual si ya hay
    if src["candle"]:
        try: await callback(src["candle"])
        except Exception: pass


def unsubscribe(exchange: str, pair: str, tf: str, callback):
    key = _key(exchange, pair, tf)
    src = _sources.get(key)
    if not src:
        return
    src["subs"].discard(callback)
    if not src["subs"]:
        # nadie mira esta combinación: cancelar la fuente
        t = src.get("task")
        if t and not t.done():
            t.cancel()
        _sources.pop(key, None)
        logger.info(f"[candle_stream] fuente liberada: {key}")


async def _emit(key: str, candle: dict):
    src = _sources.get(key)
    if not src:
        return
    src["candle"] = candle
    for cb in list(src["subs"]):
        try:
            await cb(candle)
        except Exception:
            pass


async def _run_source(exchange: str, pair: str, tf: str, key: str):
    """Mantiene la vela en vivo de una combinación y la emite a sus suscriptores."""
    adapter = get_adapter(exchange)
    logger.info(f"[candle_stream] fuente iniciada: {key}")

    # ── MEXC / Binance: watch_candle nativo (la vela viene hecha) ──
    if adapter.supports("candle_rt") and exchange.lower() in ("mexc", "binance"):
        async def on_candle(c: dict):
            # c: {time, open, high, low, close, volume} — alinear time al período
            c2 = dict(c)
            c2["time"] = _window_start(int(c["time"]), tf)
            await _emit(key, c2)
        try:
            await adapter.watch_candle(pair, tf, on_candle)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"[candle_stream] {key} watch_candle terminó: {e}")
        return

    # ── CoinEx: derivar de deals ──
    if exchange.lower() == "coinex":
        await _run_coinex_from_deals(pair, tf, key)
        return

    logger.warning(f"[candle_stream] {exchange} sin fuente de vela en vivo")


async def _run_coinex_from_deals(pair: str, tf: str, key: str):
    """Construye la vela en curso acumulando deals de CoinEx (validado)."""
    import gzip, json
    try:
        import websockets
    except ImportError:
        logger.warning("[candle_stream] falta 'websockets'")
        return

    WS = "wss://socket.coinex.com/v2/spot"
    symbol = pair.upper()

    def decode(raw):
        if isinstance(raw, bytes):
            try: return gzip.decompress(raw).decode("utf-8")
            except OSError: return raw.decode("utf-8", errors="replace")
        return raw

    cur = {"start": None, "o": None, "h": None, "l": None, "c": None, "vol": 0.0}
    backoff = 2
    while True:
        try:
            async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
                await ws.send(json.dumps({
                    "method": "deals.subscribe",
                    "params": {"market_list": [symbol]}, "id": 1,
                }))
                async def ping():
                    pid = 1000
                    while True:
                        await asyncio.sleep(30); pid += 1
                        try: await ws.send(json.dumps({"method":"server.ping","params":[],"id":pid}))
                        except Exception: return
                ping_task = asyncio.create_task(ping())
                backoff = 2
                try:
                    async for raw in ws:
                        msg = json.loads(decode(raw))
                        if msg.get("method") != "deals.update":
                            continue
                        data = msg.get("data") or {}
                        deals = data.get("deal_list") or data.get("deals") or []
                        changed = False
                        for d in deals:
                            price = float(d["price"])
                            qty   = float(d.get("amount") or d.get("quantity") or 0)
                            ts    = int(d.get("created_at", 0)) // 1000 or int(time.time())
                            ws_start = _window_start(ts, tf)
                            if cur["start"] is None or ws_start > cur["start"]:
                                cur = {"start": ws_start, "o": price, "h": price,
                                       "l": price, "c": price, "vol": qty}
                            elif ws_start == cur["start"]:
                                cur["c"] = price
                                cur["h"] = max(cur["h"], price)
                                cur["l"] = min(cur["l"], price)
                                cur["vol"] += qty
                            changed = True
                        if changed and cur["start"]:
                            await _emit(key, {
                                "time":   cur["start"],
                                "open":   cur["o"], "high": cur["h"],
                                "low":    cur["l"], "close": cur["c"],
                                "volume": round(cur["vol"], 8),
                            })
                finally:
                    ping_task.cancel()
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.warning(f"[candle_stream] {key} deals caído: {e}; reconecta en {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
