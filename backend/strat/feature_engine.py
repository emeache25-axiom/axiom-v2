"""
AXIOM v2 — Strategy Engine / Motor de Features.

Responsabilidad ÚNICA: calcular indicadores y features sobre un set de velas y
producir un "contexto" — un dict de valores que describe el estado del mercado
en el instante de la última vela. NO decide nada; solo describe.

Las estrategias leen del contexto. Cada feature se calcula on-demand y se
cachea dentro del mismo contexto para no recalcular si dos estrategias lo piden.

Features disponibles (ampliable):
  price, ema_fast, ema_slow, sma, rsi, atr, atr_pct, vwap,
  vol, vol_avg, vol_ratio, dist_soporte, dist_resistencia,
  high_n, low_n, change_pct_n
"""
from __future__ import annotations
import math


# ── Cálculos base (puros, sobre listas) ───────────────────────────────────────

def _ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def _sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


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
    return 100 - 100 / (1 + rs)


def _atr(highs, lows, closes, period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    # ATR de Wilder
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def _vwap(highs, lows, closes, vols) -> float | None:
    """VWAP sobre la ventana disponible (no anclado a sesión)."""
    num = den = 0.0
    for i in range(len(closes)):
        tp = (highs[i] + lows[i] + closes[i]) / 3
        num += tp * vols[i]; den += vols[i]
    return num / den if den else None


def _pivots(highs, lows, price, window=5):
    """Soportes/resistencias por pivotes; devuelve dist % al más cercano."""
    sup, res = [], []
    w = window
    for i in range(w, len(highs) - w):
        if all(highs[i] >= highs[i + k] for k in range(-w, w + 1) if k != 0):
            res.append(highs[i])
        if all(lows[i] <= lows[i + k] for k in range(-w, w + 1) if k != 0):
            sup.append(lows[i])
    below = [s for s in sup if s <= price]
    above = [r for r in res if r >= price]
    dist_sup = round((price - max(below)) / price * 100, 3) if below else None
    dist_res = round((min(above) - price) / price * 100, 3) if above else None
    return dist_sup, dist_res


# ── Contexto ───────────────────────────────────────────────────────────────────

class FeatureContext:
    """
    Envuelve un set de velas y calcula features bajo demanda, cacheando cada
    resultado. Una estrategia hace ctx.get('rsi', period=14), etc.
    """

    def __init__(self, candles: list[dict], extra: dict | None = None):
        self.candles = candles or []
        self._cache = {}
        # Datos externos (ej. régimen) que la estrategia también puede leer
        self.extra = extra or {}
        # Series base
        self.closes = [c["close"] for c in self.candles]
        self.highs  = [c["high"]  for c in self.candles]
        self.lows   = [c["low"]   for c in self.candles]
        self.vols   = [c["volume"] for c in self.candles]

    @property
    def price(self) -> float | None:
        return self.closes[-1] if self.closes else None

    def get(self, name: str, **kw):
        key = (name, tuple(sorted(kw.items())))
        if key in self._cache:
            return self._cache[key]
        val = self._compute(name, **kw)
        self._cache[key] = val
        return val

    def _compute(self, name: str, **kw):
        if name in self.extra:
            return self.extra[name]
        if not self.candles:
            return None

        if name == "price":
            return self.price
        if name == "ema":
            return _ema(self.closes, kw.get("period", 20))
        if name == "sma":
            return _sma(self.closes, kw.get("period", 20))
        if name == "rsi":
            return _rsi(self.closes, kw.get("period", 14))
        if name == "atr":
            return _atr(self.highs, self.lows, self.closes, kw.get("period", 14))
        if name == "atr_pct":
            atr = _atr(self.highs, self.lows, self.closes, kw.get("period", 14))
            return round(atr / self.price * 100, 3) if (atr and self.price) else None
        if name == "vwap":
            n = kw.get("period", len(self.candles))
            return _vwap(self.highs[-n:], self.lows[-n:], self.closes[-n:], self.vols[-n:])
        if name == "vol":
            return self.vols[-1] if self.vols else None
        if name == "vol_avg":
            return _sma(self.vols, kw.get("period", 20))
        if name == "vol_ratio":
            avg = _sma(self.vols, kw.get("period", 20))
            return round(self.vols[-1] / avg, 3) if (avg and avg > 0) else None
        if name == "high_n":
            n = kw.get("period", 20)
            return max(self.highs[-n:]) if len(self.highs) >= 1 else None
        if name == "low_n":
            n = kw.get("period", 20)
            return min(self.lows[-n:]) if len(self.lows) >= 1 else None
        if name == "change_pct_n":
            n = kw.get("period", 1)
            if len(self.closes) > n:
                prev = self.closes[-1 - n]
                return round((self.price - prev) / prev * 100, 3) if prev else None
            return None
        if name in ("dist_soporte", "dist_resistencia"):
            ds, dr = _pivots(self.highs, self.lows, self.price, kw.get("window", 5))
            self._cache[("dist_soporte", ())] = ds
            self._cache[("dist_resistencia", ())] = dr
            return ds if name == "dist_soporte" else dr
        return None

    def snapshot(self) -> dict:
        """Dict plano con las features más comunes (para logging/debug)."""
        return {
            "price":   self.price,
            "rsi":     self.get("rsi"),
            "ema20":   self.get("ema", period=20),
            "ema50":   self.get("ema", period=50),
            "atr_pct": self.get("atr_pct"),
            "vwap":    self.get("vwap"),
            "vol_ratio": self.get("vol_ratio"),
            "dist_soporte": self.get("dist_soporte"),
            "dist_resistencia": self.get("dist_resistencia"),
        }
