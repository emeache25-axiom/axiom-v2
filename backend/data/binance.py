"""
Fuente de datos: Binance.

Responsabilidad única: traer datos crudos de Binance.
NO clasifica, NO calcula medias, NO sabe qué es un régimen.

Provee:
  - funding rate de BTC (Binance Futures)
  - velas OHLCV (Binance Spot)

Ante fallo de la API, las funciones devuelven None. Una señal sin dato
no debe tumbar el snapshot completo.
"""
import httpx

# Endpoints públicos de Binance (no requieren API key)
_SPOT_BASE = "https://api.binance.com"
_FUTURES_BASE = "https://fapi.binance.com"

# Timeout por request — si Binance no responde en este tiempo, se aborta
_TIMEOUT = 10.0


async def fetch_funding_btc() -> float | None:
    """
    Trae el funding rate actual de BTCUSDT perpetuo.

    Returns:
        El funding rate como float (ej: 0.0034 = 0.0034%), o None si falla.
    """
    url = f"{_FUTURES_BASE}/fapi/v1/premiumIndex"
    params = {"symbol": "BTCUSDT"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        # El campo lastFundingRate viene como string, ej: "0.00010000"
        return float(data["lastFundingRate"])
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        print(f"[binance] fetch_funding_btc fallo: {exc}")
        return None


async def fetch_candles(timeframe: str, limit: int = 250) -> list[dict] | None:
    """
    Trae velas OHLCV de BTCUSDT desde Binance Spot.

    Args:
        timeframe: intervalo de vela. Ej: "1d" (diario), "4h".
        limit: cantidad de velas a traer (max 1000). Default 250,
               suficiente para una MA200.

    Returns:
        Lista de velas, cada una un dict con:
          open_time, open, high, low, close, volume
        O None si falla.
    """
    url = f"{_SPOT_BASE}/api/v3/klines"
    params = {"symbol": "BTCUSDT", "interval": timeframe, "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            raw = resp.json()
    except httpx.HTTPError as exc:
        print(f"[binance] fetch_candles({timeframe}) fallo: {exc}")
        return None

    # Binance devuelve cada vela como una lista posicional:
    # [open_time, open, high, low, close, volume, close_time, ...]
    candles = []
    for row in raw:
        candles.append({
            "open_time": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        })
    return candles


async def ping() -> bool:
    """Verifica que Binance Spot responde. Para health checks."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_SPOT_BASE}/api/v3/ping")
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
