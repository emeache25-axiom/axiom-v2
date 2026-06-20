"""
AXIOM v2 — Strategy Engine / Motor de Ejecución (paper-trading).

Por cada estrategia ACTIVA, en cada ciclo:
  1. Resuelve sus pares operables (watchlist con bot_enabled + asociados a la
     estrategia, en mexc/coinex).
  2. SALIDAS: para cada posición abierta, pide velas, arma contexto y consulta
     strategy.should_exit(). Cierra si corresponde (o por stop/take).
  3. ENTRADAS: para cada par sin posición abierta en esa estrategia, arma
     contexto y consulta strategy.should_enter(). Abre si hay cupo y balance.
  4. Registra equity de la estrategia (curva).

Cada estrategia maneja SU capital (balance propio). Las stats se calculan
aparte (stats_engine), siempre por strategy_id.

El precio de ejecución sale del data_engine (último close del timeframe de la
estrategia, del exchange del par).
"""
from __future__ import annotations
import json
import logging
from datetime import datetime, timezone

from .data_engine import data_engine
from .feature_engine import FeatureContext
from .strategy_base import registry

# Notificación reutilizando el servicio de alertas (Telegram)
try:
    from backend.services.alert_service import send_telegram
except Exception:
    async def send_telegram(text):  # fallback en tests
        return False

logger = logging.getLogger(__name__)


def _fmt(v) -> str:
    if v is None:
        return "—"
    v = float(v)
    return f"{v:,.4f}" if abs(v) < 1 else f"{v:,.2f}"


async def _strategy_pairs(conn, strategy_id: int) -> list[dict]:
    """
    Pares operables para una estrategia: en la watchlist, operables,
    con bot activado, y asociados a esta estrategia (watchlist_strategy).
    """
    return [dict(r) for r in await conn.fetch("""
        SELECT w.id AS watchlist_id, w.coin_id, w.base, w.quote, w.exchange, w.pair_symbol
        FROM watchlist w
        JOIN watchlist_strategy ws ON ws.watchlist_id = w.id AND ws.enabled = true
        WHERE w.operable = true AND w.bot_enabled = true AND ws.strategy_id = $1
    """, strategy_id)]


async def _price_now(pair_symbol: str, timeframe: str, exchange: str) -> float | None:
    candles = await data_engine.get_candles(pair_symbol, timeframe, exchange, limit=2)
    if candles:
        return candles[-1]["close"]
    return None


async def run_cycle(pool) -> dict:
    """Ejecuta un ciclo para TODAS las estrategias activas."""
    async with pool.acquire() as conn:
        strategies = [dict(r) for r in await conn.fetch(
            "SELECT * FROM strat_strategies WHERE enabled = true"
        )]
    if not strategies:
        return {"strategies": 0, "opened": 0, "closed": 0}

    total_open = total_close = 0
    for srow in strategies:
        o, c = await _run_strategy(pool, srow)
        total_open += o
        total_close += c

    return {"strategies": len(strategies), "opened": total_open, "closed": total_close}


