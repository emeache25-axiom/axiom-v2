"""
AXIOM v2 — Capturador de Order Book (CoinEx WebSocket v2).

Se conecta al WebSocket de profundidad de CoinEx, mantiene el libro actualizado
en memoria, y persiste un SNAPSHOT a PostgreSQL cada `SNAPSHOT_EVERY_S` segundos.

Diseño (hardware modesto):
  - Un solo WebSocket para todos los pares (CoinEx permite multi-market).
  - El libro se mantiene en RAM y se muestrea cada 2s (no se guarda cada push de
    200ms, sería 10× más datos sin valor añadido para nuestro análisis).
  - Robusto: reconexión automática con backoff, ping cada 30s (CoinEx corta a los
    60s de silencio), y persistencia que no acumula en RAM.

Protocolo CoinEx v2 (verificado en docs oficiales):
  - método: depth.subscribe
  - params: {"market_list": [["ONTBTC", 10, "0", true], ...]}
      [pair, profundidad, merge_interval, full_push]
      full_push=true → cada push trae el libro COMPLETO (no incremental).
  - keepalive: enviar {"method":"server.ping","params":[],"id":N} < 60s.
  - respuesta de datos: {"method":"depth.update","data":{"market":..,"depth":{"bids":[[p,v]..],"asks":[..]}}}

Uso: se arranca como tarea de fondo desde el lifespan de FastAPI (ver integración
en scheduler/tasks). NO usa APScheduler porque es un WebSocket persistente, no un
job periódico — corre continuo en su propia task asyncio.
"""
from __future__ import annotations
import asyncio
import gzip
import json
import logging
from datetime import datetime, timezone

import asyncpg

try:
    import websockets
except ImportError:
    websockets = None  # se valida al arrancar

logger = logging.getLogger(__name__)


def _decode(raw):
    """CoinEx comprime los mensajes del WS con gzip. Si llega bytes, descomprimir;
    si llega str (por si acaso), usar directo."""
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw

# ── Configuración ────────────────────────────────────────────────────────────
COINEX_WS_URL   = "wss://socket.coinex.com/v2/spot"
PAIRS           = ["ONTBTC", "ROSEBTC"]     # pares a capturar (satoshi /BTC)
DEPTH_LEVELS    = 10                          # niveles por lado
SNAPSHOT_EVERY_S = 2.0                         # muestreo a PostgreSQL
PING_EVERY_S     = 30.0                        # keepalive (CoinEx corta a 60s)
RECONNECT_BASE_S = 2.0                          # backoff inicial de reconexión
RECONNECT_MAX_S  = 60.0

# Estado del libro en memoria: {pair: {"bids": [...], "asks": [...], "ts": ...}}
_books: dict[str, dict] = {}


def _compute_metrics(bids: list, asks: list) -> dict:
    """Calcula best bid/ask, mid, spread y desequilibrio sobre los niveles dados.
    bids/asks son listas [[precio_str, volumen_str], ...] ordenadas (mejor primero)."""
    def _num(rows):
        out = []
        for r in rows:
            try:
                out.append((float(r[0]), float(r[1])))
            except (TypeError, ValueError, IndexError):
                continue
        return out

    b = _num(bids); a = _num(asks)
    if not b or not a:
        return {}

    best_bid = b[0][0]; best_ask = a[0][0]
    mid = (best_bid + best_ask) / 2 if (best_bid and best_ask) else None
    spread_pct = ((best_ask - best_bid) / mid * 100) if mid else None
    bid_vol = sum(v for _, v in b)
    ask_vol = sum(v for _, v in a)
    tot = bid_vol + ask_vol
    imbalance = ((bid_vol - ask_vol) / tot) if tot > 0 else None
    return {
        "best_bid": best_bid, "best_ask": best_ask, "mid": mid,
        "spread_pct": spread_pct, "bid_vol": bid_vol, "ask_vol": ask_vol,
        "imbalance": imbalance,
    }


