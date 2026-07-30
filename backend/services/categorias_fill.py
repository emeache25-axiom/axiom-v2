"""
AXIOM — Relleno de categorías faltantes.
════════════════════════════════════════════════════════════════════════════
El sync semanal (`coins_sync.sync_categories`) obtiene las categorías haciendo
SCRAPING de la página HTML de cada coin en coingecko.com, buscando enlaces a
/en/categories/. Ese método es frágil: para 234 coins no encontró ninguna
categoría, y quedaron sin supercategoría.

Verificado el 28/07/2026: esas coins SÍ están categorizadas en CoinGecko — la
API `/coins/{id}` las devuelve. Ejemplos reales:
    GROK  → ['BNB Chain Ecosystem', 'Meme', 'Elon Musk-Inspired']
    FGRS  → ['Tokenized Assets', 'Real World Assets (RWA)', ...]
    ANTFUN→ ['SocialFi', 'BNB Chain Ecosystem', 'Wallets', 'Trading Bots']

Es decir: el dato existe, el método para obtenerlo falla.

Este job no reemplaza al scraping — lo COMPLEMENTA, rellenando solo lo que
quedó vacío. Es barato porque opera sobre el faltante, no sobre el catálogo
entero (234 llamadas ≈ 8 min, contra 2.400 ≈ 80 min).

Por qué importa: esas 234 coins suman unos 3.345 millones de capitalización que
hoy no se atribuye a ningún sector, y aparecen en el mapa como 'otros', que no
es un sector sino ausencia de clasificación.

Distinción de estados en `cg_cats`:
    NULL  → nunca se procesó (candidata a relleno)
    '[]'  → se procesó y CoinGecko no le asigna categorías (no reintentar)
    [...] → tiene categorías
"""
from __future__ import annotations
import asyncio
import json
import logging

import httpx

# Se reutiliza el mapeo categoría→supercategoría que ya existe: una sola fuente
# de verdad para la clasificación, sin duplicar reglas.
from backend.services.coins_sync import _assign_supercat, _HEADERS

logger = logging.getLogger(__name__)

_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT = 20.0

# CoinGecko gratuito permite ~30 req/min. 2.2 s deja margen para no chocar.
_DELAY = 2.2
_MAX_POR_CORRIDA = 300     # tope por ejecución, para que el job no se eternice


async def _categorias_de(client: httpx.AsyncClient, coin_id: str):
    """
    Categorías de una coin según la API.

    Devuelve:
        list  — las categorías (vacía si CoinGecko no le asigna ninguna)
        None  — la llamada falló por algo temporal (red, rate limit): reintentar
        "404" — CoinGecko no conoce ese id: NO reintentar nunca más

    La distinción importa: sin ella, las coins que CoinGecko eliminó de su
    catálogo se reintentan todas las noches para siempre. Verificado el
    29/07/2026: cinco coins de la tabla daban 404 y llevaban semanas sin
    actualizarse — CoinGecko las deslistó, pero seguían en `coins` porque el
    sync hace upsert de lo que llega y nunca limpia lo que desaparece.
    """
    url = f"{_BASE}/coins/{coin_id}"
    params = {
        "localization": "false", "tickers": "false", "market_data": "false",
        "community_data": "false", "developer_data": "false", "sparkline": "false",
    }
    try:
        r = await client.get(url, params=params)
        if r.status_code == 404:
            return "404"
        if r.status_code == 429:
            logger.warning("[categorias] rate limit en %s — esperando 60 s", coin_id)
            await asyncio.sleep(60)
            return None
        if r.status_code != 200:
            return None
        return r.json().get("categories") or []
    except Exception as e:
        logger.debug("[categorias] %s falló: %s", coin_id, e)
        return None


