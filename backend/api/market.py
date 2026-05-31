"""
API del módulo Mercado — AXIOM v2.
Lee desde PostgreSQL (tabla coins). Sin dependencia de CoinGecko en tiempo real.
"""
import json
import asyncio
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/market", tags=["market"])

# ── Definición de supercategorías ────────────────────────────────────────────
_SUPERCATS = {
    "bitcoin":         {"label": "Bitcoin",               "color": "#F7931A", "info": "El activo fundacional del ecosistema cripto. Incluye Bitcoin, sus forks, sidechains y protocolos construidos sobre Bitcoin como BRC-20 y BTCfi."},
    "smart_platforms": {"label": "Smart Platforms",       "color": "#627EEA", "info": "Blockchains de capa 1 con capacidad de contratos inteligentes. Son la infraestructura base sobre la que se construyen aplicaciones descentralizadas."},
    "layer2":          {"label": "Layer 2",               "color": "#8A2BE2", "info": "Soluciones de escalabilidad construidas sobre blockchains de capa 1. Aumentan la velocidad y reducen costos manteniendo la seguridad de la capa base."},
    "stablecoins":     {"label": "Stablecoins",           "color": "#26A17B", "info": "Activos diseñados para mantener un valor estable, generalmente anclados al dólar u otras monedas fiat."},
    "defi":            {"label": "DeFi",                  "color": "#56A14F", "info": "Finanzas descentralizadas. Protocolos que replican servicios financieros tradicionales sin intermediarios centralizados."},
    "rwa":             {"label": "RWA",                   "color": "#C9A84C", "info": "Real World Assets. Tokenización de activos del mundo real: bonos, acciones, oro, inmuebles."},
    "exchange":        {"label": "Exchange Tokens",       "color": "#F0B90B", "info": "Tokens nativos de exchanges centralizados. Ofrecen descuentos en comisiones y acceso a launchpads."},
    "ai":              {"label": "Inteligencia Artificial","color": "#00D4FF", "info": "Proyectos que combinan blockchain con inteligencia artificial. Incluye agentes de IA e infraestructura de computación descentralizada."},
    "memes":           {"label": "Memes",                 "color": "#FF6B6B", "info": "Tokens impulsados por comunidad y narrativas virales. Indicadores importantes del sentimiento retail."},
    "gaming":          {"label": "Gaming & NFT",          "color": "#FF4081", "info": "Videojuegos blockchain, metaversos y NFTs. Incluye play-to-earn y economías virtuales descentralizadas."},
    "privacy":         {"label": "Privacidad",            "color": "#9E9E9E", "info": "Proyectos centrados en la privacidad de transacciones e identidad digital."},
    "infrastructure":  {"label": "Infraestructura",       "color": "#78716C", "info": "La capa técnica del ecosistema: oráculos, bridges, almacenamiento descentralizado e identidad digital."},
    "desoc":           {"label": "DeSoc & Web3",          "color": "#E91E63", "info": "Aplicaciones sociales descentralizadas. Redes sociales Web3, entretenimiento, deportes y música."},
    "staking":         {"label": "Staking & Liquid",      "color": "#2563EB", "info": "Protocolos de staking líquido y restaking. Permiten generar rendimiento manteniendo liquidez."},
    "launchpads":      {"label": "Launchpads",            "color": "#FF9800", "info": "Plataformas de lanzamiento de nuevos proyectos cripto."},
    "sec_securities":  {"label": "Alleged SEC Securities","color": "#D93B3B", "info": "Activos que la SEC considera valores no registrados. Alto riesgo regulatorio."},
    "political":       {"label": "Narrativas Políticas",  "color": "#B47514", "info": "Tokens vinculados a movimientos políticos, figuras públicas o narrativas geopolíticas."},
    "payments":        {"label": "Pagos",                 "color": "#00BCD4", "info": "Protocolos diseñados para facilitar pagos y transferencias de valor."},
    "otros":           {"label": "Otros",                 "color": "#4A4540", "info": "Categorías de nicho o emergentes que no encajan en las supercategorías principales."},
}

