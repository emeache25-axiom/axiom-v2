"""
API del módulo Mercado — AXIOM v2.
Endpoints:
  GET /api/market/overview   → top10, ganadoras, perdedoras
  GET /api/market/categories → supercategorías con market cap real
  GET /api/market/networks   → distribución por blockchain
"""
import asyncio
from fastapi import APIRouter, HTTPException
from backend.data.coingecko import fetch_top_coins, fetch_global, fetch_categories

router = APIRouter(prefix="/api/market", tags=["market"])

# ── Mapa de reagrupación: nombre CoinGecko → supercategoría ──────────────────
_CAT_MAP = {
    # BITCOIN
    "Proof of Work (PoW)":           "bitcoin",
    "Bitcoin Fork":                  "bitcoin",
    "Bitcoin Sidechains":            "bitcoin",
    "BRC-20":                        "bitcoin",
    "Tokenized BTC":                 "bitcoin",
    "Bitcoin Meme":                  "bitcoin",
    "Runes":                         "bitcoin",
    "Inscriptions":                  "bitcoin",
    "BTCfi Protocol":                "bitcoin",

    # SMART PLATFORMS
    "Smart Contract Platform":       "smart_platforms",
    "Layer 1 (L1)":                  "smart_platforms",
    "Proof of Stake (PoS)":          "smart_platforms",
    "Directed Acyclic Graph (DAG)":  "smart_platforms",

    # LAYER 2
    "Layer 2 (L2)":                  "layer2",
    "Layer 0 (L0)":                  "layer2",
    "Layer 3 (L3)":                  "layer2",
    "Rollup":                        "layer2",
    "Optimism Superchain Ecosystem": "layer2",
    "Zero Knowledge (ZK)":           "layer2",
    "Parallelized EVM":              "layer2",
    "Appchains":                     "layer2",
    "SideChain":                     "layer2",
    "Rollups-as-a-Service (RaaS)":   "layer2",
    "Modular Blockchain":            "layer2",
    "Chain Abstraction":             "layer2",
    "Data Availability":             "layer2",

    # STABLECOINS
    "Stablecoins":                   "stablecoins",
    "USD Stablecoin":                "stablecoins",
    "Fiat-backed Stablecoin":        "stablecoins",
    "MiCA-Compliant Stablecoin":     "stablecoins",
    "Crypto-backed Stablecoin":      "stablecoins",
    "Algorithmic Stablecoin":        "stablecoins",
    "Synthetic Dollar":              "stablecoins",
    "Yield-Bearing Stablecoin":      "stablecoins",
    "EUR Stablecoin":                "stablecoins",
    "GBP Stablecoin":                "stablecoins",
    "US Treasury-backed Stablecoin": "stablecoins",
    "Commodity-backed Stablecoin":   "stablecoins",
    "Bridged Stablecoin":            "stablecoins",
    "Stablecoin Issuer":             "stablecoins",
    "Seigniorage":                   "stablecoins",

    # DEFI
    "Decentralized Finance (DeFi)":  "defi",
    "Decentralized Exchange (DEX)":  "defi",
    "Automated Market Maker (AMM)":  "defi",
    "Lending/Borrowing Protocols":   "defi",
    "Yield Farming":                 "defi",
    "Yield Aggregator":              "defi",
    "Perpetuals":                    "defi",
    "Derivatives":                   "defi",
    "Options":                       "defi",
    "LSDFi":                         "defi",
    "LRTfi":                         "defi",
    "Governance":                    "defi",
    "Dex Aggregator":                "defi",
    "Fixed Interest":                "defi",
    "Yield Tokenization Protocol":   "defi",
    "Yield-Bearing Tokens":          "defi",
    "Yield Optimizer":               "defi",
    "Insurance":                     "defi",
    "CeFi":                          "defi",
    "Synthetic Asset":               "defi",
    "Synthetic":                     "defi",
    "Curve Ecosystem":               "defi",
    "Index Coop Defi Index":         "defi",
    "DeFi Index":                    "defi",
    "Prediction Markets":            "defi",

    # RWA
    "Real World Assets (RWA)":                    "rwa",
    "Tokenized Assets":                           "rwa",
    "Tokenized Treasuries":                       "rwa",
    "Tokenized Gold":                             "rwa",
    "Tokenized Silver":                           "rwa",
    "Tokenized Commodities":                      "rwa",
    "Tokenized Stock":                            "rwa",
    "Tokenized Real Estate":                      "rwa",
    "Tokenized Private Credit":                   "rwa",
    "Tokenized Pre-IPO Stocks":                   "rwa",
    "RWA Protocol":                               "rwa",
    "Tokenized Exchange-Traded Product (ETPs)":   "rwa",
    "Tokenized Exchange-Traded Funds (ETFs)":     "rwa",
    "Ondo Tokenized Assets":                      "rwa",
    "BackedFi xStocks Ecosystem":                 "rwa",
    "Tokenized Non-US Government Securities":     "rwa",
    "Tokenized Uranium":                          "rwa",
    "Trading Card RWA Platform":                  "rwa",

    # EXCHANGE TOKENS
    "Exchange-based Tokens":         "exchange",
    "Centralized Exchange (CEX) Token": "exchange",
    "Crypto Card Issuer":            "exchange",
    "Neobank":                       "exchange",

    # AI
    "Artificial Intelligence (AI)":  "ai",
    "AI Agents":                     "ai",
    "AI Applications":               "ai",
    "AI Framework":                  "ai",
    "AI Agent Launchpad":            "ai",
    "DeFAI":                         "ai",
    "AI Meme":                       "ai",
    "Bittensor Subnets":             "ai",
    "Robotics":                      "ai",

    # MEMES
    "Meme":                          "memes",
    "Dog-Themed":                    "memes",
    "Cat-Themed":                    "memes",
    "Frog-Themed":                   "memes",
    "4chan-Themed":                   "memes",
    "Solana Meme":                   "memes",
    "Base Meme":                     "memes",
    "TON Meme":                      "memes",
    "Bitcoin Meme":                  "memes",
    "Chinese Meme":                  "memes",
    "IP Meme":                       "memes",
    "Parody Meme":                   "memes",
    "Elon Musk-Inspired":            "memes",
    "The Boy's Club":                "memes",
    "Wojak-Themed":                  "memes",
    "TRON Meme":                     "memes",
    "Sui Meme":                      "memes",
    "Desci Meme":                    "memes",
    "Animal Racing":                 "memes",
    "Commodities Meme":              "memes",
    "Country-Themed Meme":           "memes",
    "Memorial Themed":               "memes",
    "Celebrity-Themed":              "memes",
    "Wall Street Bets Themed":       "memes",
    "Stock market-themed":           "memes",
    "Sticker-Themed Coins":          "memes",
    "Anime-Themed":                  "memes",
    "Zoo-Themed":                    "memes",
    "Duck-Themed":                   "memes",
    "Mascot-Themed":                 "memes",
    "Zodiac-Themed":                 "memes",
    "Emoji-Themed":                  "memes",

    # GAMING
    "Gaming (GameFi)":               "gaming",
    "Play To Earn":                  "gaming",
    "NFT":                           "gaming",
    "Metaverse":                     "gaming",
    "Gaming Blockchains":            "gaming",
    "Gaming Utility Token":          "gaming",
    "Gaming Governance Token":       "gaming",
    "Gaming Marketplace":            "gaming",
    "Gaming Platform":               "gaming",
    "On-chain Gaming":               "gaming",
    "RPG":                           "gaming",
    "MMO":                           "gaming",
    "Simulation Games":              "gaming",
    "Card Games":                    "gaming",
    "Action Games":                  "gaming",
    "Adventure Games":               "gaming",
    "Sports Games":                  "gaming",
    "Shooting Games":                "gaming",
    "Strategy Games":                "gaming",
    "Arcade Games":                  "gaming",
    "Racing Games":                  "gaming",
    "Fighting Games":                "gaming",
    "Gambling (GambleFi)":           "gaming",
    "Game Studio":                   "gaming",
    "Axie Infinity Ecosystem":       "gaming",
    "Breeding":                      "gaming",
    "Quest-to-Earn":                 "gaming",
    "NFT Marketplace":               "gaming",
    "NFTFi":                         "gaming",
    "NFT Lending/Borrowing":         "gaming",
    "Fractionalized NFT":            "gaming",
    "NFT Index":                     "gaming",
    "NFT Launchpad":                 "gaming",
    "NFT Strategy Flywheel":         "gaming",
    "Airdropped Tokens by NFT Projects": "gaming",

    # PRIVACY
    "Privacy":                       "privacy",
    "Privacy Coins":                 "privacy",
    "Privacy Infrastructure":        "privacy",
    "Privacy Blockchain":            "privacy",
    "VPN":                           "privacy",
    "Quantum-Resistant":             "privacy",
    "Privacy Browser":               "privacy",
    "MEV Protection":                "privacy",

    # INFRASTRUCTURE
    "Infrastructure":                "infrastructure",
    "Oracle":                        "infrastructure",
    "Cross-chain Communication":     "infrastructure",
    "Bridge Governance Tokens":      "infrastructure",
    "Bridged-Tokens":                "infrastructure",
    "DePIN":                         "infrastructure",
    "Storage":                       "infrastructure",
    "Internet of Things (IOT)":      "infrastructure",
    "Data Availability":             "infrastructure",
    "Wallets":                       "infrastructure",
    "Account Abstraction":           "infrastructure",
    "Cybersecurity":                 "infrastructure",
    "Analytics":                     "infrastructure",
    "Name Service":                  "infrastructure",
    "Decentralized Identifier (DID)":"infrastructure",
    "Communication":                 "infrastructure",
    "Discord Bots":                  "infrastructure",
    "Trading Bots":                  "infrastructure",
    "Market-Making Solution":        "infrastructure",
    "Intent":                        "infrastructure",

    # DESOC / WEB3
    "SocialFi":                      "desoc",
    "Decentralized Social Media (DeSOC)": "desoc",
    "Fan Token":                     "desoc",
    "Music":                         "desoc",
    "Sports":                        "desoc",
    "Entertainment":                 "desoc",
    "Farcaster Ecosystem":           "desoc",
    "SocialFi":                      "desoc",
    "InfoFi":                        "desoc",
    "Education":                     "desoc",
    "E-commerce":                    "desoc",
    "Retail":                        "desoc",
    "Healthcare":                    "desoc",
    "Tourism":                       "desoc",
    "Marketing":                     "desoc",
    "Legal":                         "desoc",
    "Recruitment":                   "desoc",
    "Charity":                       "desoc",

    # STAKING / LIQUID
    "Liquid Staking":                "staking",
    "Restaking":                     "staking",
    "Liquid Staking Tokens":         "staking",
    "Liquid Staking Governance Tokens": "staking",
    "Liquid Restaking Governance Tokens": "staking",
    "Masternodes":                   "staking",
    "Mobile Mining":                 "staking",

    # LAUNCHPADS
    "Binance Launchpool":            "launchpads",
    "Binance Launchpad":             "launchpads",
    "Binance HODLer Airdrops":       "launchpads",
    "Binance Alpha Spotlight":       "launchpads",
    "Binance Wallet IDO":            "launchpads",
    "Binance Megadrop":              "launchpads",
    "Binance Buildkey TGE":          "launchpads",
    "Launchpad":                     "launchpads",
    "AI Agent Launchpad":            "launchpads",
    "Echo Launchpad":                "launchpads",
    "Buidlpad Launchpad":            "launchpads",
    "TokenFi Launchpad":             "launchpads",
    "DaoMaker Launchpad":            "launchpads",
    "Impossible Finance Launchpad":  "launchpads",
    "Poolz Finance Launchpad":       "launchpads",
    "ChainGPT Launchpad":            "launchpads",
    "Cookie Launchpad":              "launchpads",
    "Camelot Launchpad":             "launchpads",
    "NFT Launchpad":                 "launchpads",
    "Capital Launchpad (Kaito)":     "launchpads",
    "MetaDAO Launchpad":             "launchpads",
    "America.fun Launchpad":         "launchpads",
    "Kumbaya Launchpad":             "launchpads",
    "Surge Launchpad":               "launchpads",
    "Kommunitas Launchpad":          "launchpads",
    "PAAL AI Launchpad":             "launchpads",
    "Printr Launchpad":              "launchpads",

    # SEC SECURITIES
    "Alleged SEC Securities":        "sec_securities",

    # NARRATIVAS POLÍTICAS
    "Made in USA":                   "political",
    "Made in China":                 "political",
    "World Liberty Financial Portfolio": "political",
    "Trump-Affiliated":              "political",
    "PolitiFi":                      "political",
    "Elon Musk-Inspired":            "political",
    "4chan-Themed":                   "political",

    # PAGOS
    "Payment Solutions":             "payments",
    "Crypto Card Issuer":            "payments",
    "Cross-chain Communication":     "payments",
}

