"""
Fuente de datos: CoinGecko (API pública).
Responsabilidad única: traer datos crudos del mercado.
NO clasifica, NO calcula régimen.
"""
import httpx

_BASE    = "https://api.coingecko.com/api/v3"
_TIMEOUT = 15.0


async def fetch_global() -> dict | None:
    """Datos globales del mercado: dominancia BTC, vol/mcap ratio."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/global")
            resp.raise_for_status()
            data = resp.json().get("data", {})
        btc_dom      = data.get("market_cap_percentage", {}).get("btc", 0)
        total_mcap   = data.get("total_market_cap", {}).get("usd", 0)
        total_vol    = data.get("total_volume", {}).get("usd", 0)
        vol_mcap     = (total_vol / total_mcap * 100) if total_mcap > 0 else 0
        return {"btc_dominance": btc_dom, "vol_mcap_ratio": vol_mcap}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        print(f"[coingecko] fetch_global fallo: {exc}")
        return None


async def fetch_btc_vs_ath() -> float | None:
    """Distancia del precio actual de BTC a su ATH (en %)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/coins/bitcoin",
                params={"localization":"false","tickers":"false",
                        "market_data":"true","community_data":"false",
                        "developer_data":"false"}
            )
            resp.raise_for_status()
            data = resp.json()
        price = data["market_data"]["current_price"]["usd"]
        ath   = data["market_data"]["ath"]["usd"]
        return (price - ath) / ath * 100 if ath else None
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        print(f"[coingecko] fetch_btc_vs_ath fallo: {exc}")
        return None


async def fetch_top_coins(limit: int = 50) -> list[dict] | None:
    """Top N cryptos por market cap."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/coins/markets",
                params={
                    "vs_currency":             "usd",
                    "order":                   "market_cap_desc",
                    "per_page":                limit,
                    "page":                    1,
                    "price_change_percentage": "24h",
                    "sparkline":               "false",
                },
            )
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        print(f"[coingecko] fetch_top_coins fallo: {exc}")
        return None


_categories_cache: list | None = None
_categories_cache_time: float = 0
_CATEGORIES_TTL = 1800  # 30 minutos


async def fetch_categories() -> list[dict] | None:
    """
    Todas las categorías de CoinGecko con market cap activo.
    Devuelve lista ordenada por market cap DESC.
    Cache en memoria de 30 minutos.
    """
    import time
    global _categories_cache, _categories_cache_time

    now = time.time()
    if _categories_cache and (now - _categories_cache_time) < _CATEGORIES_TTL:
        return _categories_cache

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/coins/categories")
            resp.raise_for_status()
            cats = resp.json()
        active = [c for c in cats if c.get("market_cap") and c["market_cap"] > 0]
        active.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
        _categories_cache      = active
        _categories_cache_time = now
        return active
    except (httpx.HTTPError, ValueError) as exc:
        print(f"[coingecko] fetch_categories fallo: {exc}")
        return _categories_cache or None  # devolver cache viejo si hay


async def fetch_coins_page(page: int = 1, per_page: int = 25) -> list[dict] | None:
    """
    Trae una página de cryptos ordenadas por market cap.
    Incluye cambio 7d además del 24h.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/coins/markets",
                params={
                    "vs_currency":             "usd",
                    "order":                   "market_cap_desc",
                    "per_page":                per_page,
                    "page":                    page,
                    "price_change_percentage": "24h,7d",
                    "sparkline":               "true",
                },
            )
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        print(f"[coingecko] fetch_coins_page fallo: {exc}")
        return None
