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
        """Noticias globales (RSS). Fuente: news_service.
        get_news devuelve {'articles': [...], 'total': ...}; se normaliza a
        {'articulos': [...]} para el contrato del dominio."""
        try:
            from backend.services.news_service import get_news
            data = await get_news(source=fuente) if fuente else await get_news()
        except Exception:
            data = {}
        articulos = data.get("articles", []) if isinstance(data, dict) else []
        return {"articulos": articulos, "total": len(articulos)}

    # ══ MAPA Y SECTOR (fuerza de sectores) ════════════════════════════════════

    # Umbral de lectura de fuerza sectorial (sobre change_7d). Calibrable.
    _UMBRAL_FUERTE = 3.0    # >+3% en 7d → sector fuerte
    _UMBRAL_DEBIL  = -3.0   # <-3% en 7d → sector débil

    def _lectura_sector(self, change_7d: float | None) -> str:
        if change_7d is None:
            return "sector_neutral"
        if change_7d > self._UMBRAL_FUERTE:
            return "sector_fuerte"
        if change_7d < self._UMBRAL_DEBIL:
            return "sector_debil"
        return "sector_neutral"

    async def mapa(self) -> dict:
        """
        Categorías agregadas por supercategoría, CON ranking de fuerza.
        Fuente de verdad del sector (sector() filtra de acá).
        Orden de fuerza: change_7d principal, change_24h desempate.
        Lectura: valor absoluto del change_7d (fuerte/neutral/débil).
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    supercat,
                    SUM(market_cap)  AS total_mcap,
                    AVG(change_24h)  AS avg_change_24h,
                    AVG(change_7d)   AS avg_change_7d,
                    COUNT(*)         AS coin_count
                FROM coins
                WHERE market_cap IS NOT NULL AND market_cap > 0
                GROUP BY supercat
                ORDER BY total_mcap DESC
            """)

        total_mcap = sum(float(r["total_mcap"]) for r in rows if r["total_mcap"])

        categorias = []
        for r in rows:
            sc      = r["supercat"] or "otros"
            mcap    = float(r["total_mcap"]) if r["total_mcap"] else 0.0
            c24     = round(float(r["avg_change_24h"]), 2) if r["avg_change_24h"] is not None else None
            c7d     = round(float(r["avg_change_7d"]),  2) if r["avg_change_7d"]  is not None else None
            pct     = round(mcap / total_mcap * 100, 2) if total_mcap > 0 else 0.0
            categorias.append({
                "supercategoria": sc,
                "market_cap":     mcap,
                "peso_pct":       pct,
                "change_24h":     c24,
                "change_7d":      c7d,
                "coin_count":     r["coin_count"],
                # lectura (crudo + interpretación): etiqueta por valor absoluto del 7d
                "lectura":        self._lectura_sector(c7d),
            })

        # Ranking de fuerza: change_7d principal, change_24h desempate.
        # None al fondo (se tratan como muy negativos para el orden).
        def _clave(c):
            c7 = c["change_7d"] if c["change_7d"] is not None else -9999
            c24 = c["change_24h"] if c["change_24h"] is not None else -9999
            return (c7, c24)

        ordenadas = sorted(categorias, key=_clave, reverse=True)
        for i, c in enumerate(ordenadas, start=1):
            c["fuerza_rank"] = i

        # Se devuelve en orden de fuerza (rank 1 = sector más fuerte)
        return {
            "categorias": ordenadas,
            "total_mcap": total_mcap,
            "criterio":   "change_7d (desempate change_24h)",
        }

    async def sector(self, supercategoria: str) -> dict:
        """
        Fila de UNA categoría del mapa. NO recalcula: usa mapa() y filtra.
        Una sola fuente de verdad. Es lo que la Coin consume para su
        posicion_sectorial en regimen_relativo.
        """
        m = await self.mapa()
        for c in m.get("categorias", []):
            if c["supercategoria"] == supercategoria:
                return {
                    "supercategoria":    c["supercategoria"],
                    "sector_change_24h": c["change_24h"],
                    "sector_change_7d":  c["change_7d"],
                    "sector_rank":       c["fuerza_rank"],
                    "total_sectores":    len(m["categorias"]),
                    "lectura":           c["lectura"],
                }
        # Sin datos para esa supercategoría
        return {
            "supercategoria":    supercategoria,
            "sector_change_24h": None,
            "sector_change_7d":  None,
            "sector_rank":       None,
            "total_sectores":    len(m.get("categorias", [])),
            "lectura":           "sector_neutral",
        }

    async def ranking(self, criterio: str = "market_cap", n: int = 10) -> dict:
        """Top N coins por criterio. Fuente: coins (PG)."""
        columnas = {
            "market_cap": "market_cap",
            "change_24h": "change_24h",
            "change_7d":  "change_7d",
            "volume_24h": "volume_24h",
        }
        col = columnas.get(criterio, "market_cap")
        n = max(1, min(100, n))
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(f"""
                SELECT id, symbol, name, rank, price, {col} AS valor,
                       change_24h, image
                FROM coins
                WHERE {col} IS NOT NULL AND rank IS NOT NULL
                ORDER BY {col} DESC NULLS LAST
                LIMIT $1
            """, n)
        coins = []
        for i, r in enumerate(rows, start=1):
            coins.append({
                "posicion":   i,
                "coin_id":    r["id"],
                "symbol":     r["symbol"],
                "name":       r["name"],
                "rank":       r["rank"],
                "valor":      float(r["valor"]) if r["valor"] is not None else None,
                "change_24h": float(r["change_24h"]) if r["change_24h"] is not None else None,
                "image":      r["image"],
            })
        return {"criterio": criterio, "coins": coins}

    async def top_n(self, criterio: str = "market_cap", n: int = 10) -> dict:
        return await self.ranking(criterio, n)

    async def screener(self, criterios: dict | None = None) -> dict:
        # TODO: coins PG filtrado por régimen (reubicado desde watchlist).
        return {"_stub": "screener pendiente", "coins": []}
