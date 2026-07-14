"""
AXIOM v2 — Capa de dominio: fábrica raíz.
════════════════════════════════════════════════════════════════════════════
Punto de entrada único a la capa de dominio. Se crea UNA vez en el lifespan de
FastAPI y se guarda en `app.state.domain`. De ella cuelgan todas las entidades.

Uso en un router:
    domain = request.app.state.domain
    coin   = domain.coin("ontology")
    data   = await coin.overview(["precio_ref", "regimen_relativo"])

Diseño (ver AXIOM_diseno_api_dominio.md):
  - Entidades = clases (Coin, Par, Mercado, Watchlist).
  - Constructor BARATO: no consulta la base al instanciar; carga bajo demanda.
  - Mercado es singleton (su estado es del conjunto y se cachea).
  - Coin/Par/Watchlist son transitorias (baratas de crear).
"""
from __future__ import annotations

from backend.domain.coin import Coin
from backend.domain.mercado import Mercado
from backend.domain.watchlist import Watchlist


class AxiomDomain:
    """Fábrica raíz. Se crea una vez con el pool; produce entidades."""

    def __init__(self, pool):
        self._pool = pool
        self._mercado: Mercado | None = None   # singleton perezoso

    # ── Entidades individuales (construcción barata) ──────────────────────────
    def coin(self, coin_id: str) -> Coin:
        # Se inyecta la fábrica para que la Coin pueda acceder a Mercado singleton
        return Coin(self._pool, coin_id, domain=self)

    def par(self, coin_id: str, exchange: str, quote: str):
        return self.coin(coin_id).par(exchange, quote)

    # ── Entidad singleton ─────────────────────────────────────────────────────
    def mercado(self) -> Mercado:
        if self._mercado is None:
            self._mercado = Mercado(self._pool)
        return self._mercado

    # ── Colección ─────────────────────────────────────────────────────────────
    def watchlist(self) -> Watchlist:
        return Watchlist(self._pool)