# Redes para la vista de redes
_NETWORKS = {
    "ethereum":  {"label": "Ethereum + L2s", "color": "#627EEA", "keywords": ["ethereum", "Ethereum Ecosystem", "Base Ecosystem", "Arbitrum Ecosystem", "Optimism Ecosystem", "Polygon Ecosystem"], "info": "El ecosistema más grande de smart contracts. Incluye la red principal y sus L2 como Base, Arbitrum y Optimism."},
    "solana":    {"label": "Solana",          "color": "#9945FF", "keywords": ["Solana Ecosystem"], "info": "Blockchain de alta velocidad y bajo costo. Fuerte en DeFi, NFTs y memes."},
    "bnb":       {"label": "BNB Chain",       "color": "#F0B90B", "keywords": ["BNB Chain Ecosystem"], "info": "La blockchain de Binance. Fuerte en DeFi y launchpads."},
    "tron":      {"label": "TRON",            "color": "#FF0013", "keywords": ["Tron Ecosystem"], "info": "Red enfocada en transferencias de valor y stablecoins."},
    "ton":       {"label": "TON",             "color": "#0088CC", "keywords": ["TON Ecosystem"], "info": "The Open Network, blockchain de Telegram."},
    "sui":       {"label": "Sui",             "color": "#6FBCF0", "keywords": ["Sui Ecosystem"], "info": "Blockchain de alto rendimiento con lenguaje Move."},
    "aptos":     {"label": "Aptos",           "color": "#2DD8A3", "keywords": ["Aptos Ecosystem"], "info": "Blockchain fundada por ex-equipo de Diem. Alto rendimiento con Move."},
    "cosmos":    {"label": "Cosmos",          "color": "#2E3148", "keywords": ["Cosmos Ecosystem"], "info": "El internet de blockchains. Ecosistema de chains interoperables via IBC."},
    "avalanche": {"label": "Avalanche",       "color": "#E84142", "keywords": ["Avalanche Ecosystem"], "info": "Blockchain con arquitectura de subnets. Permite crear blockchains personalizadas."},
}


def _fmt_coin(r) -> dict:
    sp = None
    if r["sparkline"]:
        try:
            sp = json.loads(r["sparkline"]) if isinstance(r["sparkline"], str) else r["sparkline"]
        except Exception:
            sp = None
    return {
        "rank":       r["rank"],
        "id":         r["id"],
        "symbol":     r["symbol"],
        "name":       r["name"],
        "price":      float(r["price"]) if r["price"] else None,
        "change_24h": float(r["change_24h"]) if r["change_24h"] else None,
        "change_7d":  float(r["change_7d"]) if r["change_7d"] else None,
        "market_cap": float(r["market_cap"]) if r["market_cap"] else None,
        "volume_24h": float(r["volume_24h"]) if r["volume_24h"] else None,
        "image":      r["image"],
        "sparkline":  sp or [],
        "supercat":   r["supercat"],
    }


@router.get("/overview")
async def get_market_overview(request: Request, min_mcap: int = 100000000):
    """Top 5 ganadoras, top 5 perdedoras — desde PostgreSQL."""
    async with request.app.state.db_pool.acquire() as conn:
        if min_mcap > 0:
            gainers = await conn.fetch("""
                SELECT * FROM coins
                WHERE change_24h IS NOT NULL
                  AND rank IS NOT NULL
                  AND market_cap > $1
                ORDER BY change_24h DESC NULLS LAST
                LIMIT 5
            """, float(min_mcap))
            losers = await conn.fetch("""
                SELECT * FROM coins
                WHERE change_24h IS NOT NULL
                  AND rank IS NOT NULL
                  AND market_cap > $1
                ORDER BY change_24h ASC NULLS LAST
                LIMIT 5
            """, float(min_mcap))
        else:
            gainers = await conn.fetch("""
                SELECT * FROM coins
                WHERE change_24h IS NOT NULL AND rank IS NOT NULL
                ORDER BY change_24h DESC NULLS LAST
                LIMIT 5
            """)
            losers = await conn.fetch("""
                SELECT * FROM coins
                WHERE change_24h IS NOT NULL AND rank IS NOT NULL
                ORDER BY change_24h ASC NULLS LAST
                LIMIT 5
            """)
    return {
        "gainers":  [_fmt_coin(r) for r in gainers],
        "losers":   [_fmt_coin(r) for r in losers],
        "min_mcap": min_mcap,
    }


