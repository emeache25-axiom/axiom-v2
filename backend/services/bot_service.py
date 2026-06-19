"""
AXIOM v2 — Bot de Paper-Trading.

Motor de simulación. En cada ciclo:
  1. Carga config, reglas activas, snapshot de régimen y posiciones abiertas.
  2. GESTIÓN DE SALIDAS: para cada posición abierta, evalúa stop loss y
     reversión de régimen (regimen_corto deja de ser ALCISTA).
  3. GESTIÓN DE ENTRADAS: para cada coin de la watchlist sin posición abierta,
     evalúa las reglas; si alguna matchea y hay balance/cupo, abre posición.
  4. Notifica aperturas y cierres por Telegram.

Todo simulado: no hay órdenes reales. El "precio" sale del price_service
(mismo que usa el resto de la app).
"""
from __future__ import annotations
import json
import logging
from datetime import datetime, timezone

from backend.services.price_service import get_price
from backend.services.alert_service import send_telegram

logger = logging.getLogger(__name__)


def _fmt(v) -> str:
    if v is None:
        return "—"
    v = float(v)
    return f"{v:,.2f}" if abs(v) >= 1 else f"{v:.8f}".rstrip("0").rstrip(".")


async def _coin_price(pool, coin_id: str, symbol: str, exchange: str) -> float | None:
    """
    Precio de una coin usando su exchange configurado, con fallback a la cadena
    del price_service (Binance→MEXC→CoinEx) y finalmente al precio en DB.
    """
    async with pool.acquire() as conn:
        db = await conn.fetchrow("SELECT price FROM coins WHERE id = $1", coin_id)
    db_price = {"price": float(db["price"])} if db and db["price"] is not None else None
    pdata = await get_price(symbol, exchange or "binance", db_price)
    p = pdata.get("price")
    return float(p) if p is not None else None


# ── Evaluación de condiciones de una regla ────────────────────────────────────

def _eval_condition(cond: dict, ctx: dict) -> bool:
    """
    Evalúa una condición {field, op, value} contra el contexto de una coin.
    ctx contiene: regimen_largo/medio/corto, conviccion_*, dist_soporte,
    dist_resistencia, rsi.
    """
    field = cond.get("field")
    op    = cond.get("op")
    value = cond.get("value")
    actual = ctx.get(field)
    if actual is None:
        return False

    if op == "es":
        return str(actual) == str(value)
    if op == "no_es":
        return str(actual) != str(value)
    try:
        a = float(actual); v = float(value)
    except (TypeError, ValueError):
        return False
    if op == "gt":
        return a > v
    if op == "lt":
        return a < v
    return False


def _eval_rule(rule: dict, ctx: dict) -> bool:
    """Una regla matchea si TODAS sus condiciones se cumplen (AND)."""
    conds = rule.get("conditions") or []
    if not conds:
        return False
    return all(_eval_condition(c, ctx) for c in conds)


# ── Indicadores auxiliares para el contexto ───────────────────────────────────

def _rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    gain = loss = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gain += max(d, 0); loss += max(-d, 0)
    gain /= period; loss /= period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        gain = (gain * (period - 1) + max(d, 0)) / period
        loss = (loss * (period - 1) + max(-d, 0)) / period
    if loss == 0:
        return 100.0
    rs = gain / loss
    return round(100 - 100 / (1 + rs), 2)


async def _build_context(conn, coin: dict, regime: dict) -> dict:
    """
    Arma el contexto de evaluación para una coin: régimen (global, del snapshot),
    distancia a S/R y RSI (calculados desde OHLCV diario en DB).
    """
    ctx = {
        "regimen_largo":   regime.get("regime_largo"),
        "regimen_medio":   regime.get("regime_medio"),
        "regimen_corto":   regime.get("regime_corto"),
        "conviccion_largo": regime.get("conviction_largo"),
        "conviccion_medio": regime.get("conviction_medio"),
        "conviccion_corto": regime.get("conviction_corto"),
        "dist_soporte":     None,
        "dist_resistencia": None,
        "rsi":              None,
    }

    # OHLCV diario para RSI y S/R (últimas ~120 velas)
    rows = await conn.fetch("""
        SELECT close, high, low FROM ohlcv_daily
        WHERE coin_id = $1 ORDER BY date DESC LIMIT 120
    """, coin["coin_id"])
    if rows:
        closes = [float(r["close"]) for r in reversed(rows)]
        highs  = [float(r["high"])  for r in reversed(rows)]
        lows   = [float(r["low"])   for r in reversed(rows)]
        ctx["rsi"] = _rsi(closes)

        price = closes[-1]
        # S/R simple por pivotes (ventana 5) sobre la ventana disponible
        sups, ress = [], []
        for i in range(2, len(closes) - 2):
            if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
                ress.append(highs[i])
            if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
                sups.append(lows[i])
        # Distancia al soporte más cercano por debajo y resistencia por encima
        below = [s for s in sups if s <= price]
        above = [r for r in ress if r >= price]
        if below:
            ctx["dist_soporte"] = round((price - max(below)) / price * 100, 2)
        if above:
            ctx["dist_resistencia"] = round((min(above) - price) / price * 100, 2)

    return ctx