async def _run_strategy(pool, srow: dict) -> tuple[int, int]:
    strat = registry.get(srow["key"])
    if not strat:
        logger.warning(f"[exec] estrategia plugin '{srow['key']}' no encontrada")
        return (0, 0)

    # Params efectivos (defaults + overrides guardados)
    overrides = srow["params"]
    if isinstance(overrides, str):
        try: overrides = json.loads(overrides)
        except Exception: overrides = {}
    p = strat.merge_params(overrides)
    tf = strat.timeframe
    sid = srow["id"]

    async with pool.acquire() as conn:
        pairs = await _strategy_pairs(conn, sid)
        open_pos = [dict(r) for r in await conn.fetch(
            "SELECT * FROM strat_positions WHERE strategy_id=$1 AND status='open'", sid
        )]

    opened = closed = 0
    open_by_pair = {pos["pair_symbol"] for pos in open_pos}

    # ── SALIDAS ──────────────────────────────────────────────────────────────
    for pos in open_pos:
        candles = await data_engine.get_candles(
            pos["pair_symbol"], tf, pos["exchange"], limit=strat.lookback)
        if not candles:
            continue
        ctx = FeatureContext(candles)
        price = ctx.price
        sig = strat.should_exit(pos, ctx, p)
        if not sig:
            continue
        entry = float(pos["entry_price"])
        qty = float(pos["qty"])
        proceeds = qty * price
        pnl = proceeds - float(pos["amount"])
        pnl_pct = (price - entry) / entry * 100
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE strat_positions
                SET status='closed', exit_price=$1, pnl=$2, pnl_pct=$3,
                    exit_reason=$4, closed_at=now()
                WHERE id=$5
            """, price, round(pnl, 2), round(pnl_pct, 4), sig.reason, pos["id"])
            await conn.execute(
                "UPDATE strat_strategies SET balance = balance + $1 WHERE id=$2",
                round(proceeds, 2), sid)
            await conn.execute("""
                INSERT INTO strat_signals (strategy_id, pair_symbol, action, detail)
                VALUES ($1,$2,'exit',$3)
            """, sid, pos["pair_symbol"], sig.reason)
        closed += 1
        open_by_pair.discard(pos["pair_symbol"])
        emoji = "🟢" if pnl >= 0 else "🔴"
        await send_telegram(
            f"{emoji} <b>{srow['name']}</b> cerró {pos['base']}/{pos['quote']}\n"
            f"${_fmt(entry)} → ${_fmt(price)}  ·  P&L <b>${_fmt(pnl)}</b> ({pnl_pct:+.2f}%)\n"
            f"Motivo: {sig.reason}"
        )

    # ── ENTRADAS ─────────────────────────────────────────────────────────────
    async with pool.acquire() as conn:
        s = dict(await conn.fetchrow("SELECT * FROM strat_strategies WHERE id=$1", sid))
    balance = float(s["balance"])
    trade_amount = float(s["trade_amount"])
    max_pos = int(s["max_positions"])
    n_open = len(open_by_pair)

    for pair in pairs:
        if pair["pair_symbol"] in open_by_pair:
            continue
        if n_open >= max_pos or balance < trade_amount:
            break
        candles = await data_engine.get_candles(
            pair["pair_symbol"], tf, pair["exchange"], limit=strat.lookback)
        if not candles:
            continue
        ctx = FeatureContext(candles)
        sig = strat.should_enter(ctx, p)

        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO strat_signals (strategy_id, pair_symbol, action, detail)
                VALUES ($1,$2,$3,$4)
            """, sid, pair["pair_symbol"], "enter" if sig else "skip",
                sig.reason if sig else "sin señal")

        if not sig:
            continue
        price = ctx.price
        if not price or price <= 0:
            continue
        qty = trade_amount / price
        stop = sig.stop_price if sig.stop_price else price * (1 - s["stop_loss_pct"] / 100)

        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO strat_positions
                    (strategy_id, watchlist_id, coin_id, base, quote, exchange, pair_symbol,
                     status, entry_price, qty, amount, stop_price, take_price, entry_reason)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,$12,$13)
            """, sid, pair["watchlist_id"], pair["coin_id"], pair["base"], pair["quote"],
                pair["exchange"], pair["pair_symbol"], price, qty, trade_amount,
                stop, sig.take_price, sig.reason)
            await conn.execute(
                "UPDATE strat_strategies SET balance = balance - $1 WHERE id=$2",
                trade_amount, sid)
        opened += 1
        n_open += 1
        balance -= trade_amount
        open_by_pair.add(pair["pair_symbol"])
        await send_telegram(
            f"🤖 <b>{srow['name']}</b> abrió {pair['base']}/{pair['quote']}\n"
            f"Entrada ${_fmt(price)}  ·  ${_fmt(trade_amount)}\n"
            f"Stop ${_fmt(stop)}" + (f"  ·  Target ${_fmt(sig.take_price)}" if sig.take_price else "") +
            f"\n{sig.reason}"
        )

    # ── Registrar equity de la estrategia ────────────────────────────────────
    await _record_equity(pool, sid, tf)
    return (opened, closed)


async def _record_equity(pool, sid: int, tf: str):
    """Calcula equity (balance libre + valor de mercado de abiertas) y lo guarda."""
    async with pool.acquire() as conn:
        s = dict(await conn.fetchrow("SELECT balance FROM strat_strategies WHERE id=$1", sid))
        open_pos = [dict(r) for r in await conn.fetch(
            "SELECT qty, pair_symbol, exchange FROM strat_positions WHERE strategy_id=$1 AND status='open'", sid)]
    market = 0.0
    for pos in open_pos:
        price = data_engine.last_price(pos["pair_symbol"], tf, pos["exchange"])
        if price is None:
            price = await _price_now(pos["pair_symbol"], tf, pos["exchange"]) or 0
        market += float(pos["qty"]) * (price or 0)
    equity = round(float(s["balance"]) + market, 2)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO strat_equity (strategy_id, equity) VALUES ($1,$2)", sid, equity)
