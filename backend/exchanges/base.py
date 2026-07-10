"""
AXIOM v2 — Librería de acceso a exchanges.
════════════════════════════════════════════════════════════════════════════
Capa única de acceso a datos de exchanges. El resto de AXIOM NO habla con las
APIs de los exchanges directamente: le pide datos a un adaptador concreto,
eligiéndolo EXPLÍCITAMENTE (el exchange importa — un par-en-su-exchange es el
par; no hay fallback silencioso entre exchanges).

Cada exchange es un adaptador que hereda de ExchangeAdapter e implementa solo
las capacidades que su fuente realmente ofrece. Las capacidades se DECLARAN,
así el resto del sistema sabe qué esperar sin adivinar.

Capacidades posibles:
    price_rt      precio en tiempo real (WebSocket)
    price_ref     precio de referencia (REST, puede tener retraso)
    ohlcv         velas OHLCV históricas verdaderas
    ohlcv_limited histórico de precios limitado (no OHLCV real; p.ej. CoinGecko)
    candle_rt     actualización de la vela en curso en vivo (WebSocket)
    orderbook     libro de órdenes

Formato normalizado (todos los adaptadores devuelven lo mismo):
    price     → dict {price, bid, ask, change_24h, high_24h, low_24h, volume_24h, ts}
    ohlcv     → list[dict] {time, open, high, low, close, volume}   (time en seg UTC)
    orderbook → dict {ts, bids:[[price,vol]..], asks:[[price,vol]..]}
"""
from __future__ import annotations
from abc import ABC
from typing import Optional, Callable, Awaitable


class CapabilityError(NotImplementedError):
    """Se pidió a un exchange una capacidad que no soporta."""
    def __init__(self, exchange: str, capability: str):
        super().__init__(f"El exchange '{exchange}' no soporta la capacidad '{capability}'")
        self.exchange = exchange
        self.capability = capability


# Timeframes canónicos de AXIOM. Cada adaptador los traduce a su propio formato.
TIMEFRAMES = ("5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")


class ExchangeAdapter(ABC):
    """
    Interfaz común a todos los exchanges. Un adaptador implementa SOLO los
    métodos correspondientes a las capacidades que declara en `capabilities`.
    Los no soportados lanzan CapabilityError (falla ruidosa y explícita).
    """

    name: str = "base"          # identificador interno, ej. 'coinex'
    label: str = "Base"          # nombre para mostrar
    operable: bool = False       # ¿se puede operar (órdenes) en este exchange?
    capabilities: set[str] = set()

    # ── Introspección de capacidades ──────────────────────────────────────────
    @classmethod
    def supports(cls, capability: str) -> bool:
        return capability in cls.capabilities

    @classmethod
    def _require(cls, capability: str):
        if capability not in cls.capabilities:
            raise CapabilityError(cls.name, capability)

    # ── Precio ──────────────────────────────────────────────────────────────────
    async def get_price(self, symbol: str) -> dict:
        """Último precio del par. symbol en formato del exchange (ej. 'ONTBTC').
        Devuelve el formato normalizado de precio. Usa price_rt o price_ref
        según lo que el adaptador soporte (implementación decide)."""
        self._require("price_ref")   # price_rt implica price_ref para REST
        raise NotImplementedError

    async def watch_price(self, symbol: str, on_update: Callable[[dict], Awaitable[None]]):
        """Suscribe al precio en tiempo real vía WebSocket. Llama on_update(price)
        con el formato normalizado en cada tick. Bloquea (correr como task)."""
        self._require("price_rt")
        raise NotImplementedError

    async def watch_prices(self, symbols: list[str],
                           on_update: Callable[[str, dict], Awaitable[None]]):
        """Suscribe a MÚLTIPLES pares en UNA sola conexión WebSocket (eficiente
        para seguir muchos pares — ej. 100 de la watchlist — sin abrir 100
        conexiones). Llama on_update(pair_symbol, price) en cada tick, indicando
        de qué par es. Bloquea (correr como task).

        Implementación por defecto: si el adaptador no la sobrescribe pero soporta
        price_rt, cae a lanzar un watch_price por par (menos eficiente). Los
        adaptadores que soportan multi-suscripción nativa (CoinEx, MEXC) la
        sobrescriben con una sola conexión."""
        self._require("price_rt")
        import asyncio
        async def _wrap(sym):
            await self.watch_price(sym, lambda p: on_update(sym, p))
        await asyncio.gather(*[_wrap(s) for s in symbols])

    # ── Velas ─────────────────────────────────────────────────────────────────
    async def get_ohlcv(self, symbol: str, timeframe: str,
                        start_ms: Optional[int] = None,
                        end_ms: Optional[int] = None,
                        limit: int = 1000) -> list[dict]:
        """Velas históricas. Devuelve lista normalizada de velas."""
        self._require("ohlcv" if "ohlcv" in self.capabilities else "ohlcv_limited")
        raise NotImplementedError

    async def watch_candle(self, symbol: str, timeframe: str,
                           on_update: Callable[[dict], Awaitable[None]]):
        """Suscribe a la actualización de la vela en curso vía WebSocket."""
        self._require("candle_rt")
        raise NotImplementedError

    # ── Order book ──────────────────────────────────────────────────────────────
    async def get_orderbook(self, symbol: str, depth: int = 10) -> dict:
        """Snapshot del order book (REST). Formato normalizado."""
        self._require("orderbook")
        raise NotImplementedError

    async def watch_orderbook(self, symbol: str, depth: int,
                              on_update: Callable[[dict], Awaitable[None]]):
        """Suscribe al order book en tiempo real vía WebSocket."""
        self._require("orderbook")
        raise NotImplementedError

    # ── Utilidades comunes de normalización ─────────────────────────────────────
    @staticmethod
    def _price_obj(price=None, bid=None, ask=None, change_24h=None,
                   high_24h=None, low_24h=None, volume_24h=None, ts=None) -> dict:
        return {
            "price":      price,
            "bid":        bid,
            "ask":        ask,
            "change_24h": change_24h,
            "high_24h":   high_24h,
            "low_24h":    low_24h,
            "volume_24h": volume_24h,
            "ts":         ts,
        }

    @staticmethod
    def _candle(time_s, o, h, l, c, v) -> dict:
        return {"time": int(time_s), "open": float(o), "high": float(h),
                "low": float(l), "close": float(c), "volume": float(v)}
