"""
AXIOM v2 — Strategy Engine.

Pipeline de capas independientes para el bot de paper-trading:
  data_engine    → velas OHLCV (MEXC/CoinEx) con caché
  feature_engine → indicadores/features → contexto
  pair_discovery → detección de pares operables
  strategy_base  → interfaz + registro de estrategias (plugins)
  execution_engine → ciclo multi-estrategia con capital propio
  stats_engine   → métricas comparables por estrategia

Las estrategias-plugin (strat_*.py) se importan acá para que se auto-registren.
"""

def load_strategies():
    """Importa los plugins de estrategia para que se registren en el registry."""
    from . import strat_scalp_meanrev  # noqa: F401
