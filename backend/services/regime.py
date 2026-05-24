"""
Capa 3 — Cálculo del régimen de AXIOM v2.

Responsabilidad: tomar las señales clasificadas (output de signals.py)
y calcular los 3 regímenes (largo, medio, corto) con sus métricas.

NO fetchea datos. NO clasifica señales.
Recibe la lista de señales de classify_all() y devuelve los regímenes.

Formato de salida:
  {
    "largo": RegimeResult,
    "medio": RegimeResult,
    "corto": RegimeResult,
  }

RegimeResult:
  {
    "regime":             str     régimen ganador
    "conviction":         int     % del peso a favor del ganador (0-100)
    "consensus":          int     cantidad de señales que votaron al ganador
    "is_confirmed":       bool    True si consensus > 50% de señales disponibles
    "signals_expected":   int     señales núcleo esperadas para esta temporalidad
    "signals_available":  int     señales que llegaron con dato
    "missing_signals":    list    signal_ids que faltaron
  }
"""
from __future__ import annotations
from collections import Counter

# Régimen central para desempate (Opción C acordada)
_TIEBREAK = {
    "largo": "ALCISTA_A",
    "medio": "ALCISTA_A",
    "corto": "LATERAL",
}

# Regímenes válidos por temporalidad
_VALID_REGIMES = {
    "largo": {"ACUMULACION", "ALCISTA_A", "ALCISTA_B", "DISTRIBUCION", "BAJISTA"},
    "medio": {"ACUMULACION", "ALCISTA_A", "ALCISTA_B", "DISTRIBUCION", "BAJISTA"},
    "corto": {"ALCISTA", "LATERAL", "BAJISTA"},
}


def _calc_regime(core_signals: list[dict], timeframe: str) -> dict:
    """
    Calcula el régimen para una temporalidad dada.

    Args:
        core_signals: señales núcleo de esa temporalidad (is_core=True)
        timeframe:    "largo" | "medio" | "corto"
    """
    total_expected = len(core_signals)

    # Separar disponibles y faltantes
    available = [s for s in core_signals if s["available"]]
    missing   = [s["signal_id"] for s in core_signals if not s["available"]]

    total_available = len(available)

    # Si no hay ninguna señal disponible, retornar régimen neutro
    if total_available == 0:
        return {
            "regime":            _TIEBREAK[timeframe],
            "conviction":        0,
            "consensus":         0,
            "is_confirmed":      False,
            "signals_expected":  total_expected,
            "signals_available": 0,
            "missing_signals":   missing,
        }

    # Contar votos por régimen
    votes = Counter(s["voted_regime"] for s in available if s["voted_regime"])

    # Régimen ganador
    if not votes:
        winner = _TIEBREAK[timeframe]
        winner_votes = 0
    else:
        max_votes = max(votes.values())
        # Candidatos con la misma cantidad de votos (empate)
        candidates = [r for r, v in votes.items() if v == max_votes]

        if len(candidates) == 1:
            winner = candidates[0]
        else:
            # Empate: gana el régimen central de esa temporalidad
            tiebreak = _TIEBREAK[timeframe]
            winner = tiebreak if tiebreak in candidates else candidates[0]

        winner_votes = votes[winner]

    # Métricas
    conviction   = round(winner_votes / total_available * 100)
    consensus    = winner_votes
    is_confirmed = winner_votes > total_available / 2

    return {
        "regime":            winner,
        "conviction":        conviction,
        "consensus":         consensus,
        "is_confirmed":      is_confirmed,
        "signals_expected":  total_expected,
        "signals_available": total_available,
        "missing_signals":   missing,
    }


def calculate_regimes(signals: list[dict]) -> dict:
    """
    Punto de entrada principal. Calcula los 3 regímenes.

    Args:
        signals: output de classify_all() — lista de todas las señales

    Returns:
        dict con los resultados de largo, medio y corto plazo.
    """
    # Separar señales núcleo por temporalidad
    core = [s for s in signals if s["is_core"]]

    largo_signals = [s for s in core if s["timeframe"] == "largo"]
    medio_signals = [s for s in core if s["timeframe"] == "medio"]
    corto_signals = [s for s in core if s["timeframe"] == "corto"]

    return {
        "largo": _calc_regime(largo_signals, "largo"),
        "medio": _calc_regime(medio_signals, "medio"),
        "corto": _calc_regime(corto_signals, "corto"),
    }
