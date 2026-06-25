"""
AXIOM v2 — Strategy Engine / Motor de Backtesting.

INDEPENDIENTE y aplicable a CUALQUIER estrategia que cumpla la interfaz
Strategy (should_enter / should_exit). No sabe qué estrategia corre: recibe la
estrategia, sus params, una serie de velas históricas y la config de capital,
y devuelve métricas + la lista de trades + la curva de equity.

Reutiliza las mismas capas que el bot en vivo:
  - FeatureContext (mismo cálculo de features)
  - interfaz Strategy (mismas decisiones de entrada/salida)
  - las métricas son las mismas del stats_engine (replicadas acá sobre la
    lista de trades simulados, sin tocar la DB)

Motor de tiempo: recorre las velas desde `warmup` en adelante. En cada paso i,
la estrategia SOLO ve candles[0..i] (nunca el futuro). Simula una posición a la
vez por backtest (long-only, igual que las estrategias actuales).
"""
from __future__ import annotations
import math
from .feature_engine import FeatureContext


def _max_drawdown(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]; max_dd = 0.0
    for v in equity_curve:
        if v > peak: peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100
            if dd > max_dd: max_dd = dd
    return round(max_dd, 2)


def _streaks(pnls):
    max_w = max_l = cur_w = cur_l = 0
    for p in pnls:
        if p > 0:   cur_w += 1; cur_l = 0; max_w = max(max_w, cur_w)
        elif p < 0: cur_l += 1; cur_w = 0; max_l = max(max_l, cur_l)
        else:       cur_w = cur_l = 0
    return max_w, max_l


def run_backtest(strategy, params: dict, candles: list[dict], *,
                 initial_balance: float = 10000.0,
                 trade_amount: float = 200.0,
                 stop_loss_pct: float = 2.0,
                 fee_pct: float = 0.1) -> dict:
    """
    Corre una estrategia sobre una serie de velas.

    strategy: instancia de Strategy (cualquier plugin).
    params:   dict de parámetros efectivos.
    candles:  lista de velas {time, open, high, low, close, volume} (cronológica).
    fee_pct:  comisión por lado (%). Aplica al entrar y al salir.

    Returns: dict con métricas, trades y equity_curve.
    """
    warmup = max(strategy.lookback, 50)
    if not candles or len(candles) <= warmup + 5:
        return {"error": "insuficientes velas para backtestear",
                "needed": warmup + 6, "got": len(candles or [])}

    balance = initial_balance
    position = None          # dict si hay posición abierta
    trades = []              # trades cerrados
    equity_curve = []

    for i in range(warmup, len(candles)):
        window = candles[:i + 1]          # la estrategia solo ve hasta acá
        ctx = FeatureContext(window)
        price = ctx.price
        if price is None:
            continue

        # ── Gestión de salida ──
        if position is not None:
            sig = strategy.should_exit(position, ctx, params)
            if sig:
                proceeds = position["qty"] * price
                fee_out = proceeds * fee_pct / 100
                proceeds_net = proceeds - fee_out
                pnl = proceeds_net - position["cost_total"]
                pnl_pct = (price - position["entry_price"]) / position["entry_price"] * 100
                balance += proceeds_net
                trades.append({
                    "entry_time": position["entry_time"],
                    "exit_time": window[-1]["time"],
                    "entry_price": position["entry_price"],
                    "exit_price": price,
                    "qty": position["qty"],
                    "pnl": round(pnl, 4),
                    "pnl_pct": round(pnl_pct, 4),
                    "reason": sig.reason,
                    "bars_held": i - position["entry_index"],
                })
                position = None

        # ── Gestión de entrada ──
        if position is None and balance >= trade_amount:
            sig = strategy.should_enter(ctx, params)
            if sig:
                fee_in = trade_amount * fee_pct / 100
                invest = trade_amount - fee_in
                qty = invest / price
                stop = sig.stop_price if sig.stop_price else price * (1 - stop_loss_pct / 100)
                position = {
                    "entry_price": price,
                    "qty": qty,
                    "cost_total": trade_amount,   # lo que salió del balance (incl. fee)
                    "stop_price": stop,
                    "take_price": sig.take_price,
                    "entry_time": window[-1]["time"],
                    "entry_index": i,
                    "reason": sig.reason,
                }
                balance -= trade_amount

        # Equity = balance libre + valor de mercado de la posición abierta
        mkt = position["qty"] * price if position else 0.0
        equity_curve.append(round(balance + mkt, 2))

    # Cerrar posición abierta al final (mark-to-market) para las métricas
    final_price = candles[-1]["close"]
    open_value = 0.0
    if position is not None:
        open_value = position["qty"] * final_price

    # ── Métricas ──
    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    total = len(pnls)
    gross_win = sum(wins); gross_loss = abs(sum(losses))
    rets = [t["pnl_pct"] for t in trades]
    equity_final = balance + open_value
    sharpe = 0.0
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(var)
        sharpe = round(mean / sd, 3) if sd > 0 else 0.0
    durations = [t["bars_held"] for t in trades]
    max_w, max_l = _streaks(pnls)

    return {
        "initial_balance": initial_balance,
        "equity_final": round(equity_final, 2),
        "total_return": round((equity_final - initial_balance) / initial_balance * 100, 2),
        "realized_pnl": round(sum(pnls), 2),
        "trades_total": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / total * 100, 1) if total else 0.0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
        "expectancy": round(sum(pnls) / total, 4) if total else 0.0,
        "max_drawdown": _max_drawdown(equity_curve),
        "best_trade": round(max(pnls), 2) if pnls else 0.0,
        "worst_trade": round(min(pnls), 2) if pnls else 0.0,
        "max_win_streak": max_w,
        "max_loss_streak": max_l,
        "avg_bars_held": round(sum(durations) / len(durations), 1) if durations else 0.0,
        "sharpe": sharpe,
        "candles_used": len(candles),
        "open_at_end": position is not None,
        "equity_curve": equity_curve[-500:],
        "trades": trades[-200:],
    }