# ── Definición de supercategorías ─────────────────────────────────────────────
_SUPERCATS = {
    "bitcoin":         {
        "label": "Bitcoin",
        "color": "#F7931A",
        "info":  "El activo fundacional del ecosistema cripto. Incluye Bitcoin, sus forks, sidechains y protocolos construidos sobre Bitcoin como BRC-20 y BTCfi.",
    },
    "smart_platforms": {
        "label": "Smart Platforms",
        "color": "#627EEA",
        "info":  "Blockchains de capa 1 con capacidad de contratos inteligentes. Son la infraestructura base sobre la que se construyen aplicaciones descentralizadas.",
    },
    "layer2":          {
        "label": "Layer 2",
        "color": "#8A2BE2",
        "info":  "Soluciones de escalabilidad construidas sobre blockchains de capa 1. Aumentan la velocidad y reducen costos manteniendo la seguridad de la capa base.",
    },
    "stablecoins":     {
        "label": "Stablecoins",
        "color": "#26A17B",
        "info":  "Activos diseñados para mantener un valor estable, generalmente anclados al dólar u otras monedas fiat. Incluye respaldadas por fiat, cripto o algorítmicas.",
    },
    "defi":            {
        "label": "DeFi",
        "color": "#56A14F",
        "info":  "Finanzas descentralizadas. Protocolos que replican servicios financieros tradicionales (préstamos, exchanges, derivados) sin intermediarios centralizados.",
    },
    "rwa":             {
        "label": "RWA",
        "color": "#C9A84C",
        "info":  "Real World Assets. Tokenización de activos del mundo real: bonos del tesoro, acciones, oro, inmuebles y otros activos tradicionales llevados a la blockchain.",
    },
    "exchange":        {
        "label": "Exchange Tokens",
        "color": "#F0B90B",
        "info":  "Tokens nativos de exchanges centralizados. Ofrecen beneficios como descuentos en comisiones, participación en ganancias y acceso a launchpads.",
    },
    "ai":              {
        "label": "Inteligencia Artificial",
        "color": "#00D4FF",
        "info":  "Proyectos que combinan blockchain con inteligencia artificial. Incluye agentes de IA, infraestructura de computación descentralizada y aplicaciones AI-native.",
    },
    "memes":           {
        "label": "Memes",
        "color": "#FF6B6B",
        "info":  "Tokens impulsados por comunidad, cultura de internet y narrativas virales. Alto riesgo y volatilidad, pero indicadores importantes del sentimiento retail.",
    },
    "gaming":          {
        "label": "Gaming & NFT",
        "color": "#FF4081",
        "info":  "Videojuegos blockchain, metaversos y NFTs. Incluye play-to-earn, activos digitales coleccionables y economías virtuales descentralizadas.",
    },
    "privacy":         {
        "label": "Privacidad",
        "color": "#9E9E9E",
        "info":  "Proyectos centrados en la privacidad de transacciones e identidad digital. Incluye criptomonedas privadas, infraestructura zero-knowledge y resistencia cuántica.",
    },
    "infrastructure":  {
        "label": "Infraestructura",
        "color": "#78716C",
        "info":  "La capa técnica que hace funcionar el ecosistema cripto: oráculos, bridges, almacenamiento descentralizado, identidad digital y herramientas de desarrollo.",
    },
    "desoc":           {
        "label": "DeSoc & Web3",
        "color": "#E91E63",
        "info":  "Aplicaciones sociales y de consumo descentralizadas. Redes sociales Web3, plataformas de entretenimiento, deportes, música y servicios del mundo real.",
    },
    "staking":         {
        "label": "Staking & Liquid",
        "color": "#2563EB",
        "info":  "Protocolos de staking líquido y restaking. Permiten generar rendimiento sobre activos en staking manteniendo liquidez mediante tokens derivados.",
    },
    "launchpads":      {
        "label": "Launchpads",
        "color": "#FF9800",
        "info":  "Plataformas de lanzamiento de nuevos proyectos cripto. Permiten a inversores acceder a tokens antes de su listing en exchanges principales.",
    },
    "sec_securities":  {
        "label": "Alleged SEC Securities",
        "color": "#D93B3B",
        "info":  "Activos que la SEC de EE.UU. considera o consideró valores no registrados. Categoría de alto riesgo regulatorio con posibles implicancias legales.",
    },
    "political":       {
        "label": "Narrativas Políticas",
        "color": "#B47514",
        "info":  "Tokens vinculados a movimientos políticos, figuras públicas o narrativas geopolíticas. Incluye proyectos Made in USA, Made in China y afiliados a figuras políticas.",
    },
    "payments":        {
        "label": "Pagos",
        "color": "#00BCD4",
        "info":  "Protocolos diseñados para facilitar pagos y transferencias de valor. Compiten con sistemas financieros tradicionales en velocidad, costo e interoperabilidad.",
    },
    "otros":           {
        "label": "Otros",
        "color": "#4A4540",
        "info":  "Categorías de nicho o emergentes que no encajan en las supercategorías principales. Pueden incluir narrativas nuevas aún en desarrollo.",
    },
}


