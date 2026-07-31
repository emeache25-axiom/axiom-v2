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
from backend.domain.registry import capacidad, Param


# Supercategorías que no son sectores y quedan fuera del ranking de fuerza,
# con la lectura que se les asigna.
_NO_RANKEABLES = {
    "otros":   "sin_clasificar",
    "wrapped": "derivado",          # replica a su subyacente
}

# Umbrales de relevancia para entrar al ranking de fuerza. Ambos son
# necesarios: uno mide si el agregado tiene sentido estadístico, el otro si
# mover ese sector significa algo en el mercado.
#
# Sin esto, un sector de 12 coins y el 0,01% de la capitalización encabezaba el
# ranking igual que uno de 400 coins — y decía muy poco: con tan pocos activos,
# el agregado es prácticamente el movimiento de uno solo.
#
# Los que no llegan NO se ocultan: aparecen con todos sus datos y su variación,
# pero sin puesto en el ranking. Esconderlos sería perder información;
# rankearlos de igual a igual sería engañoso.
_MIN_COINS_RANKING = 10      # cantidad mínima de coins en el sector
_MIN_PESO_RANKING  = 0.05    # % mínimo de la capitalización total del mercado


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

    @capacidad(
        nombre="regimen_mercado",
        descripcion=(
            "El régimen vigente del mercado cripto en tres temporalidades "
            "(largo, medio y corto plazo), con su nivel de convicción. Es el "
            "clima general, medido sobre Bitcoin como proxy del conjunto. "
            "Usar cuando se pregunte por el estado del mercado, el ciclo o el "
            "contexto general."
        ),
        entidad="mercado",
        categoria="mercado",
        costo="barato",
        devuelve=(
            "por cada temporalidad: régimen (ACUMULACION, ALCISTA_A, ALCISTA_B, "
            "DISTRIBUCION, BAJISTA, LATERAL) y convicción 0-100; más la marca de "
            "tiempo del snapshot"
        ),
        mide=(
            "el último snapshot guardado: el régimen clasificado y la convicción "
            "(0-100) para cada una de las tres temporalidades, con su timestamp"
        ),
        infiere=(
            "el régimen ES una clasificación inferida: 12 señales votan y el "
            "resultado se pondera por temporalidad. La convicción mide cuánto "
            "coinciden las señales entre sí, no la probabilidad de que el "
            "mercado se comporte según ese régimen"
        ),
        no_sabe=(
            "si el régimen se sostendrá ni cuándo cambiará; una convicción alta "
            "significa acuerdo entre señales, no certeza sobre el futuro. "
            "Tampoco dice nada de coins individuales: es el conjunto medido "
            "sobre BTC, y una coin puede moverse en contra del régimen"
        ),
        fuente="tabla `snapshots`, escrita por el job de régimen cada 60 minutos",
        metodo=(
            "voto ponderado de 12 señales núcleo (valuación, momentum, "
            "sentimiento, flujo, participación) evaluadas en tres ventanas "
            "temporales; la convicción es el grado de consenso entre ellas"
        ),
    )
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

    @capacidad(
        nombre="noticias_mercado",
        descripcion=(
            "Titulares recientes del mercado cripto desde fuentes RSS. Usar "
            "cuando se pregunte qué está pasando, qué se dice, o por novedades "
            "del sector en general (no de una coin puntual)."
        ),
        entidad="mercado",
        categoria="mercado",
        costo="medio",
        devuelve="lista de artículos con título, resumen, fuente, link y fecha",
        mide=(
            "los artículos publicados en los feeds RSS configurados, tal como "
            "los entrega cada fuente"
        ),
        infiere="nada — no hay clasificación ni análisis de los artículos",
        no_sabe=(
            "si una noticia es relevante, veraz o ya está descontada en el "
            "precio: no hay verificación de fuentes, ni análisis de sentimiento, "
            "ni relación establecida entre la noticia y el movimiento de ningún "
            "activo. Tampoco cubre todo lo publicado: solo los feeds "
            "configurados, que pueden omitir información importante"
        ),
        fuente="feeds RSS de medios cripto, consultados en el momento del pedido",
        metodo="lectura directa del RSS, sin filtrado ni ranking",
        parametros=[
            Param("fuente", str,
                  "Limitar a una fuente concreta. Si se omite, trae todas.",
                  requerido=False),
        ],
    )
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

    # Umbrales de lectura de fuerza sectorial, sobre el cambio PONDERADO a 7d.
    # OJO: se recalibraron al pasar de promedio simple a ponderado — los valores
    # ponderados son bastante más chicos (ver método de `mapa`).
    _UMBRAL_FUERTE = 3.0    # >+3% en 7d ponderado → sector fuerte
    _UMBRAL_DEBIL  = -3.0   # <-3% en 7d ponderado → sector débil

    def _lectura_sector(self, change_7d: float | None) -> str:
        if change_7d is None:
            return "sector_neutral"
        if change_7d > self._UMBRAL_FUERTE:
            return "sector_fuerte"
        if change_7d < self._UMBRAL_DEBIL:
            return "sector_debil"
        return "sector_neutral"

    @capacidad(
        nombre="mapa_sectores",
        descripcion=(
            "El mapa del mercado por sectores: cada supercategoría (defi, ai, "
            "memes, layer2, gaming, privacy, etc.) con su capitalización total, "
            "peso relativo, variación ponderada por capitalización, mediana y "
            "promedio simple, y su posición en el ranking de fuerza. Usar para "
            "preguntas sobre qué sectores están fuertes o débiles, o cómo se "
            "reparte el mercado."
        ),
        entidad="mercado",
        categoria="mercado",
        costo="barato",
        devuelve=(
            "lista de supercategorías ordenadas por fuerza. Campos clave: "
            "`change_7d` y `change_24h` son la variación PONDERADA por "
            "capitalización (cuánto se movió el capital del sector); "
            "`mediana_7d` es cómo le fue a la coin típica; "
            "`promedio_simple_7d` es el promedio sin ponderar; y "
            "`dispersion` = promedio_simple − ponderado. "
            "CÓMO LEER dispersion: si es ALTA Y POSITIVA, el movimiento viene "
            "de las coins CHICAS (que pesan igual en el promedio simple pero "
            "poco en el ponderado); si es NEGATIVA, se movieron las GRANDES y "
            "las chicas quedaron atrás; si es cercana a cero, el movimiento fue "
            "parejo. Además: market_cap, peso_pct, coin_count, `clasificado`, "
            "lectura (fuerte/neutral/débil, `muestra_chica` o "
            "`sin_clasificar`) y fuerza_rank (null para los que no entran al "
            "ranking)"
        ),
        mide=(
            "por cada supercategoría: la suma de capitalizaciones; la variación "
            "a 24h y 7d PONDERADA por capitalización (cuánto se movió el capital "
            "invertido en el sector); la MEDIANA de la variación a 7d (cómo le "
            "fue a la coin típica, sin que un caso extremo la distorsione); y el "
            "promedio simple a 7d, que se conserva para comparar"
        ),
        infiere=(
            "dos lecturas: la etiqueta sector_fuerte/neutral/débil según un "
            "umbral de ±3% sobre la variación PONDERADA a 7 días, y el ranking "
            "de fuerza que ordena por esa misma variación. El umbral es un "
            "criterio elegido, no una constante del mercado"
        ),
        no_sabe=(
            "si un sector chico se comportará como sugiere su agregado: los "
            "que tienen menos de 10 coins o menos del 0,05% del mercado se "
            "devuelven con lectura `muestra_chica` y sin puesto en el ranking, "
            "porque con tan pocos activos el promedio es prácticamente el "
            "movimiento de uno solo. "
            "Tampoco sabe si la fuerza sectorial se sostendrá; el umbral de ±3% es "
            "calibrable y otro valor daría otras etiquetas. La clasificación "
            "por supercategoría es de AXIOM sobre las categorías de CoinGecko: "
            "una coin puede pertenecer razonablemente a más de un sector y solo "
            "se le asigna uno. Dos grupos NO son sectores y quedan fuera del "
            "ranking (clasificado=false): 'otros', que agrupa lo que no se pudo "
            "clasificar y por lo tanto no representa la fuerza de nada; y "
            "'wrapped', que son tokens envueltos o puenteados que replican a su "
            "subyacente — su movimiento es un reflejo, no dinámica propia, y "
            "sumarlos a un sector duplicaría capital ya contado. Y los datos "
            "son del último sync, hasta 6 horas de antigüedad"
        ),
        fuente="tabla `coins` (sync desde CoinGecko cada 6 h)",
        metodo=(
            "agregación SQL por supercategoría. Solo entran al ranking los "
            "sectores con al menos 10 coins Y 0,05% de la capitalización "
            "total: ambos umbrales son necesarios, uno mide si el agregado "
            "tiene sentido estadístico y el otro si el sector pesa en el "
            "mercado. La variación es un promedio "
            "PONDERADO por capitalización: SUM(cambio × market_cap) / "
            "SUM(market_cap). Se usa ponderado —y no promedio simple— porque el "
            "simple daba lecturas equivocadas: una micro-cap con +8.739% "
            "arrastraba el promedio de un sector de 133 coins a +73%, y sectores "
            "que caían por capital figuraban como fuertes. La mediana usa "
            "PERCENTILE_CONT(0.5), inmune a valores extremos"
        ),
    )
    async def mapa(self) -> dict:
        """
        Categorías agregadas por supercategoría, CON ranking de fuerza.
        Fuente de verdad del sector (sector() filtra de acá).

        La variación se pondera por capitalización: mide cuánto se movió el
        CAPITAL del sector, no la coin promedio. Se agrega la mediana para
        responder "cómo le fue a la coin típica" sin que la distorsione un
        caso extremo.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    -- COALESCE unifica: sin esto, las coins con supercat NULL
                    -- formaban un grupo aparte que luego se renombraba 'otros',
                    -- y aparecían DOS entradas con el mismo nombre.
                    COALESCE(supercat, 'otros') AS supercat,
                    SUM(market_cap)  AS total_mcap,
                    COUNT(*)         AS coin_count,
                    -- Variación ponderada por capitalización (principal)
                    SUM(change_24h * market_cap) / NULLIF(SUM(market_cap), 0) AS pond_24h,
                    SUM(change_7d  * market_cap) / NULLIF(SUM(market_cap), 0) AS pond_7d,
                    -- Mediana: la coin típica, inmune a outliers
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_7d) AS mediana_7d,
                    -- Promedio simple: se conserva para medir dispersión
                    AVG(change_24h)  AS simple_24h,
                    AVG(change_7d)   AS simple_7d
                FROM coins
                WHERE market_cap IS NOT NULL AND market_cap > 0
                GROUP BY COALESCE(supercat, 'otros')
                ORDER BY total_mcap DESC
            """)

        total_mcap = sum(float(r["total_mcap"]) for r in rows if r["total_mcap"])

        def _r(v, dec=2):
            return round(float(v), dec) if v is not None else None

        categorias = []
        for r in rows:
            sc   = r["supercat"] or "otros"
            # Dos grupos que NO son sectores y quedan fuera del ranking:
            #   · 'otros'   — ausencia de clasificación: proyectos sin nada en
            #                 común, su agregado no representa la fuerza de nada.
            #   · 'wrapped' — tokens envueltos o puenteados (WETH, WSTEAMX):
            #                 replican a su subyacente, no tienen dinámica
            #                 propia. Rankearlos sería medir el reflejo, y
            #                 sumarlos a un sector duplicaría capital ya contado.
            # Se devuelven igual porque su capitalización es real.
            clasificado = sc not in _NO_RANKEABLES
            mcap = float(r["total_mcap"]) if r["total_mcap"] else 0.0
            p24  = _r(r["pond_24h"])
            p7   = _r(r["pond_7d"])
            s7   = _r(r["simple_7d"])
            pct  = round(mcap / total_mcap * 100, 2) if total_mcap > 0 else 0.0
            categorias.append({
                "supercategoria": sc,
                "market_cap":     mcap,
                "peso_pct":       pct,
                # change_* son los PONDERADOS: es la lectura principal
                "change_24h":     p24,
                "change_7d":      p7,
                "mediana_7d":     _r(r["mediana_7d"]),
                "promedio_simple_7d": s7,
                # Cuánto del movimiento viene de las coins chicas
                "dispersion":     _r(s7 - p7) if (s7 is not None and p7 is not None) else None,
                "coin_count":     r["coin_count"],
                "clasificado":    clasificado,
                # Un sector puede estar bien clasificado y aun así no tener
                # peso suficiente para que su ranking signifique algo.
                "muestra_suficiente": (
                    clasificado
                    and r["coin_count"] >= _MIN_COINS_RANKING
                    and pct >= _MIN_PESO_RANKING
                ),
                "lectura":        self._lectura_sector(p7) if clasificado
                                  else _NO_RANKEABLES[sc],
            })

        # Ranking de fuerza sobre el ponderado a 7d, desempate por 24h ponderado.
        # Los no clasificados ('otros') quedan fuera del ranking y al final de
        # la lista: rankear un cajón de sastre heterogéneo no significa nada.
        def _clave(c):
            c7  = c["change_7d"]  if c["change_7d"]  is not None else -9999
            c24 = c["change_24h"] if c["change_24h"] is not None else -9999
            return (c7, c24)

        rankeables = sorted([c for c in categorias if c["muestra_suficiente"]],
                            key=_clave, reverse=True)
        for i, c in enumerate(rankeables, start=1):
            c["fuerza_rank"] = i

        # Los que no rankean se devuelven igual, ordenados por peso: primero
        # los sectores reales pero chicos, después los no clasificables.
        resto = sorted([c for c in categorias if not c["muestra_suficiente"]],
                       key=lambda c: (c["clasificado"], c["market_cap"]),
                       reverse=True)
        for c in resto:
            c["fuerza_rank"] = None
            if c["clasificado"]:
                # Se conserva su variación, pero la lectura avisa que el
                # agregado se apoya en muy pocos activos o muy poco capital.
                c["lectura"] = "muestra_chica"

        ordenadas = rankeables + resto

        return {
            "categorias":         ordenadas,
            "total_mcap":         total_mcap,
            "sectores_rankeados": len(rankeables),
            "umbral_ranking": {
                "min_coins": _MIN_COINS_RANKING,
                "min_peso_pct": _MIN_PESO_RANKING,
            },
            "criterio": (
                f"variación 7d ponderada por capitalización (desempate 24h "
                f"ponderado). Solo rankean los sectores con al menos "
                f"{_MIN_COINS_RANKING} coins y {_MIN_PESO_RANKING}% del "
                f"mercado; el resto se devuelve sin puesto."
            ),
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
                    # Ponderados por capitalización (ver mapa)
                    "sector_change_24h": c["change_24h"],
                    "sector_change_7d":  c["change_7d"],
                    "sector_mediana_7d": c["mediana_7d"],
                    "sector_dispersion": c["dispersion"],
                    "sector_rank":       c["fuerza_rank"],
                    "clasificado":       c["clasificado"],
                    "total_sectores":    m.get("sectores_rankeados",
                                               len(m["categorias"])),
                    "lectura":           c["lectura"],
                }
        # Sin datos para esa supercategoría
        return {
            "supercategoria":    supercategoria,
            "sector_change_24h": None,
            "sector_change_7d":  None,
            "sector_mediana_7d": None,
            "sector_dispersion": None,
            "sector_rank":       None,
            "clasificado":       False,
            "total_sectores":    m.get("sectores_rankeados", 0),
            "lectura":           "sin_datos",
        }

    @capacidad(
        nombre="top_coins",
        descripcion=(
            "Las coins que encabezan el mercado según un criterio: "
            "capitalización, volumen operado en 24h, o variación de precio a "
            "24h o 7 días. Usar para preguntas del tipo 'las más grandes', "
            "'las que más subieron', 'las de más volumen'."
        ),
        entidad="mercado",
        categoria="mercado",
        costo="barato",
        devuelve=(
            "lista ordenada con posición, coin_id, símbolo, nombre, ranking "
            "global, el valor del criterio pedido y la variación a 24h"
        ),
        mide=(
            "el valor de la columna pedida (capitalización, volumen 24h, "
            "variación 24h o 7d) de cada coin, tal como está en el catálogo"
        ),
        infiere="nada — es un ordenamiento sobre un dato ya medido",
        no_sabe=(
            "por qué una coin está donde está; no hay lectura de causas. "
            "Los valores son del último sync (hasta 6 horas de antigüedad), "
            "así que en un mercado moviéndose rápido pueden estar desfasados. "
            "Encabezar un ranking no dice nada sobre el comportamiento futuro"
        ),
        fuente="tabla `coins` (sync desde CoinGecko cada 6 h)",
        metodo="ORDER BY sobre la columna del criterio, descendente",
        parametros=[
            Param("criterio", str,
                  "Qué se ordena. Por defecto capitalización.",
                  opciones=("market_cap", "volume_24h", "change_24h", "change_7d"),
                  default="market_cap"),
            Param("n", int, "Cuántas devolver (1 a 100).", default=10),
        ],
    )
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