# ── Ciclo principal ────────────────────────────────────────────────────────────

async def run_bot_cycle(pool) -> dict:
    """Un ciclo completo de evaluación. Returns: {opened, closed}."""
    async with pool.acquire() as conn:
        cfg = await conn.fetchrow("SELECT * FROM bot_config WHERE id = 1")
        if not cfg or not cfg["enabled"]:
            return {"opened": 0, "closed": 0, "enabled": False}

        regime = await conn.fetchrow("""
            SELECT regime_largo, regime_medio, regime_corto,
                   conviction_largo, conviction_medio, conviction_corto
            FROM snapshots ORDER BY created_at DESC LIMIT 1
        """)
        if not regime:
            return {"opened": 0, "closed": 0, "no_regime": True}
        regime = dict(regime)

        rules_entry, rules_exit = [], []
        for r in await conn.fetch("SELECT * FROM bot_rules WHERE active = true"):
            rd = dict(r)
            if isinstance(rd.get("conditions"), str):
                try:
                    rd["conditions"] = json.loads(rd["conditions"])
                except Exception:
                    rd["conditions"] = []
            if rd.get("kind") == "exit":
                rules_exit.append(rd)
            else:
                rules_entry.append(rd)
        open_pos = [dict(p) for p in await conn.fetch(
            "SELECT * FROM bot_positions WHERE status = 'open'"
        )]
        watch = [dict(w) for w in await conn.fetch(
            "SELECT coin_id, symbol, exchange FROM watchlist ORDER BY position"
        )]

    opened = closed = 0
    open_coin_ids = {p["coin_id"] for p in open_pos}

    # ── 1. SALIDAS ──────────────────────────────────────────────────────────────
    for pos in open_pos:
        price = await _coin_price(pool, pos["coin_id"], pos["symbol"], pos.get("exchange") or "binance")
        if price is None:
            continue

        exit_reason = None
        if price <= float(pos["stop_price"]):
            exit_reason = "stop_loss"
        else:
            # Evaluar reglas de salida configurables contra el contexto actual
            async with pool.acquire() as conn:
                ctx = await _build_context(conn, {"coin_id": pos["coin_id"]}, regime)
            for rule in rules_exit:
                if _eval_rule(rule, ctx):
                    exit_reason = f"regla: {rule['name']}"
                    break

        if exit_reason:
            qty = float(pos["qty"])
            entry = float(pos["entry_price"])
            proceeds = qty * price
            pnl = proceeds - float(pos["amount"])
            pnl_pct = (price - entry) / entry * 100
            async with pool.acquire() as conn:
                await conn.execute("""
                    UPDATE bot_positions
                    SET status='closed', exit_price=$1, pnl=$2, pnl_pct=$3,
                        exit_reason=$4, closed_at=now()
                    WHERE id=$5
                """, price, round(pnl, 2), round(pnl_pct, 3), exit_reason, pos["id"])
                await conn.execute(
                    "UPDATE bot_config SET balance = balance + $1, updated_at=now() WHERE id=1",
                    round(proceeds, 2)
                )
            closed += 1
            emoji = "🟢" if pnl >= 0 else "🔴"
            reason_txt = "Stop loss" if exit_reason == "stop_loss" else exit_reason
            await send_telegram(
                f"{emoji} <b>Bot cerró {pos['symbol']}</b>\n"
                f"Entrada ${_fmt(entry)} → Salida ${_fmt(price)}\n"
                f"P&L: <b>${_fmt(pnl)}</b> ({pnl_pct:+.2f}%)\n"
                f"Motivo: {reason_txt}"
            )
            open_coin_ids.discard(pos["coin_id"])

    # ── 2. ENTRADAS ─────────────────────────────────────────────────────────────
    if rules_entry:
        async with pool.acquire() as conn:
            cfg = await conn.fetchrow("SELECT * FROM bot_config WHERE id = 1")
            n_open = await conn.fetchval("SELECT COUNT(*) FROM bot_positions WHERE status='open'")

        trade_amount = float(cfg["trade_amount"])
        balance      = float(cfg["balance"])
        max_pos      = int(cfg["max_positions"])
        sl_pct       = float(cfg["stop_loss_pct"])

        for coin in watch:
            if coin["coin_id"] in open_coin_ids:
                continue
            if n_open >= max_pos or balance < trade_amount:
                break

            async with pool.acquire() as conn:
                ctx = await _build_context(conn, coin, regime)

            matched_rule = None
            for rule in rules_entry:
                if _eval_rule(rule, ctx):
                    matched_rule = rule
                    break

            async with pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO bot_signals (coin_id, symbol, rule_id, matched, detail)
                    VALUES ($1,$2,$3,$4,$5)
                """, coin["coin_id"], coin["symbol"],
                    matched_rule["id"] if matched_rule else None,
                    bool(matched_rule),
                    (matched_rule["name"] if matched_rule else "sin match"))

            if not matched_rule:
                continue

            price = await _coin_price(pool, coin["coin_id"], coin["symbol"], coin.get("exchange"))
            if price is None or price <= 0:
                continue

            qty = trade_amount / price
            stop_price = price * (1 - sl_pct / 100)
            async with pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO bot_positions
                        (coin_id, symbol, exchange, status, entry_price, qty, amount,
                         stop_price, rule_id, entry_reason)
                    VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9)
                """, coin["coin_id"], coin["symbol"], coin.get("exchange") or "binance",
                    price, qty, trade_amount, stop_price, matched_rule["id"], matched_rule["name"])
                await conn.execute(
                    "UPDATE bot_config SET balance = balance - $1, updated_at=now() WHERE id=1",
                    trade_amount
                )
            opened += 1
            n_open += 1
            balance -= trade_amount
            open_coin_ids.add(coin["coin_id"])
            await send_telegram(
                f"🤖 <b>Bot abrió {coin['symbol']}</b>\n"
                f"Entrada: ${_fmt(price)}  ·  ${_fmt(trade_amount)}\n"
                f"Stop: ${_fmt(stop_price)} (-{sl_pct}%)\n"
                f"Regla: {matched_rule['name']}"
            )

    if opened or closed:
        logger.info(f"[bot] ciclo: {opened} abiertas, {closed} cerradas")
    return {"opened": opened, "closed": closed, "enabled": True}