@router.get("/coins")
async def get_coins(request: Request, page: int = 1, per_page: int = 25):
    """Lista paginada de coins por market cap — desde PostgreSQL."""
    per_page = max(10, min(50, per_page))
    page     = max(1, page)
    offset   = (page - 1) * per_page

    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM coins
            WHERE rank IS NOT NULL
            ORDER BY rank ASC
            LIMIT $1 OFFSET $2
        """, per_page, offset)

    return {
        "coins":    [_fmt_coin(r) for r in rows],
        "page":     page,
        "per_page": per_page,
    }


@router.get("/categories")
async def get_market_categories(request: Request):
    """Distribución del mercado por supercategorías — desde PostgreSQL."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                supercat,
                SUM(market_cap)                                    AS total_mcap,
                AVG(change_24h)                                    AS avg_change,
                COUNT(*)                                           AS coin_count
            FROM coins
            WHERE market_cap IS NOT NULL AND market_cap > 0
            GROUP BY supercat
            ORDER BY total_mcap DESC
        """)

    total_mcap = sum(float(r["total_mcap"]) for r in rows if r["total_mcap"])

    result = []
    for r in rows:
        sc_id   = r["supercat"] or "otros"
        sc_data = _SUPERCATS.get(sc_id, _SUPERCATS["otros"])
        mcap    = float(r["total_mcap"]) if r["total_mcap"] else 0
        pct     = round(mcap / total_mcap * 100, 2) if total_mcap > 0 else 0
        result.append({
            "id":         sc_id,
            "label":      sc_data["label"],
            "color":      sc_data["color"],
            "info":       sc_data["info"],
            "mcap":       mcap,
            "pct":        pct,
            "change_24h": round(float(r["avg_change"]), 2) if r["avg_change"] else 0,
            "coin_count": r["coin_count"],
        })

    return {"categories": result, "total_mcap": total_mcap}


@router.get("/categories/{supercat_id}/coins")
async def get_supercat_coins(request: Request, supercat_id: str, limit: int = 10):
    """Top N coins de una supercategoría — desde PostgreSQL."""
    if supercat_id not in _SUPERCATS:
        raise HTTPException(status_code=404, detail="Supercategoría no encontrada")

    limit = max(5, min(50, limit))

    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM coins
            WHERE supercat = $1
              AND market_cap IS NOT NULL
            ORDER BY market_cap DESC NULLS LAST
            LIMIT $2
        """, supercat_id, limit)

    return {
        "supercat": _SUPERCATS[supercat_id],
        "coins":    [_fmt_coin(r) for r in rows],
        "limit":    limit,
    }


@router.get("/networks")
async def get_market_networks(request: Request):
    """Distribución por blockchain — desde PostgreSQL usando cg_cats."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, market_cap, cg_cats
            FROM coins
            WHERE market_cap IS NOT NULL
              AND market_cap > 0
              AND cg_cats IS NOT NULL
        """)

    network_mcap = {k: 0.0 for k in _NETWORKS}

    for r in rows:
        try:
            cats = json.loads(r["cg_cats"]) if isinstance(r["cg_cats"], str) else r["cg_cats"]
        except Exception:
            continue
        mcap = float(r["market_cap"]) if r["market_cap"] else 0
        for net_id, net_data in _NETWORKS.items():
            if any(kw in cats for kw in net_data["keywords"]):
                network_mcap[net_id] += mcap
                break

    total = sum(network_mcap.values())
    result = []
    for net_id, mcap in network_mcap.items():
        if mcap == 0:
            continue
        result.append({
            "id":    net_id,
            "label": _NETWORKS[net_id]["label"],
            "color": _NETWORKS[net_id]["color"],
            "info":  _NETWORKS[net_id]["info"],
            "mcap":  mcap,
            "pct":   round(mcap / total * 100, 2) if total > 0 else 0,
        })

    result.sort(key=lambda x: x["mcap"], reverse=True)
    return {"networks": result, "total_mcap": total}
