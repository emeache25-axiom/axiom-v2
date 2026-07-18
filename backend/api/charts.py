"""
AXIOM v2 — Charts API
UDF (Universal Data Feed) para Lightweight Charts.

Las velas históricas se obtienen vía la CAPA DE DOMINIO (Par.velas_hist), que a
su vez usa la librería de adaptadores. Este router YA NO habla con las APIs de
los exchanges directamente: le pide velas al Par y el Par sabe de dónde traerlas.
Exchange SIEMPRE explícito, sin fallback silencioso entre exchanges.
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import timezone, datetime

from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional

from backend.services.price_service import get_price

router = APIRouter(prefix="/api/charts", tags=["charts"])
logger = logging.getLogger(__name__)

# Timeframes canónicos válidos (la traducción por-exchange vive en los adaptadores)
_TIMEFRAMES = ("5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")


# ── UDF History endpoint ──────────────────────────────────────────────────────

@router.get("/history")
async def get_history(
    request:   Request,
    coin_id:   str,
    timeframe: str  = "1d",
    from_ts:   int  = 0,      # timestamp unix segundos
    to_ts:     int  = 0,
    limit:     int  = 1000,
    exchange:  Optional[str] = None,   # par específico (opcional, desde el front)
    ex_symbol: Optional[str] = None,   # símbolo real del par, ej. ONTBTC
):
    """
    UDF endpoint: devuelve velas entre from_ts y to_ts.
    Si from_ts=0 → devuelve las últimas `limit` velas.

    Si el frontend envía exchange + ex_symbol, se respeta ESE par exacto
    (permite distinguir ONT/BTC de ONT/USDT). Si no vienen, se resuelve uno
    desde coin_exchanges (comportamiento anterior, compatible).
    """
    if timeframe not in _TIMEFRAMES:
        raise HTTPException(400, f"Timeframe inválido. Válidos: {list(_TIMEFRAMES)}")
    limit = min(max(limit, 10), 1000)

    # ¿el par vino explícito desde el frontend?
    pair_forzado = bool(ex_symbol)

    pool   = request.app.state.db_pool
    domain = request.app.state.domain

    async with pool.acquire() as conn:
        coin_info = await conn.fetchrow(
            "SELECT symbol, name, price, change_24h, image FROM coins WHERE id=$1",
            coin_id)
        # Solo resolvemos el par si el frontend NO lo especificó.
        if not pair_forzado:
            ex_row = await conn.fetchrow(
                "SELECT exchange, symbol FROM coin_exchanges WHERE coin_id=$1 LIMIT 1",
                coin_id)
            if ex_row:
                exchange  = ex_row["exchange"]
                ex_symbol = ex_row["symbol"]

    if not coin_info:
        raise HTTPException(404, "Coin no encontrada")

    if not exchange:
        exchange = "coingecko"
    if not ex_symbol:
        ex_symbol = coin_id

    # Traer velas vía la capa de dominio: el Par usa el adaptador del exchange.
    # Exchange explícito, sin fallback silencioso (si el par no tiene datos en su
    # exchange, se devuelve vacío — no se muestra otro par disfrazado).
    # El quote no es necesario aquí: fijamos el pair_symbol exacto (ex_symbol).
    start_ms = from_ts * 1000 if from_ts else None
    end_ms   = to_ts   * 1000 if to_ts   else None
    par = domain.coin(coin_id).par(exchange, quote="").con_pair_symbol(ex_symbol)
    candles = await par.velas_hist(timeframe=timeframe, limit=limit,
                                   start_ms=start_ms, end_ms=end_ms)

    if not candles:
        # Para coins solo en CoinGecko, solo disponible 1d/1w/1M
        if timeframe not in ("1d", "1w", "1M"):
            return {
                "coin_id": coin_id, "timeframe": timeframe,
                "candles": [], "total": 0, "no_data": True,
                "message": "Datos intraday no disponibles para esta coin"
            }
        raise HTTPException(503, "No se pudieron obtener datos OHLCV")

    # Actualizar chart_state (incluye el par exacto para restaurarlo luego)
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO chart_state (id, coin_id, timeframe, exchange, ex_symbol, updated_at)
            VALUES (1,$1,$2,$3,$4,now())
            ON CONFLICT (id) DO UPDATE SET
                coin_id=$1, timeframe=$2, exchange=$3, ex_symbol=$4, updated_at=now()
        """, coin_id, timeframe, exchange, ex_symbol)

    return {
        "coin_id":    coin_id,
        "symbol":     coin_info["symbol"].upper(),
        "name":       coin_info["name"],
        "image":      coin_info["image"],
        "price":      float(coin_info["price"])      if coin_info["price"]      else None,
        "change_24h": float(coin_info["change_24h"]) if coin_info["change_24h"] else None,
        "timeframe":  timeframe,
        "exchange":   exchange,
        "ex_symbol":  ex_symbol,
        "candles":    candles,
        "total":      len(candles),
        "no_data":    False,
    }


