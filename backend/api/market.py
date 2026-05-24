"""
API del módulo Mercado — AXIOM v2.

Endpoints:
  GET /api/market/overview → datos generales del mercado
"""
from fastapi import APIRouter, HTTPException
from backend.data.coingecko import fetch_top_coins, fetch_global

router = APIRouter(prefix="/api/market", tags=["market"])

# Categorías de referencia para clasificar cryptos
_CATEGORIES = {
    "layer1":   {"label": "Layer 1",  "symbols": {"BTC","ETH","SOL","ADA","AVAX","DOT","NEAR","ATOM","APT","SUI"}},
    "layer2":   {"label": "Layer 2",  "symbols": {"MATIC","ARB","OP","IMX","STRK","ZK","MANTA"}},
    "defi":     {"label": "DeFi",     "symbols": {"UNI","AAVE","MKR","CRV","LDO","COMP","SNX","1INCH"}},
    "stables":  {"label": "Stables",  "symbols": {"USDT","USDC","DAI","BUSD","TUSD","FDUSD","PYUSD"}},
    "exchange": {"label": "Exchange", "symbols": {"BNB","OKB","CRO","KCS","HT","FTT"}},
    "other":    {"label": "Otros",    "symbols": set()},
}


def _classify_coin(symbol: str) -> str:
    symbol = symbol.upper()
    for cat_id, cat in _CATEGORIES.items():
        if symbol in cat["symbols"]:
            return cat_id
    return "other"


@router.get("/overview")
async def get_market_overview():
    """
    Devuelve:
      - top 10 por capitalización
      - top 5 ganadoras 24h
      - top 5 perdedoras 24h
      - distribución del market cap por categoría
      - datos globales del mercado
    """
    coins, global_data = await _fetch_all()

    if not coins:
        raise HTTPException(status_code=503, detail="No se pudieron obtener datos de mercado")

    # Formatear cada coin
    formatted = []
    for c in coins:
        formatted.append({
            "rank":          c.get("market_cap_rank"),
            "id":            c.get("id"),
            "symbol":        c.get("symbol", "").upper(),
            "name":          c.get("name"),
            "price":         c.get("current_price"),
            "change_24h":    round(c.get("price_change_percentage_24h") or 0, 2),
            "market_cap":    c.get("market_cap"),
            "volume_24h":    c.get("total_volume"),
            "image":         c.get("image"),
            "category":      _classify_coin(c.get("symbol", "")),
        })

    # Top 10 por capitalización (ya vienen ordenadas)
    top10 = formatted[:10]

    # Top 5 ganadoras y perdedoras
    with_change = [c for c in formatted if c["change_24h"] is not None]
    gainers = sorted(with_change, key=lambda x: x["change_24h"], reverse=True)[:5]
    losers  = sorted(with_change, key=lambda x: x["change_24h"])[:5]

    # Distribución por categoría
    category_mcap = {}
    total_mcap = sum(c["market_cap"] or 0 for c in formatted)

    for c in formatted:
        cat = c["category"]
        if cat not in category_mcap:
            category_mcap[cat] = 0
        category_mcap[cat] += c["market_cap"] or 0

    categories = []
    for cat_id, data in _CATEGORIES.items():
        mcap = category_mcap.get(cat_id, 0)
        pct  = round(mcap / total_mcap * 100, 1) if total_mcap > 0 else 0
        if pct > 0:
            categories.append({
                "id":       cat_id,
                "label":    data["label"],
                "mcap":     mcap,
                "pct":      pct,
            })
    categories.sort(key=lambda x: x["mcap"], reverse=True)

    return {
        "top10":      top10,
        "gainers":    gainers,
        "losers":     losers,
        "categories": categories,
        "global": {
            "btc_dominance":  round(global_data.get("btc_dominance", 0), 2)  if global_data else None,
            "vol_mcap_ratio": round(global_data.get("vol_mcap_ratio", 0), 2) if global_data else None,
        } if global_data else None,
    }


async def _fetch_all():
    """Fetch en paralelo de coins y datos globales."""
    import asyncio
    return await asyncio.gather(
        fetch_top_coins(50),
        fetch_global(),
        return_exceptions=False,
    )
