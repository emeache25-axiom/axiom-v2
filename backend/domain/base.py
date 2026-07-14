"""
AXIOM v2 — Capa de dominio: base común.
════════════════════════════════════════════════════════════════════════════
Mixin con el compositor `overview()` que comparten las entidades componibles
(Coin, Par, Mercado).

Patrón "B sobre A" (ver diseño): cada capacidad es un método async atómico; el
compositor recibe la lista pedida y las resuelve EN PARALELO, devolviendo solo
eso. `return_exceptions=True`: una capacidad que falla (ej. RSS caído) NO tumba
al resto — vuelve None y las demás llegan.

Cada entidad define `_capacidades()` → dict {nombre: método_async}.
"""
from __future__ import annotations
import asyncio
import logging

logger = logging.getLogger(__name__)


class Composable:
    """Aporta `overview()`. La subclase implementa `_capacidades()`."""

    def _capacidades(self) -> dict:
        """Devuelve {nombre_capacidad: método_async_sin_args}. Override en subclase."""
        raise NotImplementedError

    async def overview(self, capacidades: list[str]) -> dict:
        """Resuelve las capacidades pedidas en paralelo. Devuelve {nombre: dato|None}."""
        disponibles = self._capacidades()
        pedidas = [c for c in capacidades if c in disponibles]

        desconocidas = [c for c in capacidades if c not in disponibles]
        if desconocidas:
            logger.warning("[domain] capacidades desconocidas ignoradas: %s", desconocidas)

        if not pedidas:
            return {}

        resultados = await asyncio.gather(
            *[disponibles[c]() for c in pedidas],
            return_exceptions=True,
        )

        salida: dict = {}
        for nombre, res in zip(pedidas, resultados):
            if isinstance(res, Exception):
                logger.warning("[domain] capacidad '%s' falló: %s", nombre, res)
                salida[nombre] = None
            else:
                salida[nombre] = res
        return salida