# ── Estadísticas (para el frontend) ────────────────────────────────────────────

async def compute_stats(pool) -> dict:
    """Equity actual, P&L total, win rate, etc."""
    async with pool.acquire() as conn:
        cfg = await conn.fetchrow("SELECT * FROM bot_config WHERE id=1")
        open_pos = [dict(p) for p in await conn.fetch(
            "SELECT * FROM bot_positions WHERE status='open'")]
        closed = await conn.fetch(
            "SELECT pnl FROM bot_positions WHERE status='closed'")

    # Valor de mercado de las posiciones abiertas
    open_value = 0.0
    unrealized = 0.0
    for pos in open_pos:
        price = await _coin_price(pool, pos["coin_id"], pos["symbol"], pos.get("exchange") or "binance")
        if price is None:
            price = float(pos["entry_price"])
        mv = float(pos["qty"]) * price
        open_value += mv
        unrealized += mv - float(pos["amount"])

    realized = sum(float(r["pnl"]) for r in closed if r["pnl"] is not None)
    wins = sum(1 for r in closed if r["pnl"] is not None and float(r["pnl"]) > 0)
    total_closed = len([r for r in closed if r["pnl"] is not None])
    win_rate = round(wins / total_closed * 100, 1) if total_closed else 0.0

    balance = float(cfg["balance"])
    equity = balance + open_value
    initial = float(cfg["initial_balance"])

    return {
        "enabled":       cfg["enabled"],
        "initial_balance": initial,
        "balance":       round(balance, 2),
        "open_value":    round(open_value, 2),
        "equity":        round(equity, 2),
        "total_return":  round((equity - initial) / initial * 100, 2) if initial else 0,
        "realized_pnl":  round(realized, 2),
        "unrealized_pnl": round(unrealized, 2),
        "open_count":    len(open_pos),
        "closed_count":  total_closed,
        "win_rate":      win_rate,
    }
