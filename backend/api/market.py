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

# Mapa detallado de redes
_NETWORKS = {
    # Ethereum mainnet
    "ethereum":   {"label": "Ethereum",    "color": "#627EEA", "group": "ethereum_l2",
                   "keywords": ["Ethereum Ecosystem", "EthereumPoW Ecosystem"],
                   "info": "La blockchain de smart contracts más grande. Base de DeFi, NFTs y la mayoría de tokens ERC-20."},
    # L2s de Ethereum
    "base":       {"label": "Base",        "color": "#0052FF", "group": "ethereum_l2",
                   "keywords": ["Base Ecosystem"],
                   "info": "L2 de Coinbase sobre Ethereum. Fuerte crecimiento en memes y aplicaciones consumer."},
    "arbitrum":   {"label": "Arbitrum",    "color": "#28A0F0", "group": "ethereum_l2",
                   "keywords": ["Arbitrum Ecosystem", "Arbitrum Nova Ecosystem"],
                   "info": "L2 líder en DeFi. Optimistic rollup con el mayor TVL entre las L2s de Ethereum."},
    "optimism":   {"label": "Optimism",    "color": "#FF0420", "group": "ethereum_l2",
                   "keywords": ["Optimism Ecosystem", "Optimism Superchain Ecosystem"],
                   "info": "L2 de Ethereum con arquitectura Superchain. Incluye OP Mainnet y chains del Superchain."},
    "polygon":    {"label": "Polygon",     "color": "#8247E5", "group": "ethereum_l2",
                   "keywords": ["Polygon Ecosystem", "Polygon zkEVM Ecosystem"],
                   "info": "Sidechain y zkEVM de Ethereum. Alta adopción en gaming y aplicaciones consumer."},
    "zksync":     {"label": "zkSync",      "color": "#4E529A", "group": "ethereum_l2",
                   "keywords": ["ZkSync Ecosystem"],
                   "info": "zkRollup de Ethereum. Alta seguridad con pruebas de conocimiento cero."},
    "starknet":   {"label": "Starknet",    "color": "#EC796B", "group": "ethereum_l2",
                   "keywords": ["Starknet Ecosystem"],
                   "info": "zkRollup con lenguaje Cairo. Enfocado en aplicaciones de alta seguridad."},
    "blast":      {"label": "Blast",       "color": "#FCFC03", "group": "ethereum_l2",
                   "keywords": ["Blast Ecosystem"],
                   "info": "L2 con yield nativo en ETH y stablecoins. Fuerte en DeFi y memes."},
    "linea":      {"label": "Linea",       "color": "#61DFFF", "group": "ethereum_l2",
                   "keywords": ["Linea Ecosystem"],
                   "info": "zkEVM de Consensys/MetaMask. Integración nativa con el ecosistema MetaMask."},
    "scroll":     {"label": "Scroll",      "color": "#EEB878", "group": "ethereum_l2",
                   "keywords": ["Scroll Ecosystem"],
                   "info": "zkEVM nativo de Ethereum. Compatible con EVM al 100%."},
    "mantle":     {"label": "Mantle",      "color": "#000000", "group": "ethereum_l2",
                   "keywords": ["Mantle Ecosystem"],
                   "info": "L2 respaldado por BitDAO. Enfocado en gaming y aplicaciones Web3."},
    # Otras redes principales
    "solana":     {"label": "Solana",      "color": "#9945FF", "group": "other",
                   "keywords": ["Solana Ecosystem", "Solana ecosystem"],
                   "info": "Blockchain de alta velocidad y bajo costo. Fuerte en DeFi, NFTs y memes como BONK y WIF."},
    "bnb":        {"label": "BNB Chain",   "color": "#F0B90B", "group": "other",
                   "keywords": ["BNB Chain Ecosystem"],
                   "info": "La blockchain de Binance. Fuerte en DeFi, launchpads y el ecosistema de Binance."},
    "tron":       {"label": "TRON",        "color": "#FF0013", "group": "other",
                   "keywords": ["Tron Ecosystem"],
                   "info": "Red enfocada en transferencias de valor y stablecoins. Gran volumen de USDT."},
    "ton":        {"label": "TON",         "color": "#0088CC", "group": "other",
                   "keywords": ["TON Ecosystem"],
                   "info": "The Open Network, blockchain de Telegram. 900M+ usuarios potenciales."},
    "sui":        {"label": "Sui",         "color": "#6FBCF0", "group": "other",
                   "keywords": ["Sui Ecosystem"],
                   "info": "Blockchain de alto rendimiento con lenguaje Move. Fuerte en DeFi y gaming."},
    "aptos":      {"label": "Aptos",       "color": "#2DD8A3", "group": "other",
                   "keywords": ["Aptos Ecosystem"],
                   "info": "Blockchain con lenguaje Move. Fundada por ex-equipo de Diem (Meta)."},
    "avalanche":  {"label": "Avalanche",   "color": "#E84142", "group": "other",
                   "keywords": ["Avalanche Ecosystem"],
                   "info": "Blockchain con arquitectura de subnets. Permite crear blockchains personalizadas."},
    "cosmos":     {"label": "Cosmos",      "color": "#6F7390", "group": "other",
                   "keywords": ["Cosmos Ecosystem", "Osmosis Ecosystem"],
                   "info": "El internet de blockchains. Chains interoperables via IBC."},
    "near":       {"label": "Near",        "color": "#00C08B", "group": "other",
                   "keywords": ["Near Protocol Ecosystem"],
                   "info": "Blockchain sharded de alto rendimiento. Enfocada en UX y accesibilidad."},
    "polkadot":   {"label": "Polkadot",    "color": "#E6007A", "group": "other",
                   "keywords": ["Polkadot Ecosystem"],
                   "info": "Red de parachains interoperables. Permite blockchains especializadas con seguridad compartida."},
    "cardano":    {"label": "Cardano",     "color": "#0033AD", "group": "other",
                   "keywords": ["Cardano Ecosystem"],
                   "info": "Blockchain con enfoque académico. Usa el lenguaje Plutus para smart contracts."},
    "xrp":        {"label": "XRP Ledger", "color": "#346AA9", "group": "other",
                   "keywords": ["XRP Ledger Ecosystem", "XRPL EVM Ecosystem"],
                   "info": "Ledger de pagos de alta velocidad. Diseñado para transferencias internacionales."},
    "bitcoin":    {"label": "Bitcoin",     "color": "#F7931A", "group": "other",
                   "keywords": ["Bitcoin Ecosystem"],
                   "info": "El ecosistema construido sobre Bitcoin. Incluye Lightning Network, Ordinals y BTCfi."},
    "hyperliquid":{"label": "Hyperliquid", "color": "#00FF94", "group": "other",
                   "keywords": ["Hyperliquid Ecosystem"],
                   "info": "L1 de derivados on-chain. Combina velocidad de un exchange centralizado con descentralización."},
    "berachain":  {"label": "Berachain",   "color": "#8B4513", "group": "other",
                   "keywords": ["Berachain Ecosystem"],
                   "info": "L1 EVM con modelo de liquidez proof-of-liquidity. Ecosistema DeFi nativo."},
    "injective":  {"label": "Injective",   "color": "#00B4D8", "group": "other",
                   "keywords": ["Injective Ecosystem"],
                   "info": "Blockchain financiera interoperable. Especializada en DeFi, derivados y RWA."},
    "otras":      {"label": "Otras redes", "color": "#4A4540", "group": "other",
                   "keywords": [],
                   "info": "Ecosistemas blockchain de menor tamaño o emergentes."},
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
                AVG(change_7d)                                     AS avg_change_7d,
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
            "change_24h": round(float(r["avg_change"]),    2) if r["avg_change"]    else 0,
            "change_7d":  round(float(r["avg_change_7d"]), 2) if r["avg_change_7d"] else 0,
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
            SELECT id, market_cap, change_24h, change_7d, cg_cats
            FROM coins
            WHERE market_cap IS NOT NULL
              AND market_cap > 0
              AND cg_cats IS NOT NULL
        """)

    network_mcap      = {k: 0.0 for k in _NETWORKS}
    network_changes   = {k: []  for k in _NETWORKS}
    network_changes7d = {k: []  for k in _NETWORKS}
    network_mcap["otras"]      = 0.0
    network_changes["otras"]   = []
    network_changes7d["otras"] = []

    for r in rows:
        try:
            cats = json.loads(r["cg_cats"]) if isinstance(r["cg_cats"], str) else r["cg_cats"]
        except Exception:
            continue
        mcap   = float(r["market_cap"])  if r["market_cap"]  else 0
        change   = float(r["change_24h"]) if r["change_24h"] else None
        change7d = float(r["change_7d"])  if r["change_7d"]  else None
        coin_key = None
        for net_id, net_data in _NETWORKS.items():
            if net_id == "otras":
                continue
            if any(kw in cats for kw in net_data["keywords"]):
                coin_key = net_id
                break
        target = coin_key or "otras"
        network_mcap[target] += mcap
        if change   is not None: network_changes[target].append(change)
        if change7d is not None: network_changes7d[target].append(change7d)

    total = sum(network_mcap.values())

    # Agrupar Ethereum + L2s para mostrar subtotal
    eth_l2_total = sum(
        v for k, v in network_mcap.items()
        if _NETWORKS.get(k, {}).get("group") == "ethereum_l2"
    )

    result = []
    for net_id, net_data in _NETWORKS.items():
        mcap = network_mcap.get(net_id, 0)
        if mcap == 0:
            continue
        pct = round(mcap / total * 100, 2) if total > 0 else 0
        changes    = network_changes.get(net_id, [])
        changes7d  = network_changes7d.get(net_id, [])
        avg_change   = round(sum(changes)/len(changes),   2) if changes   else 0
        avg_change7d = round(sum(changes7d)/len(changes7d), 2) if changes7d else 0
        result.append({
            "id":         net_id,
            "label":      net_data["label"],
            "color":      net_data["color"],
            "info":       net_data["info"],
            "group":      net_data.get("group", "other"),
            "mcap":       mcap,
            "pct":        pct,
            "change_24h": avg_change,
            "change_7d":  avg_change7d,
        })

    result.sort(key=lambda x: x["mcap"], reverse=True)
    return {
        "networks":      result,
        "total_mcap":    total,
        "eth_l2_total":  eth_l2_total,
    }


@router.get("/networks/{network_id}/coins")
async def get_network_coins(request: Request, network_id: str, limit: int = 10):
    """Top N coins de una red — desde PostgreSQL."""
    if network_id not in _NETWORKS:
        raise HTTPException(status_code=404, detail="Red no encontrada")

    limit    = max(5, min(50, limit))
    net_data = _NETWORKS[network_id]
    keywords = net_data["keywords"]

    if not keywords:
        # Red "otras" — coins sin red asignada
        async with request.app.state.db_pool.acquire() as conn:
            all_keywords = []
            for nd in _NETWORKS.values():
                all_keywords.extend(nd["keywords"])
            rows = await conn.fetch("""
                SELECT * FROM coins
                WHERE market_cap IS NOT NULL
                  AND cg_cats IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(cg_cats) AS cat
                    WHERE cat = ANY($1::text[])
                  )
                ORDER BY market_cap DESC NULLS LAST
                LIMIT $2
            """, all_keywords, limit)
    else:
        async with request.app.state.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM coins
                WHERE market_cap IS NOT NULL
                  AND cg_cats IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(cg_cats) AS cat
                    WHERE cat = ANY($1::text[])
                  )
                ORDER BY market_cap DESC NULLS LAST
                LIMIT $2
            """, keywords, limit)

    return {
        "network": {
            "id":    network_id,
            "label": net_data["label"],
            "color": net_data["color"],
            "info":  net_data["info"],
        },
        "coins": [_fmt_coin(r) for r in rows],
        "limit": limit,
    }