def _map_category(cg_name: str) -> str:
    """Mapea un nombre de categoría CoinGecko a una supercategoría."""
    return _CAT_MAP.get(cg_name, "otros")


@router.get("/overview")
async def get_market_overview():
    """Top 10, ganadoras, perdedoras."""
    coins = await fetch_top_coins(50)
    if not coins:
        raise HTTPException(status_code=503, detail="No se pudieron obtener datos")

    formatted = [_format_coin(c) for c in coins]
    top10   = formatted[:10]
    gainers = sorted([c for c in formatted if c["change_24h"] is not None],
                     key=lambda x: x["change_24h"], reverse=True)[:5]
    losers  = sorted([c for c in formatted if c["change_24h"] is not None],
                     key=lambda x: x["change_24h"])[:5]
    return {"top10": top10, "gainers": gainers, "losers": losers}


async def _precache_drilldowns(cats: list, supercat_mcap: dict) -> None:
    """
    Pre-cachea las coins de cada supercategoría en background.
    Corre después de que /categories responde, no bloquea al usuario.
    """
    import time

    # Ordenar supercategorías por market cap — cachear las más importantes primero
    ordered = sorted(supercat_mcap.items(), key=lambda x: x[1], reverse=True)

    for sc_id, mcap in ordered:
        if mcap == 0:
            continue

        # Saltar si ya está cacheado y es válido
        cache_key = f"{sc_id}_10"
        now = time.time()
        if cache_key in _drilldown_cache:
            if (now - _drilldown_cache_time.get(cache_key, 0)) < _DRILLDOWN_TTL:
                continue

        # Encontrar top 3 categorías CoinGecko de esta supercategoría
        cg_cats   = [name for name, sc in _CAT_MAP.items() if sc == sc_id]
        matched   = [c for c in cats if c["name"] in cg_cats]
        matched.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
        top_cats  = matched[:3]

        if not top_cats:
            continue

        # Fetch con delay para no saturar CoinGecko
        all_coins = []
        seen      = set()
        for i, cat in enumerate(top_cats):
            if i > 0:
                await asyncio.sleep(1.5)
            coins = await _fetch_cat_coins_internal(cat["id"])
            for c in coins:
                if c["id"] not in seen:
                    seen.add(c["id"])
                    all_coins.append(c)

        if not all_coins:
            continue

        all_coins.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

        result = {
            "supercat": _SUPERCATS[sc_id],
            "coins":    all_coins[:10],
            "limit":    10,
            "sources":  [c["name"] for c in top_cats],
        }

        _drilldown_cache[cache_key]      = result
        _drilldown_cache_time[cache_key] = time.time()
        print(f"[market] pre-cacheado {sc_id}: {len(all_coins[:10])} coins")

        # Delay entre supercategorías
        await asyncio.sleep(2)


