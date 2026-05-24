"""
Fuente de datos: CoinMarketCap (endpoints públicos del sitio web).

Responsabilidad única: traer datos crudos de los indicadores de ciclo.
NO clasifica, NO calcula régimen.

Provee señales núcleo:
  - mvrv_zscore : MVRV Z-Score
  - nupl        : Net Unrealized P&L (en %, ej: 29.5)
  - lth_supply  : Long-Term Holder Supply (en millones de BTC)

Y señales de contexto (se muestran, no votan):
  - mvrv_ratio, puell_multiple, reserve_risk, rhodl_ratio,
    mayer_multiple, cbbi, pi_cycle y más.

Ante fallo de la API, las funciones devuelven None.

Nota técnica: estos endpoints son los que usa el sitio web de CMC
internamente. No requieren API key pero sí headers que simulen un
browser. Sin ellos, CMC rechaza la request.
"""
import httpx

_BASE = "https://api.coinmarketcap.com/data-api/v3"
_TIMEOUT = 15.0

# Headers que simulan el browser del sitio web de CMC
_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "accept":        "application/json, text/plain, */*",
    "referer":       "https://coinmarketcap.com/",
    "platform":      "web",
    "cache-control": "no-cache",
}

# Mapeo: nombre CMC → clave interna de AXIOM v2
_INDICATOR_MAP = {
    "MVRV Z-Score":                         "mvrv_zscore",
    "Bitcoin MVRV Ratio":                   "mvrv_ratio",
    "Bitcoin Net Unrealized P&L (NUPL)":    "nupl",
    "Puell Multiple":                       "puell_multiple",
    "Bitcoin Reserve Risk":                 "reserve_risk",
    "Bitcoin RHODL Ratio":                  "rhodl_ratio",
    "Mayer Multiple":                       "mayer_multiple",
    "Bitcoin Long Term Holder Supply":      "lth_supply",
    "Bitcoin Short Term Holder Supply (%)": "sth_supply_pct",
    "Crypto Bitcoin Bull Run Index (CBBI)": "cbbi",
}


def _parse_value(raw: str | None) -> float | None:
    """
    Convierte string de valor CMC a float.
    CMC devuelve los valores como strings con sufijos:
      "0.76"    → 0.76
      "29.5%"   → 29.5  (el % se stripea, el valor ya está en %)
      "16.21M"  → 16.21 (M de millones se stripea, queda el número)
    """
    if raw is None:
        return None
    try:
        cleaned = str(raw).replace("%", "").replace("M", "").replace(",", "").strip()
        return float(cleaned)
    except (ValueError, AttributeError):
        return None


async def fetch_cycle_indicators() -> dict | None:
    """
    Trae todos los indicadores de ciclo de mercado desde CMC.

    Returns:
        dict con todas las señales disponibles, keyed por clave interna:
          {
            "mvrv_zscore":    float | None,
            "nupl":           float | None,
            "lth_supply":     float | None,
            "mvrv_ratio":     float | None,
            "puell_multiple": float | None,
            "reserve_risk":   float | None,
            "rhodl_ratio":    float | None,
            "mayer_multiple": float | None,
            "cbbi":           float | None,
            "sth_supply_pct": float | None,
          }
        O None si la request falla completamente.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(
                f"{_BASE}/market-cycles/indicators",
                params={"convertId": 2781, "sortBy": "index", "sortType": "asc"},
            )
            resp.raise_for_status()
            indicators = resp.json()["data"]["indicators"]
    except (httpx.HTTPError, KeyError) as exc:
        print(f"[coinmarketcap] fetch_cycle_indicators fallo: {exc}")
        return None

    result = {}
    for ind in indicators:
        name = ind.get("indicatorName")
        key = _INDICATOR_MAP.get(name)
        if key:
            result[key] = _parse_value(ind.get("currentValue"))

    return result if result else None


async def fetch_pi_cycle() -> dict | None:
    """
    Trae el estado actual del Pi Cycle Top indicator.

    Returns:
        dict con:
          ma111    -> float, valor de la MA111
          ma350x2  -> float, valor de la MA350 × 2
          active   -> bool, True = señal de techo activa
        O None si falla.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(
                f"{_BASE}/market-cycles/latest",
                params={"convertId": 2781},
            )
            resp.raise_for_status()
            data = resp.json()["data"]

        pi = data["piCycleTop"]
        ma111 = float(pi["ma110"])
        ma350x2 = float(pi["ma350mu2"])
        return {
            "ma111":   ma111,
            "ma350x2": ma350x2,
            "active":  ma111 >= ma350x2,
        }
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        print(f"[coinmarketcap] fetch_pi_cycle fallo: {exc}")
        return None
