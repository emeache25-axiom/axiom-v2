"""
AXIOM v2 — Capa de dominio: sub-entidad Par.
════════════════════════════════════════════════════════════════════════════
Proyección operativa de la Coin en un exchange+quote concretos. Se obtiene con
`coin.par(exchange, quote)`. Hereda el contexto de la coin.

PEDIDOS vs FLUJOS (ver diseño §5):
  - PEDIDO (async def): preguntás, devuelve un valor, termina. Va al ADAPTADOR.
    Entra en el compositor `overview`.
  - FLUJO (def, no async): suscripción por WebSocket. NO abre socket propio —
    DELEGA en los servicios singleton price_stream / candle_stream. No entra en
    `overview`.

Estado en este esqueleto (paso 1):
  IMPLEMENTADAS:
    - precio_puntual  → price_stream.get_price (último en memoria) con fallback
    - capacidades     → adapter.operable/capabilities (tiempo real)
    - suscribir_precio / desuscribir_precio → price_stream.track/untrack
    - suscribir_vela  / desuscribir_vela    → candle_stream (si expone subscribe)
  STUB:
    - velas_hist          → adapter.get_ohlcv (paso 3/8: consolidación exchanges)
    - order_book_snapshot → adapter.get_orderbook
    - estado_chart        → PG chart_state/indicators/drawings
    - suscribir_orderbook → a resolver (§8)
"""
from __future__ import annotations

from backend.domain.base import Composable
from backend.exchanges import get_adapter


