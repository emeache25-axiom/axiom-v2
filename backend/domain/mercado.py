"""
AXIOM v2 — Capa de dominio: entidad Mercado (singleton).
════════════════════════════════════════════════════════════════════════════
Entidad singleton: sus capacidades son propiedades del CONJUNTO (régimen, mapa,
feed), no de coins individuales. Sirve a la pantalla Mercado Y a la Coin (que le
consume régimen + sector para `regimen_relativo`, y el feed para `noticias`).

Estado en este esqueleto (paso 1):
  IMPLEMENTADAS:
    - regimen_global  → snapshots/signal_readings (PG), como /api/regime/latest
    - feed_noticias   → news_service (RSS)
  STUB:
    - mapa    → coins PG agregado + ranking de sectores [ampliar, paso 4]
    - sector  → usa mapa() y filtra [crear sobre mapa]
    - ranking / top_n → coins PG ordenado
    - screener→ coins PG filtrado por régimen (reubicado desde watchlist)
"""
from __future__ import annotations

from backend.domain.base import Composable


class Mercado(Composable):
    def __init__(self, pool):
        self._pool = pool
        self._cache: dict = {}     # régimen/mapa con TTL corto (a definir)

    def _capacidades(self) -> dict:
        return {
            "regimen_global": self.regimen_global,
            "mapa":           self.mapa,
            "ranking":        self.ranking,
            "screener":       self.screener,
            "feed_noticias":  self.feed_noticias,
        }

    # ══ IMPLEMENTADAS ═════════════════════════════════════════════════════════

    async def regimen_global(self) -> dict:
        """Snapshot de régimen 3 temporalidades. Fuente: snapshots (PG)."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1"""
            )
        if not row:
            return {}
        d = dict(row)
        return {
            "largo": {"regime": d.get("regime_largo"),
                      "conviction": d.get("conviction_largo")},
            "medio": {"regime": d.get("regime_medio"),
                      "conviction": d.get("conviction_medio")},
            "corto": {"regime": d.get("regime_corto"),
                      "conviction": d.get("conviction_corto")},
            "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
        }

    async def feed_noticias(self, fuente: str | None = None) -> dict:
        """Noticias globales (RSS). Fuente: news_service."""
        try:
            from backend.services.news_service import get_news
            articulos = await get_news(source=fuente) if fuente else await get_news()
        except TypeError:
            # firma distinta: intentar sin kwargs
            from backend.services.news_service import get_news
            articulos = await get_news()
        except Exception:
            articulos = []
        return {"articulos": articulos}

    # ══ STUB (paso 4) ═════════════════════════════════════════════════════════

    async def mapa(self) -> dict:
        # TODO paso 4: agregar coins por supercategoría + ranking de fuerza de sectores.
        return {"_stub": "mapa pendiente (categorías + ranking sectores)",
                "categorias": [], "redes": []}

    async def sector(self, supercategoria: str) -> dict:
        # TODO paso 4: usar mapa() y filtrar la categoría (una sola fuente de verdad).
        return {"_stub": "sector pendiente", "supercategoria": supercategoria}

    async def ranking(self, criterio: str = "market_cap", n: int = 10) -> dict:
        # TODO: coins PG ordenado por criterio.
        return {"_stub": "ranking pendiente", "criterio": criterio, "coins": []}

    async def top_n(self, criterio: str = "market_cap", n: int = 10) -> dict:
        return await self.ranking(criterio, n)

    async def screener(self, criterios: dict | None = None) -> dict:
        # TODO: coins PG filtrado por régimen (reubicado desde watchlist).
        return {"_stub": "screener pendiente", "coins": []}
