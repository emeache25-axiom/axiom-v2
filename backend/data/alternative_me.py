"""
Fuente de datos: Alternative.me

Responsabilidad única: traer el Fear & Greed Index.
NO clasifica, NO calcula régimen.

Provee:
  - fear_greed: índice 0-100 (0=miedo extremo, 100=codicia extrema)

Ante fallo de la API, devuelve None.
"""
import httpx

_URL = "https://api.alternative.me/fng/?limit=1"
_TIMEOUT = 10.0


async def fetch_fear_greed() -> float | None:
    """
    Trae el Fear & Greed Index actual.

    Returns:
        float entre 0 y 100, o None si falla.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_URL)
            resp.raise_for_status()
            data = resp.json()

        value = int(data["data"][0]["value"])
        return float(value)
    except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
        print(f"[alternative_me] fetch_fear_greed fallo: {exc}")
        return None


async def ping() -> bool:
    """Verifica que Alternative.me responde."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_URL)
            resp.raise_for_status()
        return True
    except httpx.HTTPError:
        return False
