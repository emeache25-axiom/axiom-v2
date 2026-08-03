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
from backend.domain.registry import capacidad, Param
from backend.exchanges import get_adapter


# Los tres parámetros que el registro usa para CONSTRUIR el Par antes de correr
# la capacidad: domain.coin(coin_id).par(exchange, quote). Toda capacidad de
# entidad 'par' los declara; se definen una vez acá para no repetirlos.
_P_COIN = Param(
    nombre="coin_id", tipo=str, requerido=True,
    descripcion=("id de CoinGecko de la coin, en minúsculas y con guiones. "
                 "NO el símbolo (usar 'ontology', no 'ONT')"),
    ejemplos=("bitcoin", "ethereum", "ontology"),
)
_P_EXCHANGE = Param(
    nombre="exchange", tipo=str, requerido=True, opciones=("mexc", "coinex"),
    descripcion="exchange donde vive el par. Solo mexc y coinex son operables.",
    ejemplos=("mexc", "coinex"),
)
_P_QUOTE = Param(
    nombre="quote", tipo=str, requerido=True,
    descripcion="moneda de cotización del par (contra qué se opera).",
    ejemplos=("USDT", "BTC"),
)


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

    @capacidad(
        nombre="precio_par",
        descripcion=(
            "El último precio de un par concreto en un exchange concreto. Usar "
            "cuando importa el precio EN un exchange puntual (ej. ONT/BTC en "
            "MEXC), no el precio agregado de la coin. Para el precio general de "
            "una coin, usar analizar_coin."
        ),
        entidad="par",
        categoria="par",
        costo="barato",
        devuelve=(
            "price, bid, ask, change_24h, high_24h, low_24h, volume_24h y "
            "timestamp — o price null si el par no está siendo seguido en vivo"
        ),
        mide=(
            "el último precio del par que hay en memoria del servicio de precios "
            "(price_stream), que solo tiene los pares actualmente suscritos"
        ),
        infiere="nada",
        no_sabe=(
            "el precio si el par no está siendo seguido en vivo: en ese caso "
            "devuelve price null en vez de ir a buscarlo al exchange. Tampoco "
            "sabe hace cuánto es ese último precio si el stream se atrasó"
        ),
        fuente="price_stream (últimos precios en memoria de los pares suscritos)",
        metodo="lectura del último tick cacheado para exchange+pair_symbol",
        parametros=[_P_COIN, _P_EXCHANGE, _P_QUOTE],
    )
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

    @capacidad(
        nombre="velas_par",
        descripcion=(
            "Velas OHLCV históricas de un par (open, high, low, close, volumen) "
            "en una temporalidad. Usar para ver la evolución reciente del precio "
            "de un par concreto en su exchange."
        ),
        entidad="par",
        categoria="par",
        costo="medio",
        devuelve=(
            "lista de velas [{time (segundos UTC), open, high, low, close, "
            "volume}], de la más antigua a la más reciente"
        ),
        mide=(
            "las velas OHLCV tal como las devuelve el exchange para ese par y "
            "esa temporalidad, en la ventana pedida"
        ),
        infiere="nada: son datos crudos del exchange, sin lectura ni indicadores",
        no_sabe=(
            "nada sobre lo que las velas significan: no dice si el precio va a "
            "subir o bajar, ni calcula tendencia, soporte o patrón. Tampoco "
            "garantiza continuidad si el exchange tuvo huecos de datos"
        ),
        fuente="adaptador del exchange (MEXC/CoinEx), consultado en vivo",
        metodo="get_ohlcv del adaptador, normalizado a segundos UTC",
        parametros=[
            _P_COIN, _P_EXCHANGE, _P_QUOTE,
            Param(
                nombre="timeframe", tipo=str, requerido=False, default="1d",
                opciones=("5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"),
                descripcion="temporalidad de cada vela.",
                ejemplos=("1h", "1d"),
            ),
            Param(
                nombre="limit", tipo=int, requerido=False, default=30,
                descripcion=("cuántas velas traer (máximo 200; en conversación "
                             "pocas velas suelen alcanzar)."),
                ejemplos=(30, 100),
            ),
        ],
    )
    async def velas_hist(self, timeframe: str = "1d", limit: int = 30,
                         start_ms: int | None = None,
                         end_ms: int | None = None) -> list:
        """
        Velas OHLCV históricas del par. Fuente: adaptador del exchange (única
        puerta a datos de mercado). Formato normalizado:
        [{time, open, high, low, close, volume}] con time en segundos UTC.
        start_ms/end_ms opcionales para paginar rangos (scroll del gráfico).
        """
        limit = max(1, min(int(limit or 30), 200))   # tope duro: nunca 500 en chat
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

    @capacidad(
        nombre="libro_par",
        descripcion=(
            "El libro de órdenes (profundidad) de un par en un momento: las "
            "órdenes de compra (bids) y venta (asks) con su precio y cantidad. "
            "Usar para ver la liquidez inmediata y el spread de un par."
        ),
        entidad="par",
        categoria="par",
        costo="medio",
        devuelve=(
            "timestamp, bids (compras) y asks (ventas), cada uno como lista de "
            "[precio, cantidad], ordenados del mejor precio hacia afuera"
        ),
        mide=(
            "las órdenes visibles en el libro del exchange en el instante del "
            "pedido, hasta la profundidad solicitada"
        ),
        infiere="nada: es una foto del libro tal como lo publica el exchange",
        no_sabe=(
            "si esas órdenes son reales y se van a ejecutar: el libro puede "
            "tener órdenes falsas (spoofing) que se retiran antes de tocarse, "
            "así que la profundidad visible no equivale a liquidez garantizada. "
            "Es una foto de un instante, no dice cómo evoluciona"
        ),
        fuente="adaptador del exchange (MEXC/CoinEx), consultado en vivo",
        metodo="get_orderbook del adaptador a la profundidad pedida",
        parametros=[
            _P_COIN, _P_EXCHANGE, _P_QUOTE,
            Param(
                nombre="depth", tipo=int, requerido=False, default=20,
                descripcion="cuántos niveles de precio traer por lado.",
                ejemplos=(20, 50),
            ),
        ],
    )
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

    @capacidad(
        nombre="estado_grafico",
        descripcion=(
            "Qué par y temporalidad tiene cargados ahora mismo la pantalla de "
            "gráficos (el estado persistido del gráfico). Usar para saber qué "
            "está mirando el usuario en el gráfico."
        ),
        entidad="par",
        categoria="par",
        costo="barato",
        devuelve="coin_id, timeframe, exchange y ex_symbol cargados en el gráfico",
        mide="la fila de estado del gráfico guardada en la base (chart_state)",
        infiere="nada",
        no_sabe=(
            "nada más que lo guardado: es el último estado que la pantalla "
            "persistió, no dice si el usuario sigue mirándolo ni qué hizo después"
        ),
        fuente="tabla chart_state (PG), fila única del gráfico",
        metodo="lectura directa de chart_state",
        parametros=[_P_COIN, _P_EXCHANGE, _P_QUOTE],
    )
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
