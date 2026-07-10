"""
AXIOM v2 — Servicio de precio en vivo (price_stream), dinámico.
════════════════════════════════════════════════════════════════════════════
Mantiene el ÚLTIMO PRECIO de cada par seguido, en memoria, alimentado por los
adaptadores de exchange en tiempo real (WebSocket).

SEGUIMIENTO DINÁMICO por MOTIVOS (reference counting):
  - Un par se sigue mientras alguna fuente lo requiera. Motivos posibles:
      "watchlist"  → está en la lista de seguimiento
      "chart"      → es el par activo (o persistido) del gráfico
  - track(exchange, pair, coin_id, source)  → suma el par o el motivo.
  - untrack(exchange, pair, source)         → quita el motivo; si no queda
    ninguno, deja de seguir el par (y re-suscribe la conexión del exchange).
  - Cada agregar/quitar es un aviso EXPLÍCITO disparado por la acción del usuario
    (clic). No hay relevo periódico: la acción avisa.

CARGA INICIAL al arrancar: watchlist (motivo "watchlist") + chart_state (motivo
"chart"), así la app abre con precio en vivo tanto en la lista como en el gráfico
que se va a restaurar.

DISEÑO MULTI-PAR (escala a ~100 pares): UNA conexión WebSocket por exchange que
sigue todos sus pares; al cambiar la lista de un exchange, se re-suscribe (no se
reconecta). SEPARADO del capturador de order book.

Se arranca como tarea de fondo desde el lifespan de FastAPI.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone

from backend.exchanges import get_adapter

logger = logging.getLogger(__name__)

# Estado de precios en memoria: {"exchange:PAIR": {price,bid,ask,ts,exchange,pair_symbol,coin_id}}
_prices: dict[str, dict] = {}

# Registro de seguimiento: {"exchange:PAIR": {"coin_id": str, "sources": set[str]}}
_tracked: dict[str, dict] = {}

# Por exchange: la tarea de conexión y un Event para señalar "la lista cambió"
_ex_tasks:  dict[str, asyncio.Task] = {}
_ex_dirty:  dict[str, asyncio.Event] = {}

_pool = None   # pool de PostgreSQL, seteado en run_price_stream


def _key(exchange: str, pair_symbol: str) -> str:
    return f"{exchange}:{pair_symbol.upper()}"


def get_prices() -> dict:
    return dict(_prices)


def get_price(exchange: str, pair_symbol: str) -> dict | None:
    return _prices.get(_key(exchange, pair_symbol))


def _pairs_of(exchange: str) -> list[str]:
    """Pares actualmente seguidos de un exchange."""
    pref = f"{exchange}:"
    return [k[len(pref):] for k in _tracked if k.startswith(pref)]


def _mark_dirty(exchange: str):
    """Señala que la lista de pares de un exchange cambió → re-suscribir."""
    ev = _ex_dirty.get(exchange)
    if ev:
        ev.set()


# ── API pública: track / untrack ──────────────────────────────────────────────
def track(exchange: str, pair_symbol: str, coin_id: str | None, source: str,
          quote: str | None = None):
    """Empieza a seguir un par (o agrega un motivo si ya se seguía)."""
    if not exchange or not pair_symbol:
        return
    exchange = exchange.lower()
    pair_symbol = pair_symbol.upper()
    key = _key(exchange, pair_symbol)
    entry = _tracked.get(key)
    if entry is None:
        adapter = get_adapter(exchange)
        if not adapter.supports("price_rt"):
            logger.info(f"[price_stream] {exchange} sin price_rt; {pair_symbol} no via WS")
            return
        _tracked[key] = {"coin_id": coin_id, "quote": quote, "sources": {source}}
        _ensure_exchange_task(exchange)
        _mark_dirty(exchange)
        logger.info(f"[price_stream] track {key} (source={source}) [nuevo]")
    else:
        entry["sources"].add(source)
        if coin_id and not entry.get("coin_id"):
            entry["coin_id"] = coin_id
        if quote and not entry.get("quote"):
            entry["quote"] = quote


def untrack(exchange: str, pair_symbol: str, source: str):
    """Quita un motivo; si no queda ninguno, deja de seguir el par."""
    if not exchange or not pair_symbol:
        return
    exchange = exchange.lower()
    pair_symbol = pair_symbol.upper()
    key = _key(exchange, pair_symbol)
    entry = _tracked.get(key)
    if not entry:
        return
    entry["sources"].discard(source)
    if not entry["sources"]:
        del _tracked[key]
        _prices.pop(key, None)
        _mark_dirty(exchange)
        logger.info(f"[price_stream] untrack {key} (source={source}) [ya nadie lo pide]")
    else:
        logger.info(f"[price_stream] untrack {key} (source={source}) [quedan {entry['sources']}]")


# ── Conexión por exchange (una, multi-par, re-suscribible) ────────────────────
def _ensure_exchange_task(exchange: str):
    if exchange in _ex_tasks and not _ex_tasks[exchange].done():
        return
    _ex_dirty[exchange] = asyncio.Event()
    _ex_tasks[exchange] = asyncio.create_task(_run_exchange(exchange))


async def _run_exchange(exchange: str):
    """Mantiene UNA conexión al exchange siguiendo sus pares. Cuando la lista
    cambia (dirty), corta el watch actual y re-suscribe con la nueva lista."""
    adapter = get_adapter(exchange)
    dirty = _ex_dirty[exchange]

    async def on_update(pair_symbol: str, price_obj: dict):
        key = _key(exchange, pair_symbol)
        ent = _tracked.get(key)
        _prices[key] = {
            "exchange":    exchange,
            "pair_symbol": pair_symbol.upper(),
            "coin_id":     ent.get("coin_id") if ent else None,
            "quote":       ent.get("quote") if ent else None,
            "price":       price_obj.get("price"),
            "bid":         price_obj.get("bid"),
            "ask":         price_obj.get("ask"),
            "ts":          price_obj.get("ts") or int(datetime.now(timezone.utc).timestamp()),
        }

    while True:
        pairs = _pairs_of(exchange)
        if not pairs:
            # nada que seguir: esperar a que aparezca algo (o terminar)
            dirty.clear()
            try:
                await asyncio.wait_for(dirty.wait(), timeout=30)
            except asyncio.TimeoutError:
                if not _pairs_of(exchange):
                    logger.info(f"[price_stream] {exchange} sin pares; tarea en espera")
                    continue
            continue

        dirty.clear()
        logger.info(f"[price_stream] {exchange}: suscribiendo {len(pairs)} pares: {pairs}")
        # Correr watch_prices hasta que la lista cambie (dirty) → entonces re-suscribir.
        watch_task = asyncio.create_task(adapter.watch_prices(pairs, on_update))
        dirty_task = asyncio.create_task(dirty.wait())
        done, pending = await asyncio.wait(
            {watch_task, dirty_task}, return_when=asyncio.FIRST_COMPLETED)
        # cortar ambas para re-evaluar la lista
        for t in (watch_task, dirty_task):
            if not t.done():
                t.cancel()
                try: await t
                except (asyncio.CancelledError, Exception): pass
        # si watch_task terminó por error, loguear; el while reintenta
        if watch_task in done:
            exc = watch_task.exception() if not watch_task.cancelled() else None
            if exc:
                logger.warning(f"[price_stream] {exchange} watch terminó: {exc}; reintenta")
                await asyncio.sleep(2)


# ── Carga inicial + arranque ──────────────────────────────────────────────────
async def _carga_inicial():
    """Sigue los pares de la watchlist (source=watchlist) y el par del gráfico
    persistido (source=chart), para que la app abra con precio en vivo."""
    if _pool is None:
        return
    try:
        async with _pool.acquire() as conn:
            wl = await conn.fetch(
                "SELECT coin_id, exchange, pair_symbol, quote FROM watchlist "
                "WHERE exchange IS NOT NULL AND pair_symbol IS NOT NULL")
            for r in wl:
                track(r["exchange"], r["pair_symbol"], r["coin_id"], "watchlist",
                      quote=r["quote"])

            cs = await conn.fetchrow(
                "SELECT coin_id, exchange, ex_symbol FROM chart_state WHERE id=1")
            if cs and cs["exchange"] and cs["ex_symbol"]:
                # el quote del par del gráfico: derivar del ex_symbol si es posible
                q = None
                exsym = (cs["ex_symbol"] or "").upper()
                for suf in ("USDT", "USDC", "BTC", "ETH", "USD"):
                    if exsym.endswith(suf):
                        q = suf
                        break
                track(cs["exchange"], cs["ex_symbol"], cs["coin_id"], "chart", quote=q)
        logger.info(f"[price_stream] carga inicial: {len(_tracked)} pares seguidos")
    except Exception as e:
        logger.warning(f"[price_stream] carga inicial falló: {e}")


async def run_price_stream(pool=None):
    """Arranque del servicio. Recibe el pool de PostgreSQL para la carga inicial."""
    global _pool
    _pool = pool
    await _carga_inicial()
    # El servicio queda vivo; las tareas por exchange se crean on-demand vía track().
    # Este loop solo mantiene la corrutina viva y podría hacer housekeeping liviano.
    while True:
        await asyncio.sleep(3600)
