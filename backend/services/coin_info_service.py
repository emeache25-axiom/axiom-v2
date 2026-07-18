"""
AXIOM v2 — Servicio de información de proyecto (CoinGecko).
════════════════════════════════════════════════════════════════════════════
Trae los datos "de proyecto" de una coin desde CoinGecko /coins/{id} y los
persiste en la tabla `coin_info`. Son datos que cambian poco (descripción,
supply, links, ATH), así que se cachean en PostgreSQL y se refrescan solo
cuando están vencidos — no se pide a CoinGecko en cada vista.

Lo consume `Coin.info_proyecto()` de la capa de dominio.
"""
from __future__ import annotations
import html
import json
import logging
import re
from datetime import datetime, timezone, timedelta

import httpx

logger = logging.getLogger(__name__)

_CG_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT = 15.0

# Cada cuánto se considera vencida la info (cambia poco → refresco espaciado)
TTL_DIAS = 7


def _limpiar_texto(s) -> str:
    """
    Deja la descripción como texto plano legible:
      - decodifica entidades HTML (&amp; → &, &quot; → ", &#39; → ')
      - quita etiquetas HTML (CoinGecko incluye <a href=...> en las descripciones)
      - normaliza espacios sobrantes
    """
    if not s:
        return ""
    txt = str(s)
    # Quitar etiquetas HTML (deja el texto interno de los enlaces)
    txt = re.sub(r"<[^>]+>", "", txt)
    # Decodificar entidades (dos pasadas: a veces vienen doblemente escapadas)
    txt = html.unescape(html.unescape(txt))
    # Normalizar espacios y saltos de línea repetidos
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip()


def _parse_dt(s):
    """ISO de CoinGecko → datetime con tz. Devuelve None si no parsea."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(str(s), "%Y-%m-%d").date()
    except Exception:
        return None


async def fetch_from_coingecko(coin_id: str) -> dict | None:
    """Pide /coins/{id} y normaliza los campos que nos interesan."""
    url = f"{_CG_BASE}/coins/{coin_id}"
    params = {
        "localization": "false", "tickers": "false", "market_data": "true",
        "community_data": "false", "developer_data": "false", "sparkline": "false",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(url, params=params)
            if r.status_code != 200:
                logger.warning("[coin_info] %s → HTTP %s", coin_id, r.status_code)
                return None
            d = r.json()
    except Exception as e:
        logger.warning("[coin_info] %s: %s", coin_id, e)
        return None

    # Descripción: preferir español; si viene vacía, usar inglés.
    # CoinGecko devuelve entidades HTML (&amp;, &quot;, &#39;...) y a veces
    # etiquetas <a>. Se decodifican y limpian para guardar texto plano.
    desc_obj = d.get("description") or {}
    desc_es = _limpiar_texto(desc_obj.get("es"))
    desc_en = _limpiar_texto(desc_obj.get("en"))
    if desc_es:
        descripcion, lang = desc_es, "es"
    else:
        descripcion, lang = desc_en, "en"

    md = d.get("market_data") or {}

    def _usd(campo):
        v = md.get(campo)
        return v.get("usd") if isinstance(v, dict) else None

    return {
        "coin_id":           coin_id,
        "descripcion":       descripcion or None,
        "descripcion_lang":  lang if descripcion else None,
        "supply_circulante": md.get("circulating_supply"),
        "supply_total":      md.get("total_supply"),
        "supply_max":        md.get("max_supply"),
        "ath":               _usd("ath"),
        "ath_date":          _parse_dt(_usd("ath_date")),
        "ath_change_pct":    _usd("ath_change_percentage"),
        "atl":               _usd("atl"),
        "atl_date":          _parse_dt(_usd("atl_date")),
        "genesis_date":      _parse_date(d.get("genesis_date")),
        "hashing_algorithm": d.get("hashing_algorithm"),
        "country_origin":    d.get("country_origin") or None,
        "categories":        [c for c in (d.get("categories") or []) if c],
        "links":             _links(d.get("links") or {}),
    }


def _links(raw: dict) -> dict:
    """Quedarse con los enlaces útiles, aplanados y sin vacíos."""
    def _first(v):
        if isinstance(v, list):
            for item in v:
                if item:
                    return item
            return None
        return v or None

    out = {
        "homepage":   _first(raw.get("homepage")),
        "whitepaper": raw.get("whitepaper") or None,
        "explorer":   _first(raw.get("blockchain_site")),
        "forum":      _first(raw.get("official_forum_url")),
        "chat":       _first(raw.get("chat_url")),
        "twitter":    (f"https://twitter.com/{raw['twitter_screen_name']}"
                       if raw.get("twitter_screen_name") else None),
        "facebook":   (f"https://facebook.com/{raw['facebook_username']}"
                       if raw.get("facebook_username") else None),
        "subreddit":  raw.get("subreddit_url") or None,
    }
    repos = (raw.get("repos_url") or {}).get("github") or []
    out["github"] = repos[0] if repos else None
    return {k: v for k, v in out.items() if v}


async def save(pool, info: dict) -> None:
    """Persiste (upsert) la info en coin_info."""
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO coin_info (
                coin_id, descripcion, descripcion_lang,
                supply_circulante, supply_total, supply_max,
                ath, ath_date, ath_change_pct, atl, atl_date,
                genesis_date, hashing_algorithm, country_origin,
                categories, links, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
            ON CONFLICT (coin_id) DO UPDATE SET
                descripcion=$2, descripcion_lang=$3,
                supply_circulante=$4, supply_total=$5, supply_max=$6,
                ath=$7, ath_date=$8, ath_change_pct=$9, atl=$10, atl_date=$11,
                genesis_date=$12, hashing_algorithm=$13, country_origin=$14,
                categories=$15, links=$16, updated_at=now()
        """,
        info["coin_id"], info["descripcion"], info["descripcion_lang"],
        info["supply_circulante"], info["supply_total"], info["supply_max"],
        info["ath"], info["ath_date"], info["ath_change_pct"],
        info["atl"], info["atl_date"],
        info["genesis_date"], info["hashing_algorithm"], info["country_origin"],
        json.dumps(info["categories"]), json.dumps(info["links"]))


