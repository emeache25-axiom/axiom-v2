"""
AXIOM v2 — Strategy Engine / Interfaz de Estrategia + Registro.

Define el CONTRATO que toda estrategia debe cumplir y un registro donde las
estrategias se auto-registran (mismo patrón que los indicadores de charts:
un archivo nuevo + @register y queda disponible, sin tocar el resto).

Una estrategia NO sabe de dónde vienen los datos, cómo se ejecutan las órdenes
ni cómo se miden las estadísticas. Solo:
  - declara qué timeframe y cuántas velas necesita
  - declara sus parámetros configurables (con defaults)
  - dado un FeatureContext, decide si ENTRAR (should_enter)
  - dada una posición abierta + contexto, decide si SALIR (should_exit)

El motor de ejecución se encarga del resto.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


# ── Señales que devuelve una estrategia ───────────────────────────────────────

@dataclass
class EntrySignal:
    """Señal de entrada. El motor decide tamaño/stop según la config."""
    reason: str                       # texto explicativo (va al log y Telegram)
    # Stop loss sugerido por la estrategia (precio absoluto). Si None, el motor
    # usa el stop_loss_pct global de la config de esa estrategia.
    stop_price: Optional[float] = None
    # Take profit sugerido (precio absoluto). Opcional.
    take_price: Optional[float] = None
    meta: dict = field(default_factory=dict)


@dataclass
class ExitSignal:
    """Señal de salida de una posición abierta."""
    reason: str                       # 'take_profit' | 'stop_loss' | 'señal: ...'
    meta: dict = field(default_factory=dict)


# ── Definición de un parámetro configurable ───────────────────────────────────

@dataclass
class Param:
    key: str
    label: str
    type: str                         # 'number' | 'select' | 'bool'
    default: object
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[list] = None    # para 'select': [{v, l}, ...]


# ── Clase base de estrategia ───────────────────────────────────────────────────

class Strategy:
    """
    Clase base. Cada estrategia concreta hereda y define:
      - key, name, description
      - timeframe, lookback (cuántas velas pedir al data_engine)
      - params (lista de Param)
      - should_enter(ctx, p) -> EntrySignal | None
      - should_exit(position, ctx, p) -> ExitSignal | None

    `p` es el dict de parámetros efectivos (defaults + overrides del usuario).
    `ctx` es un FeatureContext (motor de features).
    """
    key: str = ""
    name: str = ""
    description: str = ""
    timeframe: str = "5m"
    lookback: int = 200
    params: list = []

    def defaults(self) -> dict:
        return {pr.key: pr.default for pr in self.params}

    def merge_params(self, overrides: dict | None) -> dict:
        p = self.defaults()
        if overrides:
            p.update({k: v for k, v in overrides.items() if k in p})
        return p

    # A implementar por cada estrategia
    def should_enter(self, ctx, p: dict) -> Optional[EntrySignal]:
        raise NotImplementedError

    def should_exit(self, position: dict, ctx, p: dict) -> Optional[ExitSignal]:
        raise NotImplementedError


# ── Registro de estrategias ────────────────────────────────────────────────────

class StrategyRegistry:
    def __init__(self):
        self._strategies: dict[str, Strategy] = {}

    def register(self, strategy_cls):
        """Decorador: @registry.register sobre una subclase de Strategy."""
        inst = strategy_cls()
        if not inst.key:
            raise ValueError("La estrategia debe definir 'key'")
        self._strategies[inst.key] = inst
        return strategy_cls

    def get(self, key: str) -> Optional[Strategy]:
        return self._strategies.get(key)

    def all(self) -> list[Strategy]:
        return list(self._strategies.values())

    def catalog(self) -> list[dict]:
        """Metadata de todas las estrategias (para el frontend)."""
        out = []
        for s in self._strategies.values():
            out.append({
                "key": s.key,
                "name": s.name,
                "description": s.description,
                "timeframe": s.timeframe,
                "params": [
                    {"key": pr.key, "label": pr.label, "type": pr.type,
                     "default": pr.default, "min": pr.min, "max": pr.max,
                     "step": pr.step, "options": pr.options}
                    for pr in s.params
                ],
            })
        return out


# Registro global único
registry = StrategyRegistry()
