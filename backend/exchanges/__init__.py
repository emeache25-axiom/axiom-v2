"""
AXIOM v2 — Paquete de acceso a exchanges.

Uso:
    from backend.exchanges import CoinEx, Mexc, Binance, CoinGecko
    from backend.exchanges import get_adapter

    cx = CoinEx()
    precio = await cx.get_price("ONTBTC")

    # o por nombre (para resolver desde config/DB):
    adapter = get_adapter("coinex")
    precio = await adapter.get_price("ONTBTC")

El exchange SIEMPRE es explícito. No hay fallback silencioso entre exchanges:
un par-en-su-exchange es el par.
"""
from .base import ExchangeAdapter, CapabilityError, TIMEFRAMES
from .coinex import CoinEx
from .mexc import Mexc
from .binance import Binance
from .coingecko import CoinGecko

# Registro por nombre → clase. Instancias singleton (los adaptadores no guardan
# estado por par; cada método recibe el símbolo, así que una instancia alcanza).
_INSTANCES: dict[str, ExchangeAdapter] = {}

_CLASSES = {
    "coinex":    CoinEx,
    "mexc":      Mexc,
    "binance":   Binance,
    "coingecko": CoinGecko,
}


def get_adapter(name: str) -> ExchangeAdapter:
    """Devuelve el adaptador del exchange por nombre (singleton).
    Lanza KeyError si el exchange no existe."""
    key = (name or "").lower()
    if key not in _CLASSES:
        raise KeyError(f"Exchange desconocido: '{name}'. "
                       f"Disponibles: {list(_CLASSES.keys())}")
    if key not in _INSTANCES:
        _INSTANCES[key] = _CLASSES[key]()
    return _INSTANCES[key]


def all_adapters() -> dict[str, ExchangeAdapter]:
    """Todos los adaptadores instanciados (útil para introspección de capacidades)."""
    return {name: get_adapter(name) for name in _CLASSES}


__all__ = [
    "ExchangeAdapter", "CapabilityError", "TIMEFRAMES",
    "CoinEx", "Mexc", "Binance", "CoinGecko",
    "get_adapter", "all_adapters",
]
