"""
AXIOM v2 — Strategy Engine / Motor de Datos.

Responsabilidad ÚNICA: proveer velas OHLCV de cualquier símbolo y timeframe,
con caché en memoria (TTL por timeframe). No sabe nada de estrategias, señales
ni posiciones. Todo el resto del pipeline consume datos exclusivamente de acá.

Fuentes: Binance → MEXC (fallback). Ambas APIs públicas, sin KYC.

Caché: clave (symbol, timeframe). El TTL se ajusta al timeframe (no tiene
sentido refrescar velas de 1h cada 10s). Varias estrategias que pidan el mismo
símbolo/timeframe comparten una sola descarga — clave para la notebook.
"""
from __future__ import annotations
import time
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_MEXC    = "https://api.mexc.com/api/v3/klines"
_COINEX  = "https://api.coinex.com/v2/spot/kline"
_TIMEOUT = 10.0

# Mapeo de timeframe → intervalo de cada exchange
_TF_MEXC = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "60m", "4h": "4h", "1d": "1d", "1w": "1W",
}
_TF_COINEX = {
    "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "1week",
}

# Segundos de cada timeframe (para TTL del caché)
_TF_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800,
}


class DataEngine:
    """Motor de datos con caché. Una instancia compartida por toda la app."""

    def __init__(self):
        # cache[(symbol, tf)] = {"candles": [...], "ts": epoch_fetch}
        self._cache: dict[tuple, dict] = {}
        self._locks: dict[tuple, asyncio.Lock] = {}

    def _ttl(self, timeframe: str) -> float:
        # Refrescar como mucho una vez por "medio timeframe" (mín 15s, máx 5min)
        secs = _TF_SECONDS.get(timeframe, 300)
        return max(15.0, min(secs / 2, 300.0))

    def _lock(self, key) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def get_candles(self, pair_symbol: str, timeframe: str,
                          exchange: str = "mexc", limit: int = 200) -> list[dict] | None:
        """
        Devuelve hasta `limit` velas recientes del par en el exchange dado.
        pair_symbol: símbolo real del par (ej. DOGEUSDT, DOGEBTC).
        exchange: 'mexc' | 'coinex'.
        Cada vela: {time, open, high, low, close, volume} (time en segundos).
        """
        pair_symbol = pair_symbol.upper()
        key = (pair_symbol, timeframe, exchange)
        now = time.time()

        cached = self._cache.get(key)
        if cached and (now - cached["ts"]) < self._ttl(timeframe):
            data = cached["candles"]
            return data[-limit:] if limit else data

        async with self._lock(key):
            cached = self._cache.get(key)
            if cached and (time.time() - cached["ts"]) < self._ttl(timeframe):
                data = cached["candles"]
                return data[-limit:] if limit else data

            candles = await self._fetch(pair_symbol, timeframe, exchange, max(limit, 200))
            if candles:
                self._cache[key] = {"candles": candles, "ts": time.time()}
                return candles[-limit:] if limit else candles
            if cached:
                return cached["candles"][-limit:] if limit else cached["candles"]
            return None

    async def _fetch(self, pair: str, timeframe: str, exchange: str,
                     limit: int) -> list[dict] | None:
        limit = min(limit, 1000)
        if exchange == "coinex":
            tf = _TF_COINEX.get(timeframe)
            return await self._klines_coinex(pair, tf, limit) if tf else None
        # default: MEXC
        tf = _TF_MEXC.get(timeframe)
        return await self._klines_mexc(pair, tf, limit) if tf else None

    async def _klines_mexc(self, pair: str, interval: str, limit: int) -> list[dict] | None:
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                r = await c.get(_MEXC, params={"symbol": pair, "interval": interval, "limit": limit})
                if r.status_code != 200:
                    return None
                rows = r.json()
                if not isinstance(rows, list) or not rows:
                    return None
                return [
                    {"time": row[0] // 1000,
                     "open": float(row[1]), "high": float(row[2]),
                     "low": float(row[3]), "close": float(row[4]),
                     "volume": float(row[5])}
                    for row in rows
                ]
        except Exception as e:
            logger.debug(f"[data_engine] MEXC {pair} {interval}: {e}")
            return None

    async def _klines_coinex(self, pair: str, period: str, limit: int) -> list[dict] | None:
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                r = await c.get(_COINEX, params={"market": pair, "period": period, "limit": min(limit, 1000)})
                if r.status_code != 200:
                    return None
                body = r.json()
                if body.get("code") != 0:
                    return None
                rows = body.get("data", [])
                if not rows:
                    return None
                # CoinEx devuelve objetos con campos nombrados
                return [
                    {"time": int(row["created_at"]) // 1000,
                     "open": float(row["open"]), "high": float(row["high"]),
                     "low": float(row["low"]), "close": float(row["close"]),
                     "volume": float(row["volume"])}
                    for row in rows
                ]
        except Exception as e:
            logger.debug(f"[data_engine] CoinEx {pair} {period}: {e}")
            return None

    def last_price(self, pair_symbol: str, timeframe: str = "1m",
                   exchange: str = "mexc") -> float | None:
        """Último close cacheado (sin red). Útil para valuar posiciones rápido."""
        c = self._cache.get((pair_symbol.upper(), timeframe, exchange))
        if c and c["candles"]:
            return c["candles"][-1]["close"]
        return None

    def clear(self):
        self._cache.clear()


# Instancia única compartida
data_engine = DataEngine()