async def get(pool, coin_id: str, forzar: bool = False) -> dict | None:
    """
    Devuelve la info de proyecto de la coin.
    Lee de `coin_info`; si no existe o está vencida (TTL_DIAS), la trae de
    CoinGecko y la persiste. Si CoinGecko falla pero hay copia vieja, devuelve
    la vieja (degradación elegante).
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM coin_info WHERE coin_id=$1", coin_id)

    vencida = True
    if row and row["updated_at"]:
        vencida = (datetime.now(timezone.utc) - row["updated_at"]) > timedelta(days=TTL_DIAS)

    if row and not vencida and not forzar:
        return _row_to_dict(row)

    fresco = await fetch_from_coingecko(coin_id)
    if fresco:
        try:
            await save(pool, fresco)
        except Exception as e:
            logger.warning("[coin_info] no se pudo persistir %s: %s", coin_id, e)
        # Releer para devolver el formato uniforme
        async with pool.acquire() as conn:
            row2 = await conn.fetchrow(
                "SELECT * FROM coin_info WHERE coin_id=$1", coin_id)
        if row2:
            return _row_to_dict(row2)

    # CoinGecko falló: devolver la copia vieja si la hay
    return _row_to_dict(row) if row else None


def _row_to_dict(row) -> dict:
    d = dict(row)
    for campo in ("categories", "links"):
        v = d.get(campo)
        if isinstance(v, str):
            try:
                d[campo] = json.loads(v)
            except Exception:
                d[campo] = None
    for campo in ("supply_circulante", "supply_total", "supply_max",
                  "ath", "ath_change_pct", "atl"):
        if d.get(campo) is not None:
            d[campo] = float(d[campo])
    for campo in ("ath_date", "atl_date", "updated_at"):
        if d.get(campo) is not None:
            d[campo] = d[campo].isoformat()
    if d.get("genesis_date") is not None:
        d["genesis_date"] = d["genesis_date"].isoformat()
    return d
