"""
Capa 2 — Señales de AXIOM v2.

Responsabilidades:
  1. Calcular valores de señales nuevas a partir de velas (MA50, EMA20, etc.)
  2. Clasificar todos los valores crudos en regímenes

NO fetchea datos. Recibe los valores crudos de la Capa 3 (régimen)
y devuelve señales clasificadas listas para calcular el régimen.

Formato de salida de cada señal:
  {
    "signal_id":    str   identificador único de la señal
    "timeframe":    str   "largo" | "medio" | "corto"
    "dimension":    str   "valuacion" | "momentum" | "sentimiento" | "flujo" | "participacion"
    "raw_value":    float | None   valor crudo
    "voted_regime": str | None     régimen votado (None si is_core=False o sin dato)
    "is_core":      bool           True = vota al régimen
    "label":        str            descripción legible del estado
    "available":    bool           True = llegó con dato, False = sin dato
  }
"""
from __future__ import annotations


# ═══════════════════════════════════════════════════════════════════════════
# SECCIÓN 1 — Cálculo de señales nuevas a partir de velas
# ═══════════════════════════════════════════════════════════════════════════

def calc_ma(candles: list[dict], period: int) -> float | None:
    """
    Calcula la media móvil simple (SMA) de los últimos N cierres.
    Retorna None si no hay suficientes velas.
    """
    closes = [c["close"] for c in candles]
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def calc_ema(candles: list[dict], period: int) -> float | None:
    """
    Calcula la media móvil exponencial (EMA) de los últimos N cierres.
    Retorna None si no hay suficientes velas.
    """
    closes = [c["close"] for c in candles]
    if len(closes) < period:
        return None

    k = 2 / (period + 1)
    ema = closes[0]
    for price in closes[1:]:
        ema = price * k + ema * (1 - k)
    return ema


def calc_mayer_multiple(candles_daily: list[dict]) -> float | None:
    """
    Mayer Multiple = precio_actual / MA200_diaria.
    Necesita al menos 200 velas diarias.
    """
    if not candles_daily or len(candles_daily) < 200:
        return None
    ma200 = calc_ma(candles_daily, 200)
    if not ma200:
        return None
    price = candles_daily[-1]["close"]
    return price / ma200


def calc_price_vs_ma50(candles_daily: list[dict]) -> float | None:
    """
    Precio vs MA50 = precio_actual / MA50_diaria.
    Necesita al menos 50 velas diarias.
    """
    if not candles_daily or len(candles_daily) < 50:
        return None
    ma50 = calc_ma(candles_daily, 50)
    if not ma50:
        return None
    price = candles_daily[-1]["close"]
    return price / ma50


def calc_price_vs_ema20(candles_4h: list[dict]) -> float | None:
    """
    Precio vs EMA20 = precio_actual / EMA20_4h.
    Necesita al menos 20 velas de 4h.
    """
    if not candles_4h or len(candles_4h) < 20:
        return None
    ema20 = calc_ema(candles_4h, 20)
    if not ema20:
        return None
    price = candles_4h[-1]["close"]
    return price / ema20


def calc_volume_relative(candles_4h: list[dict]) -> dict | None:
    """
    Volumen relativo = volumen_actual / promedio_volumen_20_velas.
    Direccionado por el color de la vela actual (verde/roja).

    Returns:
        dict con:
          ratio     -> float, ej: 1.8 (1.8× el volumen promedio)
          direction -> "green" | "red" (color de la última vela)
        O None si no hay suficientes velas.
    """
    if not candles_4h or len(candles_4h) < 21:
        return None

    last = candles_4h[-1]
    recent = candles_4h[-21:-1]  # las 20 velas anteriores a la actual

    avg_vol = sum(c["volume"] for c in recent) / 20
    if avg_vol <= 0:
        return None

    ratio = last["volume"] / avg_vol
    direction = "green" if last["close"] >= last["open"] else "red"

    return {"ratio": ratio, "direction": direction}


# ═══════════════════════════════════════════════════════════════════════════
# SECCIÓN 2 — Clasificadores
# Cada función recibe un valor crudo y devuelve (voted_regime, label)
# ═══════════════════════════════════════════════════════════════════════════

