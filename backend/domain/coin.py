"""
AXIOM v2 — Capa de dominio: entidad Coin (la central).
════════════════════════════════════════════════════════════════════════════
La Coin es el centro; los pares son sus proyecciones (`coin.par(exchange, quote)`).

Constructor BARATO: no consulta la base. Los datos se cargan al pedir cada
capacidad. Instanciar 20 coins es gratis.

Estado de las capacidades en este esqueleto (paso 1):
  IMPLEMENTADAS (leen de lo que ya existe):
    - precio_ref, metadata_mercado  → tabla `coins` (PG)
    - alertas                       → tabla `price_alerts` (PG)
  STUB (se completan en pasos siguientes, ver diseño §9):
    - info_proyecto   → CoinGecko /coins/{id} [crear+cachear]
    - noticias        → filtra mercado.feed_noticias [crear]
    - pares           → pair_discovery / adaptadores
    - regimen_relativo→ consume Mercado (contexto + fuerza vs BTC + sector)
"""
from __future__ import annotations
import json

from backend.domain.base import Composable
from backend.domain.par import Par


class Coin(Composable):
    def __init__(self, pool, coin_id: str, domain=None):
        self._pool = pool
        self.id = coin_id
        self._domain = domain     # fábrica raíz, para acceder a Mercado singleton
        self._cache: dict = {}

    # ── Sub-entidad Par (fábrica interna) ─────────────────────────────────────
    def par(self, exchange: str, quote: str) -> Par:
        return Par(self._pool, coin=self, exchange=exchange, quote=quote)

    # ── Acceso a Mercado (singleton si hay fábrica; instancia suelta si no) ────
    def _mercado(self):
        if self._domain is not None:
            return self._domain.mercado()
        from backend.domain.mercado import Mercado
        return Mercado(self._pool)

    # ── Mapa de capacidades para el compositor ────────────────────────────────
    def _capacidades(self) -> dict:
        return {
            "precio_ref":       self.precio_ref,
            "metadata_mercado": self.metadata_mercado,
            "info_proyecto":    self.info_proyecto,
            "noticias":         self.noticias,
            "pares":            self.pares,
            "regimen_relativo": self.regimen_relativo,
            "alertas":          self.alertas,
        }

    # ══ CAPACIDADES IMPLEMENTADAS ═════════════════════════════════════════════

    async def precio_ref(self) -> dict:
        """Precio de referencia + %cambios. Fuente: coins (PG)."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT symbol, price, change_24h, change_7d FROM coins WHERE id=$1",
                self.id,
            )
        if not row:
            return {"price": None, "change_24h": None, "change_7d": None, "quote": "USD"}
        return {
            "price":      float(row["price"])      if row["price"]      is not None else None,
            "change_24h": float(row["change_24h"]) if row["change_24h"] is not None else None,
            "change_7d":  float(row["change_7d"])  if row["change_7d"]  is not None else None,
            "quote":      "USD",
        }

    async def metadata_mercado(self) -> dict:
        """Market cap, rank, volumen, supercategoría, sparkline. Fuente: coins (PG)."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT symbol, name, rank, market_cap, volume_24h,
                          image, sparkline, supercat
                   FROM coins WHERE id=$1""",
                self.id,
            )
        if not row:
            return {}
        sparkline = None
        if row["sparkline"]:
            try:
                sparkline = json.loads(row["sparkline"]) if isinstance(row["sparkline"], str) else row["sparkline"]
            except Exception:
                sparkline = None
        return {
            "symbol":         row["symbol"],
            "name":           row["name"],
            "rank":           row["rank"],
            "market_cap":     float(row["market_cap"]) if row["market_cap"] is not None else None,
            "volume_24h":     float(row["volume_24h"]) if row["volume_24h"] is not None else None,
            "image":          row["image"],
            "sparkline":      sparkline,
            "supercategoria": row["supercat"],
        }

    async def alertas(self) -> list:
        """Alertas de precio de esta coin. Fuente: price_alerts (PG)."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, symbol, exchange, direction, target, recurring, active
                   FROM price_alerts WHERE coin_id=$1 ORDER BY id DESC""",
                self.id,
            )
        return [dict(r) for r in rows]

    # ══ CAPACIDADES STUB (se completan en pasos siguientes) ═══════════════════

    async def info_proyecto(self) -> dict:
        # TODO paso 5: CoinGecko /coins/{id}, cachear en tabla coin_info.
        return {"_stub": "info_proyecto pendiente (CoinGecko /coins/{id})"}

    async def noticias(self) -> dict:
        """
        Noticias de la coin: filtra el feed global de Mercado por símbolo+nombre.
        Una sola fuente de RSS (Mercado); la Coin solo filtra su vista.
        Filtrado simple (match en título+resumen); refinable después.
        """
        mercado = self._mercado()
        feed = await mercado.feed_noticias()
        articulos = feed.get("articulos", []) if isinstance(feed, dict) else []

        # Datos para el match: símbolo y nombre de la coin
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT symbol, name FROM coins WHERE id=$1", self.id)
        if not row:
            return {"articulos": []}
        symbol = (row["symbol"] or "").lower()
        name   = (row["name"] or "").lower()
        terminos = {t for t in (symbol, name) if t and len(t) >= 2}

        def _matches(art: dict) -> bool:
            # Claves reales del artículo del news_service: title, summary
            texto = ""
            for campo in ("title", "summary"):
                v = art.get(campo)
                if v:
                    texto += " " + str(v).lower()
            return any(t in texto for t in terminos)

        filtrados = [a for a in articulos if _matches(a)]
        return {"articulos": filtrados, "match_terms": sorted(terminos)}

    async def pares(self) -> list:
        """
        Pares operables de la coin, descubiertos en MEXC y CoinEx.
        Fuente: pair_discovery (que consolida el acceso a mercados de exchange).
        Cada item: {exchange, base, quote, pair_symbol, operable}.
        Puerta a la sub-entidad Par: coin.par(item['exchange'], item['quote']).
        """
        # Necesita el símbolo base de la coin
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT symbol FROM coins WHERE id=$1", self.id)
        if not row or not row["symbol"]:
            return []
        from backend.strat.pair_discovery import discover_pairs
        return await discover_pairs(row["symbol"])

    async def regimen_relativo(self) -> dict:
        """
        Cómo se para la coin en el clima de mercado. Combina:
          A) contexto_global — el régimen del mercado (consume Mercado)
          C) posicion_sectorial — fuerza del sector de la coin (consume Mercado)
          A) fuerza_vs_btc — ratio COIN/BTC (par directo o derivado)
        """
        mercado = self._mercado()
        supercat = await self._supercategoria()

        import asyncio as _asyncio
        contexto, sector, fuerza = await _asyncio.gather(
            mercado.regimen_global(),
            mercado.sector(supercat) if supercat else _noop(),
            self._fuerza_vs_btc(),
            return_exceptions=True,
        )
        contexto = {} if isinstance(contexto, Exception) else contexto
        sector   = None if isinstance(sector, Exception) else sector
        fuerza   = None if isinstance(fuerza, Exception) else fuerza

        return {
            "contexto_global":    contexto,
            "posicion_sectorial": sector,
            "fuerza_vs_btc":      fuerza,
        }

    # Umbral de lectura de fuerza vs BTC (sobre ratio_change_7d). Igual que sectores.
    _UMBRAL_LIDER    = 3.0    # >+3% en 7d vs BTC → líder
    _UMBRAL_REZAGADA = -3.0   # <-3% en 7d vs BTC → rezagada

    def _lectura_fuerza(self, ratio_change_7d: float | None) -> str:
        if ratio_change_7d is None:
            return "neutral"
        if ratio_change_7d > self._UMBRAL_LIDER:
            return "lider"
        if ratio_change_7d < self._UMBRAL_REZAGADA:
            return "rezagada"
        return "neutral"

    @staticmethod
    def _pct_change(serie: list, atras: int) -> float | None:
        """Cambio % del último close vs el close `atras` velas atrás."""
        if not serie or len(serie) <= atras:
            return None
        actual = serie[-1].get("close")
        previo = serie[-1 - atras].get("close")
        if not actual or not previo:
            return None
        return round((actual / previo - 1) * 100, 2)

    async def _fuerza_vs_btc(self) -> dict:
        """
        Fuerza relativa de la coin vs BTC. Usa el par COIN/BTC DIRECTO si existe,
        deriva (COIN/USDT ÷ BTC/USDT) si no. Crudo + interpretación.
        """
        # Caso trivial: bitcoin vs sí mismo
        if self.id == "bitcoin":
            return {"ratio_change_7d": 0.0, "ratio_change_24h": 0.0,
                    "lectura": "neutral", "fuente_calculo": "es_btc"}

        # 1) ¿Hay par COIN/BTC directo operable?
        pares = await self.pares()
        par_btc = next((p for p in pares if p.get("quote") == "BTC"), None)

        if par_btc:
            # Directo: velas del par COIN/BTC en satoshis
            par = self.par(par_btc["exchange"], "BTC")
            velas = await par.velas_hist(timeframe="1d", limit=10)
            c7  = self._pct_change(velas, 7)
            c24 = self._pct_change(velas, 1)
            return {
                "ratio_change_7d":  c7,
                "ratio_change_24h": c24,
                "lectura":          self._lectura_fuerza(c7),
                "fuente_calculo":   "par_btc",
            }

        # 2) Derivado: COIN/USDT ÷ BTC/USDT
        par_coin = next((p for p in pares if p.get("quote") == "USDT"), None)
        if not par_coin:
            return {"ratio_change_7d": None, "ratio_change_24h": None,
                    "lectura": "neutral", "fuente_calculo": "sin_datos"}

        coin_par = self.par(par_coin["exchange"], "USDT")
        btc_par  = Coin(self._pool, "bitcoin", domain=self._domain).par(par_coin["exchange"], "USDT")
        import asyncio as _asyncio
        vc, vb = await _asyncio.gather(
            coin_par.velas_hist(timeframe="1d", limit=10),
            btc_par.velas_hist(timeframe="1d", limit=10),
            return_exceptions=True,
        )
        vc = [] if isinstance(vc, Exception) else vc
        vb = [] if isinstance(vb, Exception) else vb

        def _ratio_change(atras: int) -> float | None:
            if not vc or not vb or len(vc) <= atras or len(vb) <= atras:
                return None
            rc_now = vc[-1].get("close");  rb_now = vb[-1].get("close")
            rc_old = vc[-1-atras].get("close"); rb_old = vb[-1-atras].get("close")
            if not all([rc_now, rb_now, rc_old, rb_old]):
                return None
            ratio_now = rc_now / rb_now
            ratio_old = rc_old / rb_old
            if not ratio_old:
                return None
            return round((ratio_now / ratio_old - 1) * 100, 2)

        c7  = _ratio_change(7)
        c24 = _ratio_change(1)
        return {
            "ratio_change_7d":  c7,
            "ratio_change_24h": c24,
            "lectura":          self._lectura_fuerza(c7),
            "fuente_calculo":   "derivado",
        }

    # ── Helper interno (para futuras capacidades) ─────────────────────────────
    async def _supercategoria(self) -> str | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT supercat FROM coins WHERE id=$1", self.id)
        return row["supercat"] if row else None


async def _noop():
    """Coroutine vacía para gather cuando no hay supercategoría."""
    return None
