"""
AXIOM v2 — Strategy Engine / Motor de Estadísticas.

Calcula métricas de eficiencia POR ESTRATEGIA (siempre filtrando por
strategy_id) para poder compararlas. La lógica es genérica; lo que cambia es
el strategy_id que se le pasa.

Métricas:
  - equity, balance, valor de abiertas, retorno total
  - realized/unrealized PnL
  - trades: total, ganadores, perdedores, win rate
  - profit factor (ganancia bruta / pérdida bruta)
  - expectancy (PnL promedio por trade)
  - max drawdown (sobre la curva de equity)
  - mejor / peor trade
  - racha máxima de ganadoras y perdedoras
  - duración promedio de trade
  - Sharpe simplificado (media/desvío de retornos por trade)
"""
from __future__ import annotations
import math
from .data_engine import data_engine


def _max_drawdown(equity_curve: list[float]) -> float:
    """Max drawdown en % sobre la curva de equity."""
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return round(max_dd, 2)


def _streaks(pnls: list[float]) -> tuple[int, int]:
    """Racha máxima de ganadoras y de perdedoras."""
    max_w = max_l = cur_w = cur_l = 0
    for p in pnls:
        if p > 0:
            cur_w += 1; cur_l = 0
            max_w = max(max_w, cur_w)
        elif p < 0:
            cur_l += 1; cur_w = 0
            max_l = max(max_l, cur_l)
        else:
            cur_w = cur_l = 0
    return max_w, max_l


async def compute_strategy_stats(pool, strategy_id: int, timeframe: str = "5m") -> dict:
    async with pool.acquire() as conn:
        s = await conn.fetchrow("SELECT * FROM strat_strategies WHERE id=$1", strategy_id)
        if not s:
            return {}
        open_pos = [dict(r) for r in await conn.fetch(
            "SELECT * FROM strat_positions WHERE strategy_id=$1 AND status='open'", strategy_id)]
        closed = [dict(r) for r in await conn.fetch(
            "SELECT pnl, pnl_pct, opened_at, closed_at FROM strat_positions "
            "WHERE strategy_id=$1 AND status='closed' ORDER BY closed_at", strategy_id)]
        eq_rows = await conn.fetch(
            "SELECT equity FROM strat_equity WHERE strategy_id=$1 ORDER BY ts", strategy_id)

    initial = float(s["initial_balance"])
    balance = float(s["balance"])

    # Valor de mercado de abiertas + PnL no realizado
    market = unrealized = 0.0
    for pos in open_pos:
        price = data_engine.last_price(pos["pair_symbol"], timeframe, pos["exchange"])
        if price is None:
            price = float(pos["entry_price"])
        mv = float(pos["qty"]) * price
        market += mv
        unrealized += mv - float(pos["amount"])
    equity = balance + market

    pnls = [float(c["pnl"]) for c in closed if c["pnl"] is not None]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    total = len(pnls)

    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = round(gross_win / gross_loss, 2) if gross_loss > 0 else (
        float("inf") if gross_win > 0 else 0.0)
    expectancy = round(sum(pnls) / total, 2) if total else 0.0
    win_rate = round(len(wins) / total * 100, 1) if total else 0.0

    # Sharpe simplificado sobre retornos % por trade
    rets = [float(c["pnl_pct"]) for c in closed if c["pnl_pct"] is not None]
    sharpe = 0.0
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(var)
        sharpe = round(mean / sd, 2) if sd > 0 else 0.0

    # Duración promedio (minutos)
    durations = []
    for c in closed:
        if c["opened_at"] and c["closed_at"]:
            durations.append((c["closed_at"] - c["opened_at"]).total_seconds() / 60)
    avg_dur = round(sum(durations) / len(durations), 1) if durations else 0.0

    max_w, max_l = _streaks(pnls)
    equity_curve = [float(r["equity"]) for r in eq_rows] or [initial, equity]
    max_dd = _max_drawdown(equity_curve)

    return {
        "strategy_id":   strategy_id,
        "name":          s["name"],
        "key":           s["key"],
        "enabled":       s["enabled"],
        "initial_balance": initial,
        "balance":       round(balance, 2),
        "open_value":    round(market, 2),
        "equity":        round(equity, 2),
        "total_return":  round((equity - initial) / initial * 100, 2) if initial else 0,
        "realized_pnl":  round(sum(pnls), 2),
        "unrealized_pnl": round(unrealized, 2),
        "trades_total":  total,
        "trades_open":   len(open_pos),
        "wins":          len(wins),
        "losses":        len(losses),
        "win_rate":      win_rate,
        "profit_factor": (profit_factor if profit_factor != float("inf") else None),
        "expectancy":    expectancy,
        "max_drawdown":  max_dd,
        "best_trade":    round(max(pnls), 2) if pnls else 0.0,
        "worst_trade":   round(min(pnls), 2) if pnls else 0.0,
        "max_win_streak": max_w,
        "max_loss_streak": max_l,
        "avg_duration_min": avg_dur,
        "sharpe":        sharpe,
        "equity_curve":  equity_curve[-200:],   # para graficar
    }


async def compute_all_stats(pool, timeframe: str = "5m") -> list[dict]:
    """Stats de todas las estrategias, para comparar."""
    async with pool.acquire() as conn:
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM strat_strategies ORDER BY id")]
    return [await compute_strategy_stats(pool, sid, timeframe) for sid in ids]