# ── Estado ────────────────────────────────────────────────────────────────────

@router.get("/state")
async def get_chart_state(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT coin_id, timeframe, exchange, ex_symbol FROM chart_state WHERE id=1")
    return {
        "coin_id":   row["coin_id"]   if row else "bitcoin",
        "timeframe": row["timeframe"] if row else "1d",
        "exchange":  row["exchange"]  if row else None,
        "ex_symbol": row["ex_symbol"] if row else None,
    }


@router.get("/price/{coin_id}")
async def get_current_price(request: Request, coin_id: str):
    """Último precio del par, de la MISMA fuente que la watchlist (price_service).
    Permite que el header del gráfico muestre el mismo precio que las listas.
    Acepta el par explícito para respetar /BTC vs /USDT."""
    pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        # Buscar el par tal como está en la watchlist (para usar el quote correcto)
        wl = await conn.fetchrow(
            "SELECT base, quote, exchange, pair_symbol FROM watchlist WHERE coin_id=$1 LIMIT 1",
            coin_id)
        coin = await conn.fetchrow(
            "SELECT symbol, price, change_24h FROM coins WHERE id=$1", coin_id)
        db_price = {"price": float(coin["price"]) if coin and coin["price"] else None,
                    "change_24h": float(coin["change_24h"]) if coin and coin["change_24h"] else None}

    if wl:
        symbol      = wl["base"]
        exchange    = wl["exchange"]
        pair_symbol = wl["pair_symbol"]
        quote       = wl["quote"]
    else:
        # no está en watchlist: resolver desde coin_exchanges
        async with pool.acquire() as conn:
            ex = await conn.fetchrow(
                "SELECT exchange, symbol FROM coin_exchanges WHERE coin_id=$1 LIMIT 1", coin_id)
        symbol      = coin["symbol"] if coin else coin_id
        exchange    = ex["exchange"] if ex else "coingecko"
        pair_symbol = ex["symbol"]   if ex else None
        quote       = None

    price = await get_price(symbol, exchange, db_price,
                            pair_symbol=pair_symbol, quote=quote)
    return {
        "coin_id":    coin_id,
        "price":      price.get("price"),
        "change_24h": price.get("change_24h"),
        "quote":      quote or "USDT",
    }


# ── WebSocket Manager ─────────────────────────────────────────────────────────

class WsManager:
    """
    Gestiona la conexión WebSocket hacia Binance y los clientes browser.
    Una conexión a Binance sirve múltiples clientes.
    """
    def __init__(self):
        self._clients:  dict[str, set[WebSocket]] = {}  # symbol → set of ws
        self._binance_ws = None
        self._subscribed: set[str] = set()
        self._task = None
        self._lock = asyncio.Lock()

    async def connect_client(self, ws: WebSocket, symbol: str):
        await ws.accept()
        async with self._lock:
            if symbol not in self._clients:
                self._clients[symbol] = set()
            self._clients[symbol].add(ws)
            await self._ensure_subscribed(symbol)
        logger.info(f"[ws] Cliente conectado: {symbol} ({len(self._clients[symbol])} total)")

    async def disconnect_client(self, ws: WebSocket, symbol: str):
        async with self._lock:
            if symbol in self._clients:
                self._clients[symbol].discard(ws)
                if not self._clients[symbol]:
                    del self._clients[symbol]
        logger.info(f"[ws] Cliente desconectado: {symbol}")

    async def broadcast(self, symbol: str, data: dict):
        clients = self._clients.get(symbol, set()).copy()
        dead = set()
        for ws in clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._clients.get(symbol, set()).discard(ws)

    async def _ensure_subscribed(self, symbol: str):
        """Asegura que el símbolo esté en la suscripción de Binance."""
        if symbol.upper() in self._subscribed:
            return
        self._subscribed.add(symbol.upper())
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._binance_loop())

    async def _binance_loop(self):
        """Loop principal de reconexión a Binance WebSocket."""
        backoff = 1
        while True:
            if not self._subscribed:
                await asyncio.sleep(5)
                continue
            try:
                streams = "/".join(
                    f"{s.lower()}@kline_1m" for s in self._subscribed
                )
                url = f"wss://stream.binance.com:9443/stream?streams={streams}"
                logger.info(f"[ws] Conectando a Binance WS: {len(self._subscribed)} streams")

                # Conexión WebSocket a Binance
                import websockets
                async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                    backoff = 1  # reset backoff al conectar exitosamente
                    logger.info("[ws] Binance WS conectado")
                    async for raw in ws:
                        try:
                            msg  = json.loads(raw)
                            data = msg.get("data", {})
                            if data.get("e") != "kline":
                                continue
                            k      = data["k"]
                            symbol = k["s"]   # ej: BTCUSDT
                            candle = {
                                "type":   "tick",
                                "symbol": symbol,
                                "time":   k["t"] // 1000,
                                "open":   float(k["o"]),
                                "high":   float(k["h"]),
                                "low":    float(k["l"]),
                                "close":  float(k["c"]),
                                "volume": float(k["v"]),
                                "closed": k["x"],  # True = vela cerrada
                            }
                            await self.broadcast(symbol, candle)
                        except Exception as e:
                            logger.debug(f"[ws] Error procesando mensaje: {e}")

            except Exception as e:
                logger.warning(f"[ws] Binance WS error: {e} — reconectando en {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)  # backoff exponencial, máx 60s


# Instancia global
ws_manager = WsManager()


@router.websocket("/ws/{coin_id}")
async def chart_ws(websocket: WebSocket, coin_id: str, timeframe: str = "1m"):
    """
    WebSocket para actualizaciones en tiempo real.
    El cliente se suscribe a una coin, recibe ticks de Binance.
    """
    pool = websocket.app.state.db_pool
    async with pool.acquire() as conn:
        ex_row = await conn.fetchrow(
            "SELECT exchange, symbol FROM coin_exchanges WHERE coin_id=$1 AND exchange='binance'",
            coin_id)

    if not ex_row:
        # Coin no disponible en Binance → polling fallback
        await websocket.accept()
        await websocket.send_json({"type": "fallback", "reason": "no_binance"})
        await websocket.close()
        return

    symbol = ex_row["symbol"]
    await ws_manager.connect_client(websocket, symbol)
    try:
        while True:
            # Mantener conexión viva — el cliente puede enviar pings
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Enviar heartbeat
                await websocket.send_json({"type": "heartbeat"})
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect_client(websocket, symbol)


# ── Indicadores ───────────────────────────────────────────────────────────────

class IndicatorCreate(BaseModel):
    type:       str
    params:     dict        = {}
    timeframes: list[str]   = []
    visible:    bool        = True
    position:   str         = "main"
    style:      dict        = {}

class IndicatorUpdate(BaseModel):
    params:     Optional[dict]      = None
    timeframes: Optional[list[str]] = None
    visible:    Optional[bool]      = None
    style:      Optional[dict]      = None

@router.get("/indicators")
async def get_indicators(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM chart_indicators ORDER BY id ASC")
    return {"indicators": [
        {"id": r["id"], "type": r["type"], "params": r["params"],
         "timeframes": r["timeframes"], "visible": r["visible"],
         "position": r["position"], "style": r["style"]}
        for r in rows
    ]}

@router.post("/indicators")
async def create_indicator(request: Request, body: IndicatorCreate):
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO chart_indicators (type,params,timeframes,visible,position,style)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
        """, body.type, json.dumps(body.params), body.timeframes,
             body.visible, body.position, json.dumps(body.style))
    return {"id": row["id"], "status": "ok"}

@router.put("/indicators/{ind_id}")
async def update_indicator(request: Request, ind_id: int, body: IndicatorUpdate):
    async with request.app.state.db_pool.acquire() as conn:
        await conn.execute("""
            UPDATE chart_indicators SET
                params     = COALESCE($2::jsonb, params),
                timeframes = COALESCE($3,        timeframes),
                visible    = COALESCE($4,        visible),
                style      = COALESCE($5::jsonb, style)
            WHERE id=$1
        """, ind_id,
             json.dumps(body.params)   if body.params     is not None else None,
             body.timeframes           if body.timeframes is not None else None,
             body.visible              if body.visible    is not None else None,
             json.dumps(body.style)    if body.style      is not None else None)
    return {"status": "ok"}

@router.delete("/indicators/{ind_id}")
async def delete_indicator(request: Request, ind_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        await conn.execute("DELETE FROM chart_indicators WHERE id=$1", ind_id)
    return {"status": "ok"}


# ── Dibujos ───────────────────────────────────────────────────────────────────

class DrawingCreate(BaseModel):
    coin_id:    str
    type:       str
    timeframes: list[str] = []
    points:     list      = []
    style:      dict      = {}

class DrawingUpdate(BaseModel):
    timeframes: Optional[list[str]] = None
    points:     Optional[list]      = None
    style:      Optional[dict]      = None

@router.get("/drawings/{coin_id}")
async def get_drawings(request: Request, coin_id: str, timeframe: str = ""):
    async with request.app.state.db_pool.acquire() as conn:
        if timeframe:
            rows = await conn.fetch("""
                SELECT * FROM chart_drawings
                WHERE coin_id=$1 AND (timeframes='{}' OR $2=ANY(timeframes))
                ORDER BY id ASC
            """, coin_id, timeframe)
        else:
            rows = await conn.fetch(
                "SELECT * FROM chart_drawings WHERE coin_id=$1 ORDER BY id ASC", coin_id)
    return {"drawings": [
        {"id": r["id"], "type": r["type"], "timeframes": r["timeframes"],
         "points": r["points"], "style": r["style"]}
        for r in rows
    ]}

@router.post("/drawings")
async def create_drawing(request: Request, body: DrawingCreate):
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO chart_drawings (coin_id,type,timeframes,points,style)
            VALUES ($1,$2,$3,$4,$5) RETURNING id
        """, body.coin_id, body.type, body.timeframes,
             json.dumps(body.points), json.dumps(body.style))
    return {"id": row["id"], "status": "ok"}

@router.put("/drawings/{drawing_id}")
async def update_drawing(request: Request, drawing_id: int, body: DrawingUpdate):
    async with request.app.state.db_pool.acquire() as conn:
        await conn.execute("""
            UPDATE chart_drawings SET
                timeframes = COALESCE($2, timeframes),
                points     = COALESCE($3::jsonb, points),
                style      = COALESCE($4::jsonb, style)
            WHERE id=$1
        """, drawing_id,
             body.timeframes          if body.timeframes is not None else None,
             json.dumps(body.points)  if body.points     is not None else None,
             json.dumps(body.style)   if body.style      is not None else None)
    return {"status": "ok"}

@router.delete("/drawings/{drawing_id}")
async def delete_drawing(request: Request, drawing_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        await conn.execute("DELETE FROM chart_drawings WHERE id=$1", drawing_id)
    return {"status": "ok"}

@router.delete("/drawings/coin/{coin_id}")
async def delete_all_drawings(request: Request, coin_id: str):
    async with request.app.state.db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM chart_drawings WHERE coin_id=$1", coin_id)
    return {"status": "ok", "deleted": result}
