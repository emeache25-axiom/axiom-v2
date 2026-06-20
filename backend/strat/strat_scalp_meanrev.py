"""
AXIOM v2 — Estrategia de Scalping: Reversión a la Media (mean reversion).

Idea: en marcos cortos (5m), el precio que se aleja bruscamente de su media
tiende a volver. Buscamos sobreventa de corto plazo con confirmación, entramos
long, y salimos rápido en un objetivo chico o en un stop ajustado (scalping).

ENTRADA (todas):
  - precio por debajo de la EMA (dist >= entry_dist_pct %)
  - RSI < rsi_oversold
  - volumen actual >= vol_mult × volumen medio (confirma interés)
ATR define stop/target dinámicos (proporcionales a la volatilidad).

SALIDA:
  - take profit: precio vuelve a la EMA (o +tp_atr × ATR sobre la entrada)
  - stop loss:   -sl_atr × ATR bajo la entrada

Es un punto de partida razonable y CONSERVADOR — no una garantía de
rentabilidad. El objetivo es medirla con las estadísticas y el paper-trading.
"""
from __future__ import annotations
from .strategy_base import Strategy, Param, EntrySignal, ExitSignal, registry


@registry.register
class ScalpMeanReversion(Strategy):
    key = "scalp_meanrev"
    name = "Scalping · Reversión a la media"
    description = ("Compra sobreventa de corto plazo (precio bajo EMA + RSI bajo "
                   "+ volumen) y sale en objetivo chico o stop ajustado.")
    timeframe = "5m"
    lookback = 200

    params = [
        Param("ema_period",     "Período EMA",        "number", 50,  min=10, max=200, step=1),
        Param("rsi_period",     "Período RSI",        "number", 14,  min=5,  max=30,  step=1),
        Param("rsi_oversold",   "RSI sobreventa",     "number", 30,  min=10, max=45,  step=1),
        Param("entry_dist_pct", "Dist. bajo EMA %",   "number", 1.0, min=0.2, max=5,  step=0.1),
        Param("vol_mult",       "Mult. volumen",      "number", 1.3, min=1,  max=4,   step=0.1),
        Param("sl_atr",         "Stop (× ATR)",       "number", 1.5, min=0.5, max=4,  step=0.1),
        Param("tp_atr",         "Target (× ATR)",     "number", 2.0, min=0.5, max=6,  step=0.1),
    ]

    def should_enter(self, ctx, p):
        price = ctx.price
        if price is None:
            return None
        ema = ctx.get("ema", period=int(p["ema_period"]))
        rsi = ctx.get("rsi", period=int(p["rsi_period"]))
        atr = ctx.get("atr", period=14)
        vol_ratio = ctx.get("vol_ratio", period=20)
        if None in (ema, rsi, atr, vol_ratio):
            return None

        dist_pct = (ema - price) / ema * 100   # cuánto por debajo de la EMA
        cond = (
            dist_pct >= p["entry_dist_pct"]
            and rsi < p["rsi_oversold"]
            and vol_ratio >= p["vol_mult"]
        )
        if not cond:
            return None

        stop = price - p["sl_atr"] * atr
        take = price + p["tp_atr"] * atr
        return EntrySignal(
            reason=f"Sobreventa: {dist_pct:.1f}% bajo EMA, RSI {rsi:.0f}, vol×{vol_ratio:.1f}",
            stop_price=round(stop, 8),
            take_price=round(take, 8),
            meta={"rsi": round(rsi, 1), "dist_pct": round(dist_pct, 2)},
        )

    def should_exit(self, position, ctx, p):
        price = ctx.price
        if price is None:
            return None
        # Take profit / stop por precio absoluto guardado en la posición
        take = position.get("take_price")
        stop = position.get("stop_price")
        if take and price >= float(take):
            return ExitSignal(reason="take_profit")
        if stop and price <= float(stop):
            return ExitSignal(reason="stop_loss")
        # Salida alternativa: el precio volvió a la EMA (objetivo cumplido)
        ema = ctx.get("ema", period=int(p["ema_period"]))
        if ema and price >= ema:
            return ExitSignal(reason="señal: vuelta a la media")
        return None