async def _persist_snapshots(pool: asyncpg.Pool):
    """Cada SNAPSHOT_EVERY_S, toma el libro actual de cada par y lo escribe a PG."""
    while True:
        await asyncio.sleep(SNAPSHOT_EVERY_S)
        rows = []
        now = datetime.now(timezone.utc)
        for pair, book in list(_books.items()):
            bids = book.get("bids"); asks = book.get("asks")
            if not bids or not asks:
                continue
            m = _compute_metrics(bids, asks)
            if not m:
                continue
            rows.append((
                now, "coinex", pair,
                m["best_bid"], m["best_ask"], m["mid"], m["spread_pct"],
                m["bid_vol"], m["ask_vol"], m["imbalance"],
                json.dumps(bids[:DEPTH_LEVELS]), json.dumps(asks[:DEPTH_LEVELS]),
            ))
        if not rows:
            continue
        try:
            async with pool.acquire() as conn:
                await conn.executemany("""
                    INSERT INTO ob_snapshots
                      (ts, exchange, pair, best_bid, best_ask, mid, spread_pct,
                       bid_vol, ask_vol, imbalance, bids, asks)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                """, rows)
        except Exception as exc:
            logger.error(f"[ob_capture] error persistiendo snapshots: {exc}")


async def _ping_loop(ws):
    """Mantiene viva la conexión (CoinEx corta a los 60s de silencio)."""
    pid = 1000
    while True:
        await asyncio.sleep(PING_EVERY_S)
        pid += 1
        try:
            await ws.send(json.dumps({"method": "server.ping", "params": [], "id": pid}))
        except Exception:
            return  # la conexión murió; el loop principal reconecta


def _handle_depth_message(msg: dict):
    """Procesa un mensaje depth.update y actualiza el libro en memoria.
    Solo acepta libros COMPLETOS (is_full=true). Con full push CoinEx manda el
    libro entero; ignoramos incrementales para no guardar un libro truncado."""
    data = msg.get("data") or {}
    market = data.get("market")
    if not market:
        return
    if not data.get("is_full", False):
        return  # incremental: lo ignoramos (pedimos full push)
    depth = data.get("depth") or {}
    bids = depth.get("bids"); asks = depth.get("asks")
    if bids is not None and asks is not None:
        _books[market] = {
            "bids": bids, "asks": asks,
            "ts": datetime.now(timezone.utc),
        }


async def _subscribe(ws):
    """Envía la suscripción de profundidad para todos los pares (full push)."""
    market_list = [[p, DEPTH_LEVELS, "0", True] for p in PAIRS]  # True = full push
    await ws.send(json.dumps({
        "method": "depth.subscribe",
        "params": {"market_list": market_list},
        "id": 1,
    }))
    logger.info(f"[ob_capture] suscripto a depth de {PAIRS} ({DEPTH_LEVELS} niveles)")


async def run_capture(pool: asyncpg.Pool):
    """Loop principal: conecta, suscribe, procesa mensajes, reconecta si cae.
    Corre indefinidamente como task de fondo."""
    if websockets is None:
        logger.error("[ob_capture] falta la librería 'websockets' (pip install websockets)")
        return

    # arranca el persistidor en paralelo (comparte _books en memoria)
    persist_task = asyncio.create_task(_persist_snapshots(pool))
    backoff = RECONNECT_BASE_S

    while True:
        try:
            async with websockets.connect(
                COINEX_WS_URL, ping_interval=None, max_size=2**22
            ) as ws:
                await _subscribe(ws)
                ping_task = asyncio.create_task(_ping_loop(ws))
                backoff = RECONNECT_BASE_S  # reset al conectar bien
                logger.info("[ob_capture] conectado a CoinEx WS")
                try:
                    async for raw in ws:
                        try:
                            msg = json.loads(_decode(raw))
                        except Exception:
                            continue
                        if msg.get("method") == "depth.update":
                            _handle_depth_message(msg)
                        # respuestas a ping/subscribe se ignoran (result/error)
                finally:
                    ping_task.cancel()
        except Exception as exc:
            logger.warning(f"[ob_capture] conexión caída: {exc}; reconecta en {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_S)  # backoff exponencial
