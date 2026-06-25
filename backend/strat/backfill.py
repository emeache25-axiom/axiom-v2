"""
AXIOM v2 — Strategy Engine / Backfill de velas históricas.

Trae histórico PROFUNDO paginando hacia atrás. Ambos exchanges soportan rango
temporal:
  - MEXC: endpoint klines estilo Binance, parámetros startTime/endTime (ms).
  - CoinEx: /spot/kline con start_time/end_time (ms). (Verificado empíricamente;
    la doc pública no lo documenta pero funciona.)

Independiente del data_engine en vivo: este módulo es para backtesting, donde
queremos muchas velas de una sola vez, no el último tramo cacheado.

Uso:
    candles = await fetch_history("BTCUSDT", "5m", "mexc", target=20000)
Devuelve velas {time, open, high, low, close, volume} cronológicas, sin
duplicados.
"""
from __future__ import annotations
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_MEXC   = "https://api.mexc.com/api/v3/klines"
_COINEX = "https://api.coinex.com/v2/spot/kline"
_TIMEOUT = 15.0
_PER_REQ = 1000          # máximo por request en ambos
_MAX_REQUESTS = 60       # tope de seguridad (60 × 1000 = 60k velas máx)

_TF_MEXC = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "60m", "4h": "4h", "1d": "1d", "1w": "1W",
}
_TF_COINEX = {
    "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "1week",
}
# Milisegundos por vela de cada timeframe (para calcular ventanas)
_TF_MS = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000,
}


async def _mexc_chunk(client, pair, interval, end_ms, span_ms):
    start_ms = end_ms - span_ms
    params = {"symbol": pair, "interval": interval, "limit": _PER_REQ,
              "startTime": start_ms, "endTime": end_ms}
    try:
        r = await client.get(_MEXC, params=params)
        if r.status_code != 200:
            return []
        rows = r.json()
        if not isinstance(rows, list):
            return []
        return [
            {"time": row[0] // 1000, "open": float(row[1]), "high": float(row[2]),
             "low": float(row[3]), "close": float(row[4]), "volume": float(row[5])}
            for row in rows
        ]
    except Exception as e:
        logger.debug(f"[backfill] MEXC {pair}: {e}")
        return []


async def _coinex_chunk(client, pair, period, end_ms, span_ms):
    start_ms = end_ms - span_ms
    params = {"market": pair, "period": period, "limit": _PER_REQ,
              "start_time": start_ms, "end_time": end_ms}
    try:
        r = await client.get(_COINEX, params=params)
        if r.status_code != 200:
            return []
        body = r.json()
        if body.get("code") != 0:
            return []
        rows = body.get("data", [])
        return [
            {"time": int(row["created_at"]) // 1000, "open": float(row["open"]),
             "high": float(row["high"]), "low": float(row["low"]),
             "close": float(row["close"]), "volume": float(row["volume"])}
            for row in rows
        ]
    except Exception as e:
        logger.debug(f"[backfill] CoinEx {pair}: {e}")
        return []


async def fetch_history(pair_symbol: str, timeframe: str, exchange: str,
                        target: int = 10000) -> list[dict]:
    """
    Trae hasta `target` velas paginando hacia atrás desde ahora.
    Devuelve cronológico, deduplicado por timestamp.
    """
    pair = pair_symbol.upper()
    tf_ms = _TF_MS.get(timeframe)
    if not tf_ms:
        return []
    span_ms = _PER_REQ * tf_ms          # ventana que cubre ~1000 velas

    if exchange == "coinex":
        interval = _TF_COINEX.get(timeframe)
        chunk_fn = _coinex_chunk
    else:
        interval = _TF_MEXC.get(timeframe)
        chunk_fn = _mexc_chunk
    if not interval:
        return []

    import time as _t
    end_ms = int(_t.time() * 1000)
    by_time: dict[int, dict] = {}
    requests_done = 0

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while len(by_time) < target and requests_done < _MAX_REQUESTS:
            chunk = await chunk_fn(client, pair, interval, end_ms, span_ms)
            requests_done += 1
            if not chunk:
                break
            new = 0
            for c in chunk:
                if c["time"] not in by_time:
                    by_time[c["time"]] = c
                    new += 1
            # Retroceder la ventana al inicio del tramo recibido
            oldest = min(c["time"] for c in chunk)
            new_end = oldest * 1000 - tf_ms
            if new_end >= end_ms:    # no avanzó: cortar
                break
            end_ms = new_end
            if new == 0:             # no trajo nada nuevo: llegamos al límite
                break
            await asyncio.sleep(0.15)   # respetar rate limit

    out = sorted(by_time.values(), key=lambda c: c["time"])
    return out[-target:] if target else out
