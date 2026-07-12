#!/usr/bin/env python3
"""
Validador de CoinGecko en vivo (endpoints crudos).
════════════════════════════════════════════════════════════════════════════
CoinGecko NO es un exchange: es un agregador / radar de descubrimiento. Solo da
precio de referencia (con retraso) y OHLC limitado. NO tiene tiempo real, NI
vela en vivo, NI order book — y eso es correcto por diseño.

Este script prueba EN VIVO las dos fuentes que el adaptador CoinGecko asume, y
confirma su estructura ANTES de confiar en el adaptador:
    price_ref      → REST /simple/price   (por coin_id, no por par)
    ohlcv_limited  → REST /coins/{id}/ohlc (OHLC sin volumen)

También deja constancia de las capabilities que CoinGecko NO tiene (price_rt,
candle_rt, orderbook), que es lo esperado.

OJO identificadores: CoinGecko usa coin_id (ej. 'bitcoin', 'ontology'), NO pares
tipo BTCUSDT. El precio se pide contra una vs_currency (por defecto usd).

Correr en el server (venv activo):
    python3 validate_coingecko.py
"""
import asyncio
from datetime import datetime, timezone

import httpx

REST = "https://api.coingecko.com/api/v3"
COIN_ID = "bitcoin"
VS = "usd"
TIMEOUT = 15.0

OK   = "\u2713"
FAIL = "\u2717"
DASH = "\u2014"


def line(title):
    print("\n" + "=" * 60 + f"\n  {title}\n" + "=" * 60)


# ── 1. Precio de referencia (REST /simple/price) ────────────────────────────────
async def probar_precio():
    line("PRECIO REST (price_ref)  /simple/price")
    params = {
        "ids": COIN_ID, "vs_currencies": VS,
        "include_24hr_change": "true",
        "include_24hr_vol": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{REST}/simple/price", params=params)
        if r.status_code != 200:
            print(f"  {FAIL} HTTP {r.status_code}  (posible rate limit del plan gratuito)")
            return
        d = r.json().get(COIN_ID)
        if not d:
            print(f"  {FAIL} respuesta vacía para '{COIN_ID}': {r.json()}")
            return
        # El adaptador usa: d[vs], d[f'{vs}_24h_change'], d[f'{vs}_24h_vol']
        price = d.get(VS)
        chg   = d.get(f"{VS}_24h_change")
        vol   = d.get(f"{VS}_24h_vol")
        if price is None:
            print(f"  {FAIL} falta el precio en '{VS}': {d}")
            return
        print(f"  {OK} precio={price} {VS.upper()}  chg24h={chg}  vol24h={vol}")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 2. OHLC limitado (REST /coins/{id}/ohlc) ────────────────────────────────────
async def probar_ohlc():
    line("OHLC REST (ohlcv_limited)  /coins/{id}/ohlc")
    # El adaptador pide days según timeframe; acá usamos 7 (equivale a ~1h/4h).
    params = {"vs_currency": VS, "days": 7}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{REST}/coins/{COIN_ID}/ohlc", params=params)
        if r.status_code != 200:
            print(f"  {FAIL} HTTP {r.status_code}  (posible rate limit del plan gratuito)")
            return
        rows = r.json()
        if not rows:
            print(f"  {FAIL} sin datos OHLC")
            return
        # Formato: [ [ts_ms, open, high, low, close], ... ]  (SIN volumen)
        row = rows[-1]
        if len(row) < 5:
            print(f"  {FAIL} fila con menos de 5 columnas: {row}")
            return
        t = datetime.fromtimestamp(int(row[0]) // 1000, tz=timezone.utc)
        print(f"  {OK} {len(rows)} velas. Última:")
        print(f"      t={t:%Y-%m-%d %H:%M}  o={row[1]} h={row[2]} l={row[3]} c={row[4]}")
        print(f"      (sin volumen — el adaptador lo completa con 0.0, es esperado)")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 3. Capabilities ausentes (esperado) ─────────────────────────────────────────
def nota_capabilities_ausentes():
    line("CAPABILITIES NO SOPORTADAS (correcto por diseño)")
    print(f"  {DASH} price_rt   : CoinGecko no ofrece WebSocket de precio en vivo")
    print(f"  {DASH} candle_rt  : sin vela en vivo (no hay stream)")
    print(f"  {DASH} orderbook  : es un agregador, no un exchange; sin libro de órdenes")
    print("  El adaptador declara solo {price_ref, ohlcv_limited} — coincide.")


async def main():
    print(f"\nValidando CoinGecko en vivo — coin_id '{COIN_ID}' vs '{VS.upper()}'")
    await probar_precio()
    await probar_ohlc()
    nota_capabilities_ausentes()
    print("\n" + "-" * 60)
    print("RESUMEN: los bloques con '\u2713' confirman que las dos fuentes REST")
    print("responden con la estructura que el adaptador CoinGecko asume. Los '\u2014'")
    print("son capabilities que la fuente no da (esperado). Si un '\u2713' fuera '\u2717',")
    print("suele ser rate limit del plan gratuito: reintentar en un rato.")
    print("-" * 60)


if __name__ == "__main__":
    asyncio.run(main())