async def _fetch_cat_coins_internal(cat_id: str, retries: int = 3) -> list:
    """Fetch interno de coins por categoría CoinGecko con reintentos."""
    for attempt in range(retries):
        try:
            async with __import__('httpx').AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.coingecko.com/api/v3/coins/markets",
                    params={
                        "vs_currency":             "usd",
                        "category":                cat_id,
                        "order":                   "market_cap_desc",
                        "per_page":                25,
                        "page":                    1,
                        "price_change_percentage": "24h,7d",
                        "sparkline":               "true",
                    }
                )
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    print(f"[coingecko] rate limit {cat_id}, esperando {wait}s")
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()
                if data:
                    return data
        except Exception as e:
            print(f"[coingecko] _fetch_cat_coins_internal {cat_id} intento {attempt+1}: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(1)
    return []


@router.get("/categories")
async def get_market_categories():
    """Distribución del mercado por supercategorías."""
    cats = await fetch_categories()
    if not cats:
        raise HTTPException(status_code=503, detail="No se pudieron obtener categorías")

    # Agrupar en supercategorías
    supercat_mcap   = {k: 0.0 for k in _SUPERCATS}
    supercat_change = {k: [] for k in _SUPERCATS}

    for cat in cats:
        sc     = _map_category(cat["name"])
        mcap   = cat.get("market_cap") or 0
        change = cat.get("market_cap_change_24h")
        supercat_mcap[sc] += mcap
        if change is not None:
            supercat_change[sc].append(change)

    total_mcap = sum(supercat_mcap.values())

    result = []
    for sc_id, sc_data in _SUPERCATS.items():
        mcap   = supercat_mcap[sc_id]
        if mcap == 0:
            continue
        changes = supercat_change[sc_id]
        avg_change = sum(changes) / len(changes) if changes else 0
        pct = round(mcap / total_mcap * 100, 2) if total_mcap > 0 else 0
        result.append({
            "id":        sc_id,
            "label":     sc_data["label"],
            "color":     sc_data["color"],
            "info":      sc_data["info"],
            "mcap":      mcap,
            "pct":       pct,
            "change_24h": round(avg_change, 2),
        })

    result.sort(key=lambda x: x["mcap"], reverse=True)

    # Pre-cachear drill-downs en background (no bloquea la respuesta)
    asyncio.create_task(_precache_drilldowns(cats, supercat_mcap))

    return {"categories": result, "total_mcap": total_mcap}


@router.get("/networks")
async def get_market_networks():
    """Distribución del mercado por blockchain/red."""
    # Usamos las categorías de CoinGecko que representan ecosistemas de redes
    _NETWORK_KEYWORDS = {
        "ethereum":  ["Ethereum", "ERC", "Base Native", "Optimism", "Arbitrum",
                      "zkSync", "Polygon", "Starknet"],
        "solana":    ["Solana"],
        "bnb":       ["BNB", "Binance Smart Chain", "BSC"],
        "base":      ["Base Native", "Base Meme"],
        "avalanche": ["Avalanche", "Avalanche L1"],
        "tron":      ["TRON"],
        "ton":       ["TON", "Telegram"],
        "sui":       ["Sui"],
        "aptos":     ["Aptos"],
        "cosmos":    ["Cosmos", "IBC"],
    }

    _NETWORK_LABELS = {
        "ethereum":  {"label": "Ethereum + L2s", "color": "#627EEA",
                      "info": "El ecosistema más grande de smart contracts. Incluye la red principal y sus principales soluciones L2 como Base, Arbitrum y Optimism."},
        "solana":    {"label": "Solana",          "color": "#9945FF",
                      "info": "Blockchain de alta velocidad y bajo costo. Ecosistema en fuerte crecimiento con DeFi, NFTs y memes como BONK y WIF."},
        "bnb":       {"label": "BNB Chain",       "color": "#F0B90B",
                      "info": "La blockchain de Binance. Fuerte en DeFi y launchpads, con proyectos como PancakeSwap y el ecosistema de tokens de Binance."},
        "base":      {"label": "Base",            "color": "#0052FF",
                      "info": "L2 de Coinbase sobre Ethereum. Ecosistema en rápido crecimiento con fuerte actividad en memes y aplicaciones consumer."},
        "avalanche": {"label": "Avalanche",       "color": "#E84142",
                      "info": "Blockchain con arquitectura de subnets. Permite crear blockchains personalizadas con alta velocidad y finalidad instantánea."},
        "tron":      {"label": "TRON",            "color": "#FF0013",
                      "info": "Red enfocada en transferencias de valor y stablecoins. Maneja gran volumen de USDT y tiene ecosistema DeFi propio."},
        "ton":       {"label": "TON",             "color": "#0088CC",
                      "info": "The Open Network, blockchain de Telegram. Ecosistema en crecimiento impulsado por los 900M+ usuarios de Telegram."},
        "sui":       {"label": "Sui",             "color": "#6FBCF0",
                      "info": "Blockchain de alto rendimiento con lenguaje Move. Enfocada en DeFi y gaming con arquitectura de objetos única."},
        "aptos":     {"label": "Aptos",           "color": "#2DD8A3",
                      "info": "Blockchain fundada por ex-equipo de Diem (Meta). Alto rendimiento con lenguaje Move y enfoque en seguridad."},
        "cosmos":    {"label": "Cosmos",          "color": "#2E3148",
                      "info": "El internet de blockchains. Ecosistema de chains interoperables conectadas via IBC, incluyendo ATOM, OSMO y decenas más."},
    }

    cats = await fetch_categories()
    if not cats:
        raise HTTPException(status_code=503, detail="No se pudieron obtener datos de redes")

    network_mcap = {k: 0.0 for k in _NETWORK_KEYWORDS}

    for cat in cats:
        name = cat["name"]
        mcap = cat.get("market_cap") or 0
        for network, keywords in _NETWORK_KEYWORDS.items():
            if any(kw.lower() in name.lower() for kw in keywords):
                network_mcap[network] += mcap
                break

    total = sum(network_mcap.values())
    result = []
    for net_id, mcap in network_mcap.items():
        if mcap == 0:
            continue
        pct = round(mcap / total * 100, 2) if total > 0 else 0
        result.append({
            "id":    net_id,
            "label": _NETWORK_LABELS[net_id]["label"],
            "color": _NETWORK_LABELS[net_id]["color"],
            "info":  _NETWORK_LABELS[net_id]["info"],
            "mcap":  mcap,
            "pct":   pct,
        })

    result.sort(key=lambda x: x["mcap"], reverse=True)
    return {"networks": result, "total_mcap": total}


def _format_coin(c: dict) -> dict:
    return {
        "rank":       c.get("market_cap_rank"),
        "id":         c.get("id"),
        "symbol":     c.get("symbol", "").upper(),
        "name":       c.get("name"),
        "price":      c.get("current_price"),
        "change_24h": round(c.get("price_change_percentage_24h") or 0, 2),
        "market_cap": c.get("market_cap"),
        "volume_24h": c.get("total_volume"),
        "image":      c.get("image"),
    }


@router.get("/coins")
async def get_coins(page: int = 1, per_page: int = 25):
    """
    Lista paginada de cryptos ordenadas por market cap.
    """
    from backend.data.coingecko import fetch_coins_page

    if per_page not in [10, 25, 50]:
        per_page = 25
    if page < 1:
        page = 1

    coins = await fetch_coins_page(page=page, per_page=per_page)
    if not coins:
        raise HTTPException(status_code=503, detail="No se pudieron obtener datos")

    formatted = []
    for c in coins:
        formatted.append({
            "rank":        c.get("market_cap_rank"),
            "id":          c.get("id"),
            "symbol":      c.get("symbol","").upper(),
            "name":        c.get("name"),
            "price":       c.get("current_price"),
            "change_24h":  round(c.get("price_change_percentage_24h") or 0, 2),
            "change_7d":   round(c.get("price_change_percentage_7d_in_currency") or 0, 2),
            "market_cap":  c.get("market_cap"),
            "volume_24h":  c.get("total_volume"),
            "image":       c.get("image"),
            "sparkline":   c.get("sparkline_in_7d", {}).get("price", []),
        })

    return {
        "coins":    formatted,
        "page":     page,
        "per_page": per_page,
    }


# Cache de drill-downs en memoria (TTL 30 minutos)
_drilldown_cache: dict = {}
_drilldown_cache_time: dict = {}
_DRILLDOWN_TTL = 1800  # 30 minutos


@router.get("/categories/{supercat_id}/coins")
async def get_supercat_coins(supercat_id: str, limit: int = 10):
    """
    Top N cryptos de una supercategoría.
    Toma las top 3 categorías CoinGecko de la supercategoría,
    fetchea sus coins en paralelo, deduplica y ordena por mcap.
    """
    import asyncio
    from backend.data.coingecko import fetch_categories

    import time
    if supercat_id not in _SUPERCATS:
        raise HTTPException(status_code=404, detail="Supercategoría no encontrada")

    limit = max(5, min(50, limit))

    # Verificar cache
    cache_key = f"{supercat_id}_{limit}"
    now = time.time()
    if cache_key in _drilldown_cache:
        if (now - _drilldown_cache_time.get(cache_key, 0)) < _DRILLDOWN_TTL:
            return _drilldown_cache[cache_key]

    # Encontrar categorías CoinGecko que mapean a esta supercategoría
    cg_cats = [name for name, sc in _CAT_MAP.items() if sc == supercat_id]

    if not cg_cats:
        return {"supercat": _SUPERCATS[supercat_id], "coins": [], "limit": limit}

    # Traer market caps de categorías para tomar las top 3
    all_cats = await fetch_categories()
    if not all_cats:
        raise HTTPException(status_code=503, detail="No se pudieron obtener categorías")

    # Filtrar y ordenar por mcap — top 3 categorías CoinGecko
    matched = [c for c in all_cats if c["name"] in cg_cats]
    matched.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
    top_cats = matched[:3]

    if not top_cats:
        return {"supercat": _SUPERCATS[supercat_id], "coins": [], "limit": limit}

    # Requests secuenciales usando función interna con reintentos
    results = []
    for i, cat in enumerate(top_cats):
        if i > 0:
            await asyncio.sleep(1)
        coins = await _fetch_cat_coins_internal(cat["id"])
        results.append(coins)

    # Unir, deduplicar por id, ordenar por mcap
    seen = set()
    all_coins = []
    for batch in results:
        for c in batch:
            if c["id"] not in seen:
                seen.add(c["id"])
                all_coins.append({
                    "rank":       c.get("market_cap_rank"),
                    "id":         c.get("id"),
                    "symbol":     c.get("symbol", "").upper(),
                    "name":       c.get("name"),
                    "price":      c.get("current_price"),
                    "change_24h": round(c.get("price_change_percentage_24h") or 0, 2),
                    "change_7d":  round(c.get("price_change_percentage_7d_in_currency") or 0, 2),
                    "market_cap": c.get("market_cap"),
                    "volume_24h": c.get("total_volume"),
                    "image":      c.get("image"),
                    "sparkline":  c.get("sparkline_in_7d", {}).get("price", []),
                })

    all_coins.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

    result = {
        "supercat": _SUPERCATS[supercat_id],
        "coins":    all_coins[:limit],
        "limit":    limit,
        "sources":  [c["name"] for c in top_cats],
    }

    # Guardar en cache
    _drilldown_cache[cache_key]      = result
    _drilldown_cache_time[cache_key] = now

    return result
