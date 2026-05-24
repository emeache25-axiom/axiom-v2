"""
Fuente de datos: CoinGecko.

Responsabilidad única: traer datos crudos de CoinGecko.
NO clasifica, NO calcula régimen.

Provee 3 señales núcleo:
  - btc_dominance   : % del market cap total que es BTC
  - vol_mcap_ratio  : ratio volumen / market cap del mercado (en %)
  - btc_vs_ath      : % de distancia del precio de BTC respecto a su ATH

Ante fallo de la API, las funciones devuelven None.
"""
import httpx

_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT = 15.0


async def fetch_global() -> dict | None:
    """
    Trae datos globales del mercado: dominancia BTC y ratio volumen/mcap.

    Returns:
        dict con:
          btc_dominance   -> float, ej: 58.3
          vol_mcap_ratio  -> float, ej: 2.78  (volumen/mcap * 100)
        O None si falla.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/global")
            resp.raise_for_status()
            data = resp.json().get("data", {})

        btc_dom = data["market_cap_percentage"]["btc"]
        total_mcap = data["total_market_cap"]["usd"]
        total_vol = data["total_volume"]["usd"]

        if total_mcap <= 0:
            return None
        vol_mcap_ratio = (total_vol / total_mcap) * 100

        return {
            "btc_dominance": float(btc_dom),
            "vol_mcap_ratio": float(vol_mcap_ratio),
        }
    except (httpx.HTTPError, KeyError, ValueError, ZeroDivisionError) as exc:
        print(f"[coingecko] fetch_global fallo: {exc}")
        return None


async def fetch_btc_vs_ath() -> float | None:
    """
    Trae el % de distancia del precio de BTC respecto a su ATH.

    Returns:
        float negativo o cero, ej: -39.1 (BTC está 39.1% por debajo del ATH).
        O None si falla.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/coins/bitcoin",
                params={
                    "localization": "false",
                    "tickers": "false",
                    "market_data": "true",
                    "community_data": "false",
                    "developer_data": "false",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        # ath_change_percentage ya es el % de distancia al ATH, calculado por CoinGecko
        pct = data["market_data"]["ath_change_percentage"]["usd"]
        return float(pct)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        print(f"[coingecko] fetch_btc_vs_ath fallo: {exc}")
        return None


async def ping() -> bool:
    """Verifica que CoinGecko responde. Para health checks."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_BASE}/ping")
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
