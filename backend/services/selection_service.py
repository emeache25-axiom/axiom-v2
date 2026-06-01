"""
AXIOM v2 — Selección de Activos
Sugiere activos para largo / medio / corto basado en el régimen actual.
Usa la tabla local `coins` + `snapshots` + `signal_readings` (PostgreSQL).
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

LARGO_IDS = ["bitcoin", "ethereum", "solana"]

EXCLUDE_IDS = {
    "tether","usd-coin","dai","binance-usd","trueusd","frax","usdd",
    "pax-dollar","gemini-dollar","liquity-usd","first-digital-usd",
    "paypal-usd","usde","ethena-usde","usd1","rlusd","eurc",
    "wrapped-bitcoin","wrapped-ethereum","wrapped-steth","staked-ether",
    "coinbase-wrapped-btc","rocket-pool-eth","wrapped-eeth",
    "bitcoin","ethereum","solana",
}
EXCLUDE_SYMBOLS = {
    "usdt","usdc","busd","dai","tusd","frax","usdd","usdp",
    "pyusd","usde","usd1","rlusd","eurc",
}


# ── Largo Plazo ───────────────────────────────────────────────────────────────

def _largo_signal(coin: dict, regime: str, signals: dict) -> dict:
    mvrv     = signals.get("mvrv_zscore")
    fg_value = signals.get("fear_greed", 0) or 0
    btc_fund = signals.get("funding_btc", 0) or 0
    eth_fund = signals.get("funding_eth", 0) or 0
    avg_fund = (btc_fund + eth_fund) / 2

    conditions = {
        "regimen_alcista": regime in ("ALCISTA_A", "ALCISTA_B"),
        "mvrv_positivo":   mvrv is not None and mvrv > 0,
        "funding_neutro":  avg_fund >= -0.01,
        "sentimiento_ok":  fg_value >= 40,
    }
    met = sum(conditions.values())

    if regime == "BAJISTA":
        status = "Sin señal — Mercado bajista"
    elif met < 2:
        status = "Esperando confirmación de suelo"
    elif met == 2:
        status = "Señal débil — Faltan confirmaciones"
    elif met == 3:
        status = "Señal de entrada — Suelo confirmado"
    else:
        status = "Señal fuerte — Todas las condiciones"

    return {**coin, "has_signal": met >= 3, "status": status,
            "conditions_met": met, "conditions": conditions}


# ── Medio Plazo ───────────────────────────────────────────────────────────────

def _score_medio(coin: dict):
    chg7d = coin.get("change_7d") or 0
    vol   = coin.get("volume_24h") or 0
    mcap  = coin.get("market_cap") or 1
    if chg7d < 15:
        return None
    vol_ratio = vol / mcap if mcap > 0 else 0
    if vol_ratio < 0.05:
        return None
    return round(chg7d * (1 + min(vol_ratio, 1.0)), 2)


# ── Corto Plazo ───────────────────────────────────────────────────────────────

def _score_corto(coin: dict):
    chg24h = abs(coin.get("change_24h") or 0)
    chg7d  = abs(coin.get("change_7d")  or 0)
    if chg24h < 3 or chg7d < 3:
        return None
    return round((chg24h * 0.6) + (chg7d / 7 * 0.4), 2)


# ── Contexto de régimen ───────────────────────────────────────────────────────

def _regime_context(regime: str) -> dict:
    ctx = {
        "ACUMULACION": {
            "summary":    "Mercado en zona de suelo — aún sin confirmar giro",
            "largo_note": "Esperar confirmación antes de entrar. El suelo puede extenderse.",
            "medio_note": "Catalizadores existen pero el contexto macro pesa. Tamaños reducidos.",
            "corto_note": "Riesgo elevado. Solo setups muy definidos con stop ajustado.",
            "risk_level": "ALTO",
        },
        "ALCISTA_A": {
            "summary":    "Giro confirmado — recuperación temprana",
            "largo_note": "Zona óptima de entrada en largo. BTC lidera, altcoins dormidas aún.",
            "medio_note": "Primeros catalizadores aparecen. Priorizar proyectos sólidos.",
            "corto_note": "Momentum creciente. Volatilidad estructural se amplía.",
            "risk_level": "MODERADO",
        },
        "ALCISTA_B": {
            "summary":    "Bull market en desarrollo — euforia creciente",
            "largo_note": "Mantener posiciones. Evitar nuevas entradas en zonas extendidas.",
            "medio_note": "Mejor fase para swing. Altcoins superan a BTC.",
            "corto_note": "Alta volatilidad. Toma de ganancias parciales en extensiones.",
            "risk_level": "MODERADO-BAJO",
        },
        "DISTRIBUCION": {
            "summary":    "Smart money saliendo — señales de techo",
            "largo_note": "Sin nuevas entradas. Evaluar reducción gradual.",
            "medio_note": "Solo catalizadores muy fuertes. Stop loss ajustados.",
            "corto_note": "Extrema precaución. El mercado puede revertir rápido.",
            "risk_level": "MUY ALTO",
        },
        "BAJISTA": {
            "summary":    "Bear market — capital en stablecoins",
            "largo_note": "Sin señal de entrada. Acumular paciencia.",
            "medio_note": "Sin operaciones de swing. El tiempo juega en contra.",
            "corto_note": "Solo traders muy experimentados. Alta probabilidad de trampa.",
            "risk_level": "EXTREMO",
        },
        "LATERAL": {
            "summary":    "Mercado sin dirección clara — rango definido",
            "largo_note": "Acumular en soportes si el precio es atractivo.",
            "medio_note": "Catalizadores puntuales pueden funcionar. Stops ajustados.",
            "corto_note": "Range trading entre extremos. Definir niveles antes de entrar.",
            "risk_level": "MODERADO",
        },
    }
    return ctx.get(regime, ctx["ACUMULACION"])


# ── Función principal ─────────────────────────────────────────────────────────

async def get_asset_selection(db_pool) -> dict:
    async with db_pool.acquire() as conn:

        # Último snapshot
        snap = await conn.fetchrow("""
            SELECT id, regime_largo, regime_medio, regime_corto,
                   conviction_largo, conviction_medio, conviction_corto
            FROM snapshots
            ORDER BY created_at DESC
            LIMIT 1
        """)

        # Régimen principal = largo (visión macro)
        regime = snap["regime_largo"] if snap else "ACUMULACION"

        # Señales relevantes del último snapshot para evaluar largo plazo
        signals = {}
        if snap:
            sig_rows = await conn.fetch("""
                SELECT signal_id, raw_value
                FROM signal_readings
                WHERE snapshot_id = $1
            """, snap["id"])
            for row in sig_rows:
                signals[row["signal_id"]] = float(row["raw_value"]) if row["raw_value"] is not None else None

        # Timestamp de última actualización de coins
        coins_ts = await conn.fetchval("SELECT MAX(updated_at) FROM coins WHERE rank <= 300")

        # Largo: BTC, ETH, SOL
        largo_rows = await conn.fetch("""
            SELECT id, symbol, name, price, change_24h, change_7d,
                   volume_24h, market_cap, image
            FROM coins
            WHERE id = ANY($1::text[])
        """, LARGO_IDS)

        # Altcoins top 300
        alt_rows = await conn.fetch("""
            SELECT id, symbol, name, price, change_24h, change_7d,
                   volume_24h, market_cap, image, supercat
            FROM coins
            WHERE rank IS NOT NULL
              AND rank <= 300
              AND id          != ALL($1::text[])
              AND lower(symbol) != ALL($2::text[])
            ORDER BY rank ASC
        """, list(EXCLUDE_IDS), list(EXCLUDE_SYMBOLS))

    def to_dict(r):
        return {
            "id":         r["id"],
            "symbol":     r["symbol"].upper(),
            "name":       r["name"],
            "price":      float(r["price"])      if r["price"]      else None,
            "change_24h": float(r["change_24h"]) if r["change_24h"] else None,
            "change_7d":  float(r["change_7d"])  if r["change_7d"]  else None,
            "volume_24h": float(r["volume_24h"]) if r["volume_24h"] else None,
            "market_cap": float(r["market_cap"]) if r["market_cap"] else None,
            "image":      r["image"],
        }

    # ── Largo ────────────────────────────────────────────────────────────────
    largo_coins = [to_dict(r) for r in largo_rows]
    id_order    = {id_: i for i, id_ in enumerate(LARGO_IDS)}
    largo_coins.sort(key=lambda c: id_order.get(c["id"], 99))
    largo_results = [_largo_signal(c, regime, signals) for c in largo_coins]

    # ── Medio ────────────────────────────────────────────────────────────────
    medio_candidates = []
    for r in alt_rows:
        c     = to_dict(r)
        score = _score_medio(c)
        if score is not None:
            c["score"]    = score
            c["catalyst"] = f"+{round(c['change_7d'] or 0, 1)}% en 7d con volumen inusual"
            medio_candidates.append(c)
    medio_candidates.sort(key=lambda x: x["score"], reverse=True)
    medio_results = medio_candidates[:8]

    # ── Corto ────────────────────────────────────────────────────────────────
    corto_candidates = []
    for r in alt_rows:
        c     = to_dict(r)
        score = _score_corto(c)
        if score is not None:
            c["score"]           = score
            c["volatility_note"] = (
                f"Rango 24h ~{round(abs(c['change_24h'] or 0), 1)}% | "
                f"7d avg ~{round(abs(c['change_7d'] or 0) / 7, 1)}%/día"
            )
            corto_candidates.append(c)
    corto_candidates.sort(key=lambda x: x["score"], reverse=True)
    corto_results = corto_candidates[:8]

    # Regímenes por timeframe para mostrar en frontend
    regimes_by_tf = {}
    if snap:
        regimes_by_tf = {
            "largo": snap["regime_largo"],
            "medio": snap["regime_medio"],
            "corto": snap["regime_corto"],
        }

    return {
        "regime":           regime,
        "regimes_by_tf":    regimes_by_tf,
        "last_updated":     datetime.now(timezone.utc).isoformat(),
        "coins_updated_at": coins_ts.isoformat() if coins_ts else None,
        "context":       _regime_context(regime),
        "largo": {
            "title":     "Largo Plazo — BTC, ETH, SOL",
            "horizon":   "12–36 meses",
            "technique": "DCA estructurado en zonas",
            "assets":    largo_results,
        },
        "medio": {
            "title":     "Medio Plazo — Altcoins con Catalizador",
            "horizon":   "2–12 semanas",
            "technique": "Swing por catalizador",
            "assets":    medio_results,
            "empty_msg": "Sin altcoins con catalizador claro en este momento",
        },
        "corto": {
            "title":     "Corto Plazo — Alta Volatilidad Estructural",
            "horizon":   "Horas a días",
            "technique": "Range trading con estructura",
            "assets":    corto_results,
            "empty_msg": "Sin altcoins con volatilidad estructural suficiente",
        },
    }