def _clf_mvrv_zscore(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 0:     return "ACUMULACION",  "Zona de Suelo"
    if v < 1:     return "ACUMULACION",  "Neutro Bajo"
    if v < 2:     return "ALCISTA_A",    "Neutro Medio"
    if v < 3.5:   return "ALCISTA_B",    "Neutro Alto"
    return             "DISTRIBUCION", "Zona de Techo"


def _clf_mayer_multiple(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 0.8:   return "ACUMULACION",  "Muy por debajo de MA200"
    if v < 1.0:   return "ACUMULACION",  "Por debajo de MA200"
    if v < 1.5:   return "ALCISTA_A",    "Sobre MA200, momentum sano"
    if v < 2.4:   return "ALCISTA_B",    "Momentum fuerte"
    return             "DISTRIBUCION", "Muy recalentado (>2.4x)"


def _clf_nupl(v: float | None) -> tuple[str | None, str]:
    """v viene en % desde CMC, ej: 29.5"""
    if v is None: return None, "Sin datos"
    d = v / 100
    if d < 0:     return "BAJISTA",      "Capitulación"
    if d < 0.25:  return "ACUMULACION",  "Hope/Belief"
    if d < 0.5:   return "ALCISTA_A",    "Optimismo"
    if d < 0.75:  return "ALCISTA_B",    "Belief/Thrill"
    return             "DISTRIBUCION", "Euforia"


def _clf_lth_supply(v: float | None) -> tuple[str | None, str]:
    """v en millones de BTC"""
    if v is None: return None, "Sin datos"
    if v > 15:    return "ACUMULACION",  "LTH acumulando fuerte"
    if v > 14:    return "ACUMULACION",  "LTH acumulando"
    if v > 13.5:  return "ALCISTA_A",    "LTH neutral"
    if v > 12.5:  return "ALCISTA_B",    "LTH distribuyendo"
    return             "DISTRIBUCION", "LTH distribución masiva"


def _clf_btc_vs_ath(v: float | None) -> tuple[str | None, str]:
    """v es % de distancia al ATH, negativo (ej: -39.2)"""
    if v is None: return None, "Sin datos"
    if v < -60:   return "BAJISTA",      "Bear Profundo"
    if v < -40:   return "ACUMULACION",  "Corrección Mayor"
    if v < -20:   return "ALCISTA_A",    "Pullback"
    if v < -5:    return "ALCISTA_B",    "Cerca del ATH"
    return             "DISTRIBUCION", "Zona ATH"


def _clf_price_vs_ma50(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 0.90:  return "BAJISTA",      "Muy por debajo de MA50"
    if v < 0.97:  return "ACUMULACION",  "Por debajo de MA50"
    if v < 1.05:  return "ALCISTA_A",    "En torno a MA50"
    if v < 1.15:  return "ALCISTA_B",    "Sobre MA50, momentum fuerte"
    return             "DISTRIBUCION", "Muy extendido sobre MA50"


def _clf_fear_greed(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 20:    return "ACUMULACION",  "Miedo Extremo"
    if v < 40:    return "ACUMULACION",  "Miedo"
    if v < 60:    return "ALCISTA_A",    "Neutral"
    if v < 80:    return "ALCISTA_B",    "Codicia"
    return             "DISTRIBUCION", "Codicia Extrema"


def _clf_btc_dominance(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v > 60:    return "BAJISTA",      "Muy Alta"
    if v > 57:    return "ACUMULACION",  "Alta"
    if v > 53:    return "ALCISTA_A",    "Media"
    if v > 48:    return "ALCISTA_B",    "Baja"
    return             "DISTRIBUCION", "Muy Baja"


def _clf_vol_mcap_ratio(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 2:     return "ACUMULACION",  "Volumen muy bajo"
    if v < 4:     return "ACUMULACION",  "Volumen bajo"
    if v < 7:     return "ALCISTA_A",    "Volumen normal"
    if v < 12:    return "ALCISTA_B",    "Volumen alto"
    return             "DISTRIBUCION", "Volumen extremo"


def _clf_price_vs_ema20(v: float | None) -> tuple[str | None, str]:
    if v is None: return None, "Sin datos"
    if v < 0.98:  return "BAJISTA",   "Por debajo de EMA20"
    if v < 1.02:  return "LATERAL",   "En torno a EMA20"
    return             "ALCISTA",   "Sobre EMA20"


def _clf_funding_btc(v: float | None) -> tuple[str | None, str]:
    if v is None:  return None,     "Sin datos"
    if v < -0.01:  return "BAJISTA", "Shorts pagan — miedo"
    if v < 0.01:   return "LATERAL", "Funding neutro"
    return              "ALCISTA",  "Longs pagan — codicia"


def _clf_volume_relative(data: dict | None) -> tuple[str | None, str]:
    if data is None: return None, "Sin datos"
    ratio = data.get("ratio", 0)
    direction = data.get("direction", "green")
    if ratio < 0.80:
        return "LATERAL", f"Volumen bajo ({ratio:.2f}x)"
    if direction == "green":
        return "ALCISTA",  f"Subida con volumen ({ratio:.2f}x)"
    return     "BAJISTA",  f"Caída con volumen ({ratio:.2f}x)"


# ═══════════════════════════════════════════════════════════════════════════
# SECCIÓN 3 — classify_all: punto de entrada principal
# ═══════════════════════════════════════════════════════════════════════════

def classify_all(
    # Señales de largo plazo
    mvrv_zscore:      float | None,
    mayer_multiple:   float | None,
    nupl:             float | None,
    lth_supply:       float | None,
    # Señales de medio plazo
    btc_vs_ath:       float | None,
    price_vs_ma50:    float | None,
    fear_greed:       float | None,
    btc_dominance:    float | None,
    vol_mcap_ratio:   float | None,
    # Señales de corto plazo
    price_vs_ema20:   float | None,
    funding_btc:      float | None,
    volume_relative:  dict  | None,
    # Señales de contexto (no votan)
    mvrv_ratio:       float | None = None,
    puell_multiple:   float | None = None,
    reserve_risk:     float | None = None,
    rhodl_ratio:      float | None = None,
    cbbi:             float | None = None,
    sth_supply_pct:   float | None = None,
    funding_eth:      float | None = None,
    funding_sol:      float | None = None,
    pi_cycle:         dict  | None = None,
) -> list[dict]:
    """
    Clasifica todas las señales y devuelve la lista de señales clasificadas.

    Returns:
        Lista de dicts, uno por señal, con el formato estándar de AXIOM v2.
    """

    def _make(
        signal_id: str,
        timeframe: str,
        dimension: str,
        raw_value,
        is_core: bool,
        voted_regime: str | None,
        label: str,
    ) -> dict:
        return {
            "signal_id":    signal_id,
            "timeframe":    timeframe,
            "dimension":    dimension,
            "raw_value":    raw_value,
            "is_core":      is_core,
            "voted_regime": voted_regime if is_core else None,
            "label":        label,
            "available":    raw_value is not None,
        }

    signals = []

    # ── LARGO PLAZO ─────────────────────────────────────────────────────
    r, l = _clf_mvrv_zscore(mvrv_zscore)
    signals.append(_make("mvrv_zscore",    "largo", "valuacion",    mvrv_zscore,    True, r, l))

    r, l = _clf_mayer_multiple(mayer_multiple)
    signals.append(_make("mayer_multiple", "largo", "momentum",     mayer_multiple, True, r, l))

    r, l = _clf_nupl(nupl)
    signals.append(_make("nupl",           "largo", "sentimiento",  nupl,           True, r, l))

    r, l = _clf_lth_supply(lth_supply)
    signals.append(_make("lth_supply",     "largo", "flujo",        lth_supply,     True, r, l))

    # ── MEDIO PLAZO ─────────────────────────────────────────────────────
    r, l = _clf_btc_vs_ath(btc_vs_ath)
    signals.append(_make("btc_vs_ath",     "medio", "valuacion",    btc_vs_ath,     True, r, l))

    r, l = _clf_price_vs_ma50(price_vs_ma50)
    signals.append(_make("price_vs_ma50",  "medio", "momentum",     price_vs_ma50,  True, r, l))

    r, l = _clf_fear_greed(fear_greed)
    signals.append(_make("fear_greed",     "medio", "sentimiento",  fear_greed,     True, r, l))

    r, l = _clf_btc_dominance(btc_dominance)
    signals.append(_make("btc_dominance",  "medio", "flujo",        btc_dominance,  True, r, l))

    r, l = _clf_vol_mcap_ratio(vol_mcap_ratio)
    signals.append(_make("vol_mcap_ratio", "medio", "participacion",vol_mcap_ratio, True, r, l))

    # ── CORTO PLAZO ─────────────────────────────────────────────────────
    r, l = _clf_price_vs_ema20(price_vs_ema20)
    signals.append(_make("price_vs_ema20", "corto", "momentum",     price_vs_ema20, True, r, l))

    r, l = _clf_funding_btc(funding_btc)
    signals.append(_make("funding_btc",    "corto", "sentimiento",  funding_btc,    True, r, l))

    r, l = _clf_volume_relative(volume_relative)
    vr_raw = volume_relative.get("ratio") if volume_relative else None
    signals.append(_make("volume_relative","corto", "participacion",vr_raw,         True, r, l))

    # ── CONTEXTO (no votan) ─────────────────────────────────────────────
    signals.append(_make("mvrv_ratio",    "largo", "valuacion",    mvrv_ratio,     False, None, ""))
    signals.append(_make("puell_multiple","largo", "momentum",     puell_multiple, False, None, ""))
    signals.append(_make("reserve_risk",  "largo", "flujo",        reserve_risk,   False, None, ""))
    signals.append(_make("rhodl_ratio",   "largo", "flujo",        rhodl_ratio,    False, None, ""))
    signals.append(_make("cbbi",          "largo", "sentimiento",  cbbi,           False, None, ""))
    signals.append(_make("sth_supply_pct","medio", "flujo",        sth_supply_pct, False, None, ""))
    signals.append(_make("funding_eth",   "corto", "sentimiento",  funding_eth,    False, None, ""))
    signals.append(_make("funding_sol",   "corto", "sentimiento",  funding_sol,    False, None, ""))

    # Pi Cycle como contexto
    pi_raw = pi_cycle.get("ma111") if pi_cycle else None
    signals.append(_make("pi_cycle",      "largo", "momentum",     pi_raw,         False, None, ""))

    return signals