class Par(Composable):
    def __init__(self, pool, coin, exchange: str, quote: str):
        self._pool = pool
        self.coin = coin                 # referencia a la Coin madre
        self.exchange = exchange
        self.quote = quote
        self._pair_symbol: str | None = None   # se resuelve perezoso (ej. ONTBTC)

    def con_pair_symbol(self, pair_symbol: str) -> "Par":
        """Fija el pair_symbol conocido (evita resolverlo). Devuelve self para encadenar.
        Útil cuando el llamador ya tiene el ex_symbol exacto (ej. charts.py)."""
        if pair_symbol:
            self._pair_symbol = pair_symbol.upper()
        return self

    # ── Resolución del pair_symbol (perezoso) ─────────────────────────────────
    async def _resolve_symbol(self) -> str | None:
        if self._pair_symbol:
            return self._pair_symbol
        # 1) Buscar en watchlist el par exacto para esta coin+exchange+quote
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT pair_symbol FROM watchlist
                   WHERE coin_id=$1 AND exchange=$2 AND quote=$3 LIMIT 1""",
                self.coin.id, self.exchange, self.quote,
            )
        if row and row["pair_symbol"]:
            self._pair_symbol = row["pair_symbol"]
            return self._pair_symbol
        # 2) No está en watchlist: armar {BASE}{QUOTE} desde el símbolo de la coin
        #    (mismo criterio que pair_discovery). Sirve para pares no seguidos.
        async with self._pool.acquire() as conn:
            crow = await conn.fetchrow("SELECT symbol FROM coins WHERE id=$1", self.coin.id)
        if crow and crow["symbol"]:
            self._pair_symbol = f"{crow['symbol'].upper()}{self.quote.upper()}"
        return self._pair_symbol

    # ── Mapa de capacidades (solo PEDIDOS entran al compositor) ────────────────
    def _capacidades(self) -> dict:
        return {
            "precio_puntual":      self.precio_puntual,
            "velas_hist":          self.velas_hist,
            "order_book_snapshot": self.order_book_snapshot,
            "capacidades":         self.capacidades,
            "estado_chart":        self.estado_chart,
        }

    # ══ PEDIDOS ═══════════════════════════════════════════════════════════════

    async def precio_puntual(self) -> dict:
        """Último precio del par. Fuente: price_stream en memoria (si está seguido)."""
        from backend.services.price_stream import get_price as stream_price
        symbol = await self._resolve_symbol()
        if symbol:
            p = stream_price(self.exchange, symbol)
            if p:
                return p
        # Fallback: no está en el stream → None (paso 3 puede ir al adaptador)
        return {"price": None, "exchange": self.exchange, "pair_symbol": symbol}

    async def capacidades(self) -> dict:
        """Capabilities del exchange, preguntadas al adaptador EN TIEMPO REAL."""
        adapter = get_adapter(self.exchange)
        return {
            "operable":     getattr(adapter, "operable", False),
            "capabilities": set(getattr(adapter, "capabilities", set())),
        }

    # Milisegundos por vela de cada timeframe (para paginar hacia atrás).
    # MEXC y CoinEx IGNORAN end_ms si no se les da también start_ms: devuelven las
    # velas más recientes en vez de las anteriores a end_ms. Por eso, al paginar
    # hacia atrás (end_ms sin start_ms), calculamos el start_ms restando la ventana.
    _TF_MS = {
        "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
        "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
        "1w": 604_800_000, "1M": 2_592_000_000,
    }

    async def velas_hist(self, timeframe: str = "1d", limit: int = 500,
                         start_ms: int | None = None,
                         end_ms: int | None = None) -> list:
        """
        Velas OHLCV históricas del par. Fuente: adaptador del exchange (única
        puerta a datos de mercado). Formato normalizado:
        [{time, open, high, low, close, volume}] con time en segundos UTC.
        start_ms/end_ms opcionales para paginar rangos (scroll del gráfico).
        """
        symbol = await self._resolve_symbol()
        if not symbol:
            return []
        adapter = get_adapter(self.exchange)
        if not adapter.supports("ohlcv") and not adapter.supports("ohlcv_limited"):
            return []

        # Paginación hacia atrás: si hay end_ms pero no start_ms, calcular la
        # ventana (MEXC/CoinEx ignoran end_ms suelto y devuelven lo más reciente).
        if end_ms and not start_ms:
            span = self._TF_MS.get(timeframe, 86_400_000) * (limit + 1)
            start_ms = end_ms - span

        try:
            return await adapter.get_ohlcv(
                symbol, timeframe, start_ms=start_ms, end_ms=end_ms, limit=limit)
        except Exception:
            return []

    async def order_book_snapshot(self, depth: int = 20) -> dict:
        """Libro de órdenes puntual. Fuente: adaptador del exchange."""
        symbol = await self._resolve_symbol()
        if not symbol:
            return {"ts": None, "bids": [], "asks": []}
        adapter = get_adapter(self.exchange)
        if not adapter.supports("orderbook"):
            return {"ts": None, "bids": [], "asks": [], "_no_soportado": True}
        try:
            return await adapter.get_orderbook(symbol, depth)
        except Exception:
            return {"ts": None, "bids": [], "asks": []}

    async def estado_chart(self) -> dict:
        """Estado del gráfico persistido para este par. Fuente: PG chart_state."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT coin_id, timeframe, exchange, ex_symbol
                   FROM chart_state WHERE id=1""")
        if not row:
            return {"timeframe": "1d", "exchange": self.exchange, "ex_symbol": None}
        return {
            "coin_id":   row["coin_id"],
            "timeframe": row["timeframe"],
            "exchange":  row["exchange"],
            "ex_symbol": row["ex_symbol"],
        }

    # ══ FLUJOS (delegan en servicios singleton — NO abren sockets) ════════════

    def suscribir_precio(self, source: str = "chart"):
        """Empieza a seguir el precio en vivo vía price_stream (motivo `source`)."""
        from backend.services.price_stream import track
        # symbol se resuelve sincrónicamente si ya está; si no, el track puede
        # recibirlo luego. Aquí se asume pair_symbol ya cacheado o se pasa quote.
        if self._pair_symbol:
            track(self.exchange, self._pair_symbol, self.coin.id, source, quote=self.quote)

    def desuscribir_precio(self, source: str = "chart"):
        from backend.services.price_stream import untrack
        if self._pair_symbol:
            untrack(self.exchange, self._pair_symbol, source)

    def suscribir_vela(self, timeframe: str, callback):
        """Suscribe la vela en curso vía candle_stream (si el servicio lo expone)."""
        try:
            from backend.services import candle_stream
            if hasattr(candle_stream, "subscribe") and self._pair_symbol:
                candle_stream.subscribe(self.exchange, self._pair_symbol, timeframe, callback)
        except Exception:
            pass

    def desuscribir_vela(self, timeframe: str):
        try:
            from backend.services import candle_stream
            if hasattr(candle_stream, "unsubscribe") and self._pair_symbol:
                candle_stream.unsubscribe(self.exchange, self._pair_symbol, timeframe)
        except Exception:
            pass

    def suscribir_orderbook(self, depth, callback):
        # TODO §8: delegar en adapter.watch_orderbook o orderbook_capture generalizado.
        pass