async def completar_categorias(pool, limite: int = _MAX_POR_CORRIDA) -> dict:
    """
    Rellena categorías y supercategoría de las coins que el scraping no cubrió.

    Solo toca las que tienen `cg_cats` NULL (nunca procesadas). Las que quedaron
    en '[]' ya se consultaron y CoinGecko no les asigna categoría: reintentarlas
    sería gastar llamadas sin resultado.
    """
    async with pool.acquire() as conn:
        pendientes = await conn.fetch("""
            SELECT id, symbol, market_cap
            FROM coins
            WHERE cg_cats IS NULL
            ORDER BY market_cap DESC NULLS LAST
            LIMIT $1
        """, limite)

    if not pendientes:
        logger.info("[categorias] no hay coins pendientes de categorizar")
        return {"pendientes": 0, "clasificadas": 0, "sin_categorias": 0, "errores": 0}

    logger.info("[categorias] rellenando %s coins (las de mayor capitalización primero)",
                len(pendientes))

    clasificadas = sin_cats = errores = deslistadas = 0
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
        for row in pendientes:
            cats = await _categorias_de(client, row["id"])

            if cats == "404":
                # CoinGecko no conoce este id. Se marca para no reintentarla
                # cada noche; queda en 'otros' con la marca `_deslistada` en
                # cg_cats, que la distingue de una coin sin categorías.
                async with pool.acquire() as conn:
                    await conn.execute(
                        """UPDATE coins
                           SET cg_cats = '["_deslistada"]'::jsonb,
                               supercat = 'otros', updated_at = now()
                           WHERE id = $1""",
                        row["id"])
                deslistadas += 1
                logger.info("[categorias] %s (%s) no existe en CoinGecko — marcada",
                            row["symbol"], row["id"])
                await asyncio.sleep(_DELAY)
                continue

            if cats is None:            # falló por algo temporal: se reintenta
                errores += 1
                await asyncio.sleep(_DELAY)
                continue

            supercat = _assign_supercat(cats)
            async with pool.acquire() as conn:
                await conn.execute("""
                    UPDATE coins
                    SET cg_cats = $1, supercat = $2, updated_at = now()
                    WHERE id = $3
                """, json.dumps(cats), supercat, row["id"])

            if cats and supercat != "otros":
                clasificadas += 1
            else:
                # Guardamos '[]' o las categorías que no mapean: quedan marcadas
                # como procesadas y no se reintentan.
                sin_cats += 1

            await asyncio.sleep(_DELAY)

    logger.info(
        "[categorias] completado: %s clasificadas, %s sin categoría mapeable, "
        "%s deslistadas, %s errores",
        clasificadas, sin_cats, deslistadas, errores)
    return {
        "pendientes": len(pendientes),
        "clasificadas": clasificadas,
        "sin_categorias": sin_cats,
        "deslistadas": deslistadas,
        "errores": errores,
    }


async def reclasificar(pool) -> dict:
    """
    Recalcula `supercat` de TODAS las coins que ya tienen categorías guardadas,
    aplicando el mapeo vigente. No llama a ninguna API: usa `cg_cats` de la base.

    Es lo que hay que correr después de tocar `_CAT_MAP` o `_PRIORITY` en
    coins_sync. Cambiar el mapeo no debería costar volver a descargar 2.400
    fichas — las categorías ya están, lo único que cambió es cómo se traducen.

    Devuelve cuántas cambiaron de supercategoría y el detalle de los cambios,
    que sirve para verificar que el mapeo nuevo hace lo que se espera.
    """
    async with pool.acquire() as conn:
        filas = await conn.fetch("""
            SELECT id, symbol, cg_cats, supercat
            FROM coins
            WHERE cg_cats IS NOT NULL
              AND jsonb_array_length(cg_cats) > 0
        """)

    cambios, updates = [], []
    for r in filas:
        cats = r["cg_cats"]
        if isinstance(cats, str):
            cats = json.loads(cats)
        if not isinstance(cats, list):
            continue
        # Las marcadas como deslistadas no se reclasifican
        if "_deslistada" in cats:
            continue

        nueva = _assign_supercat(cats)
        if nueva != r["supercat"]:
            cambios.append({
                "symbol": r["symbol"],
                "de": r["supercat"] or "(null)",
                "a": nueva,
            })
            updates.append((r["id"], nueva))

    if updates:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(
                    "UPDATE coins SET supercat=$2, updated_at=now() WHERE id=$1",
                    updates)

    logger.info("[categorias] reclasificadas %s de %s coins", len(updates), len(filas))
    return {
        "evaluadas": len(filas),
        "cambiadas": len(updates),
        "cambios": cambios[:50],       # muestra, para verificar
    }


async def estado(pool) -> dict:
    """Cuántas coins están sin clasificar y cuánta capitalización representan."""
    async with pool.acquire() as conn:
        return dict(await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE cg_cats IS NULL)              AS nunca_procesadas,
                COUNT(*) FILTER (WHERE cg_cats = '[]'::jsonb)        AS sin_categorias_cg,
                COUNT(*) FILTER (
                    WHERE cg_cats @> '["_deslistada"]'::jsonb)       AS deslistadas,
                COUNT(*) FILTER (WHERE supercat IS NULL
                                    OR supercat = 'otros')           AS sin_supercat,
                COALESCE(SUM(market_cap) FILTER (
                    WHERE supercat IS NULL OR supercat = 'otros'), 0)::bigint
                                                                     AS mcap_sin_clasificar,
                COUNT(*)                                             AS total
            FROM coins
        """))
