"""
Orquestador del módulo Régimen — AXIOM v2.

Une las 4 capas:
  Capa 1 (fuentes)  → trae datos crudos de APIs externas
  Capa 2 (señales)  → calcula y clasifica señales
  Capa 3 (régimen)  → calcula los 3 regímenes
  Guarda el snapshot en PostgreSQL y lo devuelve.

Este es el único archivo donde las capas se hablan entre sí.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone

import asyncpg

from backend.data.binance import (
    fetch_funding_btc,
    fetch_candles,
)
from backend.data.coingecko import (
    fetch_global,
    fetch_btc_vs_ath,
)
from backend.data.coinmarketcap import (
    fetch_cycle_indicators,
    fetch_pi_cycle,
)
from backend.data.alternative_me import fetch_fear_greed
from backend.services.signals import (
    classify_all,
    calc_mayer_multiple,
    calc_price_vs_ma50,
    calc_price_vs_ema20,
    calc_volume_relative,
)
from backend.services.regime import calculate_regimes


async def build_snapshot(pool: asyncpg.Pool) -> dict:
    """
    Construye un snapshot completo del régimen y lo guarda en PostgreSQL.

    Args:
        pool: pool de conexiones a PostgreSQL (de app.state.db_pool)

    Returns:
        dict con el snapshot completo (regímenes + señales + metadata)
    """

    # ── PASO 1: Fetch en paralelo ────────────────────────────────────────
    (
        funding_btc,
        global_data,
        btc_vs_ath,
        cycle_indicators,
        pi_cycle,
        fear_greed,
        candles_daily,
        candles_4h,
    ) = await asyncio.gather(
        fetch_funding_btc(),
        fetch_global(),
        fetch_btc_vs_ath(),
        fetch_cycle_indicators(),
        fetch_pi_cycle(),
        fetch_fear_greed(),
        fetch_candles("1d", limit=250),   # 250 velas diarias para MA200
        fetch_candles("4h", limit=100),   # 100 velas 4h para EMA20 y volumen
        return_exceptions=False,
    )

    # ── PASO 2: Extraer valores de los dicts de fuentes ──────────────────
    btc_dominance  = global_data.get("btc_dominance")  if global_data  else None
    vol_mcap_ratio = global_data.get("vol_mcap_ratio") if global_data  else None

    mvrv_zscore    = cycle_indicators.get("mvrv_zscore")    if cycle_indicators else None
    nupl           = cycle_indicators.get("nupl")            if cycle_indicators else None
    lth_supply     = cycle_indicators.get("lth_supply")      if cycle_indicators else None
    mvrv_ratio     = cycle_indicators.get("mvrv_ratio")      if cycle_indicators else None
    puell_multiple = cycle_indicators.get("puell_multiple")  if cycle_indicators else None
    reserve_risk   = cycle_indicators.get("reserve_risk")    if cycle_indicators else None
    rhodl_ratio    = cycle_indicators.get("rhodl_ratio")     if cycle_indicators else None
    mayer_raw      = cycle_indicators.get("mayer_multiple")  if cycle_indicators else None
    cbbi           = cycle_indicators.get("cbbi")            if cycle_indicators else None
    sth_supply_pct = cycle_indicators.get("sth_supply_pct") if cycle_indicators else None

    # ── PASO 3: Calcular señales que necesitan velas ─────────────────────
    mayer_multiple  = calc_mayer_multiple(candles_daily) if candles_daily else None
    price_vs_ma50   = calc_price_vs_ma50(candles_daily)  if candles_daily else None
    price_vs_ema20  = calc_price_vs_ema20(candles_4h)    if candles_4h   else None
    volume_relative = calc_volume_relative(candles_4h)   if candles_4h   else None

    # Precio de BTC para el snapshot (última vela diaria)
    btc_price = candles_daily[-1]["close"] if candles_daily else None

    # ── PASO 4: Clasificar todas las señales ─────────────────────────────
    signals = classify_all(
        mvrv_zscore=mvrv_zscore,
        mayer_multiple=mayer_multiple,
        nupl=nupl,
        lth_supply=lth_supply,
        btc_vs_ath=btc_vs_ath,
        price_vs_ma50=price_vs_ma50,
        fear_greed=fear_greed,
        btc_dominance=btc_dominance,
        vol_mcap_ratio=vol_mcap_ratio,
        price_vs_ema20=price_vs_ema20,
        funding_btc=funding_btc,
        volume_relative=volume_relative,
        mvrv_ratio=mvrv_ratio,
        puell_multiple=puell_multiple,
        reserve_risk=reserve_risk,
        rhodl_ratio=rhodl_ratio,
        cbbi=cbbi,
        sth_supply_pct=sth_supply_pct,
        pi_cycle=pi_cycle,
    )

    # ── PASO 5: Calcular los 3 regímenes ─────────────────────────────────
    regimes = calculate_regimes(signals)
    r_largo = regimes["largo"]
    r_medio = regimes["medio"]
    r_corto = regimes["corto"]

    # ── PASO 6: Guardar en PostgreSQL ────────────────────────────────────
    snapshot_id = None
    if btc_price is not None:
        async with pool.acquire() as conn:
            # Insertar snapshot
            snapshot_id = await conn.fetchval("""
                INSERT INTO snapshots (
                    btc_price,
                    regime_largo,  conviction_largo,  consensus_largo,  confirmed_largo,
                    regime_medio,  conviction_medio,  consensus_medio,  confirmed_medio,
                    regime_corto,  conviction_corto,  consensus_corto,  confirmed_corto
                ) VALUES (
                    $1,
                    $2,  $3,  $4,  $5,
                    $6,  $7,  $8,  $9,
                    $10, $11, $12, $13
                ) RETURNING id
            """,
                btc_price,
                r_largo["regime"], r_largo["conviction"], r_largo["consensus"], r_largo["is_confirmed"],
                r_medio["regime"], r_medio["conviction"], r_medio["consensus"], r_medio["is_confirmed"],
                r_corto["regime"], r_corto["conviction"], r_corto["consensus"], r_corto["is_confirmed"],
            )

            # Insertar señales
            if snapshot_id:
                rows = [
                    (
                        snapshot_id,
                        s["signal_id"],
                        s["timeframe"],
                        s["dimension"],
                        s["is_core"],
                        s["raw_value"],
                        s["voted_regime"],
                    )
                    for s in signals
                ]
                await conn.executemany("""
                    INSERT INTO signal_readings
                        (snapshot_id, signal_id, timeframe, dimension, is_core, raw_value, voted_regime)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, rows)

    # ── PASO 7: Armar y devolver el snapshot ─────────────────────────────
    return {
        "snapshot_id":  snapshot_id,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "btc_price":    btc_price,
        "regimes": {
            "largo": r_largo,
            "medio": r_medio,
            "corto": r_corto,
        },
        "signals": signals,
    }
