"""
Sincronización de coins en PostgreSQL.

Jobs:
  - sync_prices()      → cada hora: actualiza precios, rank, volumen, sparkline
  - sync_categories()  → semanal: scraping de categorías CoinGecko → asigna supercat
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
import asyncpg
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

_BASE    = "https://api.coingecko.com/api/v3"
_TIMEOUT = 15.0
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Prioridad de supercategorías ─────────────────────────────────────────────
_PRIORITY = [
    "stablecoins", "memes", "privacy", "rwa", "ai", "gaming",
    "defi", "layer2", "exchange", "payments", "bitcoin",
    "smart_platforms", "infrastructure", "staking", "desoc",
    "launchpads", "political", "sec_securities", "otros",
]

# Mapa categoría CoinGecko → supercategoría (mismo que market.py)
_CAT_MAP = {
    "Bitcoin Ecosystem":             "bitcoin",
    "Proof of Work (PoW)":           "bitcoin",
    "Bitcoin Fork":                  "bitcoin",
    "Bitcoin Sidechains":            "bitcoin",
    "BRC-20":                        "bitcoin",
    "Runes":                         "bitcoin",
    "BTCfi Protocol":                "bitcoin",
    "Smart Contract Platform":       "smart_platforms",
    "Layer 1 (L1)":                  "smart_platforms",
    "Proof of Stake (PoS)":          "smart_platforms",
    "Directed Acyclic Graph (DAG)":  "smart_platforms",
    "Layer 2 (L2)":                  "layer2",
    "Layer 0 (L0)":                  "layer2",
    "Layer 3 (L3)":                  "layer2",
    "Rollup":                        "layer2",
    "Zero Knowledge (ZK)":           "layer2",
    "Parallelized EVM":              "layer2",
    "Appchains":                     "layer2",
    "SideChain":                     "layer2",
    "Modular Blockchain":            "layer2",
    "Chain Abstraction":             "layer2",
    "Data Availability":             "layer2",
    "Optimism Superchain Ecosystem": "layer2",
    "Rollups-as-a-Service (RaaS)":   "layer2",
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
    "Bridged Stablecoin":            "stablecoins",
    "Stablecoin Issuer":             "stablecoins",
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
    "Governance":                    "defi",
    "Dex Aggregator":                "defi",
    "Prediction Markets":            "defi",
    "Real World Assets (RWA)":       "rwa",
    "Tokenized Assets":              "rwa",
    "Tokenized Treasuries":          "rwa",
    "Tokenized Gold":                "rwa",
    "Tokenized Silver":              "rwa",
    "Tokenized Commodities":         "rwa",
    "Tokenized Stock":               "rwa",
    "Tokenized Real Estate":         "rwa",
    "Tokenized Private Credit":      "rwa",
    "RWA Protocol":                  "rwa",
    "Exchange-based Tokens":         "exchange",
    "Centralized Exchange (CEX) Token": "exchange",
    "Artificial Intelligence (AI)":  "ai",
    "AI Agents":                     "ai",
    "AI Applications":               "ai",
    "AI Framework":                  "ai",
    "DeFAI":                         "ai",
    "Robotics":                      "ai",
    "Meme":                          "memes",
    "Dog-Themed":                    "memes",
    "Cat-Themed":                    "memes",
    "Frog-Themed":                   "memes",
    "Solana Meme":                   "memes",
    "Base Meme":                     "memes",
    "Elon Musk-Inspired":            "memes",
    "Gaming (GameFi)":               "gaming",
    "Play To Earn":                  "gaming",
    "NFT":                           "gaming",
    "Metaverse":                     "gaming",
    "Privacy":                       "privacy",
    "Privacy Coins":                 "privacy",
    "Privacy Blockchain":            "privacy",
    "Quantum-Resistant":             "privacy",
    "VPN":                           "privacy",
    "Infrastructure":                "infrastructure",
    "Oracle":                        "infrastructure",
    "DePIN":                         "infrastructure",
    "Storage":                       "infrastructure",
    "Internet of Things (IOT)":      "infrastructure",
    "Cross-chain Communication":     "infrastructure",
    "Payment Solutions":             "payments",
    "SocialFi":                      "desoc",
    "Fan Token":                     "desoc",
    "Music":                         "desoc",
    "Sports":                        "desoc",
    "Liquid Staking":                "staking",
    "Restaking":                     "staking",
    "Alleged SEC Securities":        "sec_securities",
    "Made in USA":                   "political",
    "Made in China":                 "political",
    "World Liberty Financial Portfolio": "political",
    "Trump-Affiliated":              "political",
    "PolitiFi":                      "political",
    # Ecosistemas de redes (para stablecoins multi-chain)
    "BNB Chain Ecosystem":           "exchange",
    "XRP Ledger Ecosystem":          "payments",
    "Ethereum Ecosystem":            "smart_platforms",
    "Solana Ecosystem":              "smart_platforms",
    "Tron Ecosystem":                "smart_platforms",
    "Avalanche Ecosystem":           "smart_platforms",
    "Polygon Ecosystem":             "layer2",
    "Arbitrum Ecosystem":            "layer2",
    "Optimism Ecosystem":            "layer2",
    "Base Ecosystem":                "layer2",
    "Cosmos Ecosystem":              "smart_platforms",
    "Polkadot Ecosystem":            "smart_platforms",
    "Near Ecosystem":                "smart_platforms",
    "Sui Ecosystem":                 "smart_platforms",
    "Aptos Ecosystem":               "smart_platforms",
    "TON Ecosystem":                 "smart_platforms",
    "Cardano Ecosystem":             "smart_platforms",
    "Stellar Ecosystem":             "payments",
    "Algorand Ecosystem":            "smart_platforms",
    "Fantom Ecosystem":              "smart_platforms",
    "Provenance Ecosystem":          "rwa",
}


def _assign_supercat(cg_cats: list[str]) -> str:
    """Asigna supercategoría según prioridad."""
    mapped = set()
    for cat in cg_cats:
        sc = _CAT_MAP.get(cat)
        if sc:
            mapped.add(sc)
    for priority in _PRIORITY:
        if priority in mapped:
            return priority
    return "otros"


# ── Job horario: sincronizar precios ─────────────────────────────────────────
async def sync_prices(pool: asyncpg.Pool) -> dict:
    """
    Trae top 2000 coins por market cap y actualiza precios en PostgreSQL.
    Sparkline solo para top 500.
    """
    logger.info("[coins_sync] Iniciando sync de precios...")
    total_updated = 0
    total_inserted = 0

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for page in range(1, 9):  # 8 páginas × 250 = 2000 coins
            sparkline = "true" if page <= 2 else "false"  # solo top 500
            try:
                resp = await client.get(
                    f"{_BASE}/coins/markets",
                    params={
                        "vs_currency":             "usd",
                        "order":                   "market_cap_desc",
                        "per_page":                250,
                        "page":                    page,
                        "price_change_percentage": "24h,7d",
                        "sparkline":               sparkline,
                    }
                )
                if resp.status_code == 429:
                    logger.warning(f"[coins_sync] Rate limit página {page}, esperando 60s")
                    await asyncio.sleep(60)
                    continue
                resp.raise_for_status()
                coins = resp.json()
            except Exception as e:
                logger.error(f"[coins_sync] Error página {page}: {e}")
                await asyncio.sleep(5)
                continue

            if not coins or not isinstance(coins, list):
                break

            # Upsert en PostgreSQL
            async with pool.acquire() as conn:
                for c in coins:
                    sp = c.get("sparkline_in_7d", {}).get("price", []) if sparkline == "true" else None
                    await conn.execute("""
                        INSERT INTO coins (
                            id, symbol, name, rank, price,
                            change_24h, change_7d, market_cap,
                            volume_24h, image, sparkline, updated_at
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
                        ON CONFLICT (id) DO UPDATE SET
                            rank       = EXCLUDED.rank,
                            price      = EXCLUDED.price,
                            change_24h = EXCLUDED.change_24h,
                            change_7d  = EXCLUDED.change_7d,
                            market_cap = EXCLUDED.market_cap,
                            volume_24h = EXCLUDED.volume_24h,
                            image      = EXCLUDED.image,
                            sparkline  = CASE
                                WHEN EXCLUDED.sparkline IS NOT NULL
                                THEN EXCLUDED.sparkline
                                ELSE coins.sparkline
                            END,
                            updated_at = now()
                    """,
                        c.get("id"),
                        c.get("symbol","").upper(),
                        c.get("name",""),
                        c.get("market_cap_rank"),
                        c.get("current_price"),
                        c.get("price_change_percentage_24h"),
                        c.get("price_change_percentage_7d_in_currency"),
                        c.get("market_cap"),
                        c.get("total_volume"),
                        c.get("image"),
                        json.dumps(sp) if sp else None,
                    )
                    total_updated += 1

            logger.info(f"[coins_sync] Página {page}/8 procesada ({len(coins)} coins)")
            await asyncio.sleep(2)

    logger.info(f"[coins_sync] Sync precios completo: {total_updated} coins actualizadas")
    return {"updated": total_updated}


# ── Job semanal: scraping de categorías ──────────────────────────────────────
async def sync_categories(pool: asyncpg.Pool) -> dict:
    """
    Scraping de categorías CoinGecko para cada coin.
    Asigna supercategoría según prioridad.
    Corre semanalmente.
    """
    logger.info("[coins_sync] Iniciando sync de categorías (scraping)...")

    # Traer todos los coin_id de la DB
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM coins ORDER BY rank NULLS LAST")

    coin_ids = [r["id"] for r in rows]
    logger.info(f"[coins_sync] {len(coin_ids)} coins a categorizar")

    updated = 0
    errors  = 0

    async with httpx.AsyncClient(timeout=15, headers=_HEADERS, follow_redirects=True) as client:
        for i, coin_id in enumerate(coin_ids):
            try:
                resp = await client.get(
                    f"https://www.coingecko.com/en/coins/{coin_id}"
                )
                if resp.status_code == 429:
                    logger.warning(f"[coins_sync] Rate limit en {coin_id}, esperando 30s")
                    await asyncio.sleep(30)
                    continue
                if resp.status_code != 200:
                    errors += 1
                    await asyncio.sleep(1)
                    continue

                # Detectar redirect a homepage — coin no tiene página propia
                final_url = str(resp.url)
                if final_url.rstrip('/') == 'https://www.coingecko.com':
                    logger.warning(f"[coins_sync] {coin_id} redirige a homepage, marcando como 'otros'")
                    async with pool.acquire() as conn:
                        await conn.execute("""
                            UPDATE coins SET cg_cats='[]', supercat='otros', updated_at=now()
                            WHERE id=$1
                        """, coin_id)
                    updated += 1
                    await asyncio.sleep(1.2)
                    continue

                soup     = BeautifulSoup(resp.text, "html.parser")
                cat_tags = soup.find_all("a", href=lambda x: x and "/en/categories/" in x)
                cg_cats  = [c.text.strip() for c in cat_tags if c.text.strip()]
                supercat = _assign_supercat(cg_cats)

                async with pool.acquire() as conn:
                    await conn.execute("""
                        UPDATE coins
                        SET cg_cats  = $1,
                            supercat = $2,
                            updated_at = now()
                        WHERE id = $3
                    """, json.dumps(cg_cats), supercat, coin_id)

                updated += 1

                if updated % 50 == 0:
                    logger.info(f"[coins_sync] Categorías: {updated}/{len(coin_ids)} procesadas")

                # Delay para no saturar CoinGecko
                await asyncio.sleep(1.2)

            except Exception as e:
                logger.error(f"[coins_sync] Error categorizando {coin_id}: {e}")
                errors += 1
                await asyncio.sleep(2)

    logger.info(f"[coins_sync] Sync categorías completo: {updated} OK, {errors} errores")
    return {"updated": updated, "errors": errors}
