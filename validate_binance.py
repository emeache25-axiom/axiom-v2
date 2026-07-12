#!/usr/bin/env python3
"""
Validador de Binance en vivo (endpoints crudos).
════════════════════════════════════════════════════════════════════════════
Binance es NO operable en AXIOM, pero da datos completos (precio, velas, order
book, tiempo real). Este script prueba EN VIVO las fuentes que el adaptador
Binance asume, y confirma que la estructura de respuesta es la esperada ANTES
de confiar en el adaptador.

Cubre las capabilities declaradas por el adaptador:
    price_ref / price_rt   → REST 24hr + WS @ticker
    ohlcv                  → REST /klines
    candle_rt              → WS @kline_<interval>
    orderbook              → REST /depth

No importa el adaptador: prueba los endpoints crudos (como validate_mexc_proto).
Si algún campo cambió de nombre o la estructura difiere, se ve acá y se corrige
el adaptador.

Correr en el server (venv activo):
    python3 validate_binance.py
"""
import asyncio
import json
from datetime import datetime, timezone

import httpx

try:
    import websockets
except ImportError:
    websockets = None

REST = "https://api.binance.com"
WS   = "wss://stream.binance.com:9443/ws"
SYMBOL = "BTCUSDT"
INTERVAL = "1m"          # para klines REST y kline WS
TIMEOUT = 10.0

OK   = "\u2713"
FAIL = "\u2717"


def line(title):
    print("\n" + "=" * 60 + f"\n  {title}\n" + "=" * 60)


# ── 1. Precio de referencia (REST 24hr) ─────────────────────────────────────────
async def probar_precio_rest():
    line("PRECIO REST (price_ref)  /api/v3/ticker/24hr")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{REST}/api/v3/ticker/24hr", params={"symbol": SYMBOL})
        if r.status_code != 200:
            print(f"  {FAIL} HTTP {r.status_code}")
            return
        d = r.json()
        # Campos que el adaptador usa: lastPrice, bidPrice, askPrice,
        # priceChangePercent, highPrice, lowPrice, quoteVolume
        req = ["lastPrice", "bidPrice", "askPrice", "priceChangePercent",
               "highPrice", "lowPrice", "quoteVolume"]
        faltan = [k for k in req if k not in d]
        if faltan:
            print(f"  {FAIL} faltan campos: {faltan}")
        else:
            print(f"  {OK} precio={d['lastPrice']}  chg24h={d['priceChangePercent']}%  "
                  f"vol={d['quoteVolume']}")
            print(f"      bid={d['bidPrice']}  ask={d['askPrice']}  "
                  f"high={d['highPrice']}  low={d['lowPrice']}")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 2. Velas históricas (REST /klines) ──────────────────────────────────────────
async def probar_klines():
    line("VELAS REST (ohlcv)  /api/v3/klines")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{REST}/api/v3/klines",
                            params={"symbol": SYMBOL, "interval": INTERVAL, "limit": 3})
        if r.status_code != 200:
            print(f"  {FAIL} HTTP {r.status_code}")
            return
        rows = r.json()
        if not rows:
            print(f"  {FAIL} sin velas")
            return
        # Formato: [openTime_ms, o, h, l, c, v, closeTime, ...]
        # El adaptador toma row[0]//1000, row[1..5]
        row = rows[-1]
        t = datetime.fromtimestamp(row[0] // 1000, tz=timezone.utc)
        print(f"  {OK} {len(rows)} velas. Última:")
        print(f"      t={t:%Y-%m-%d %H:%M}  o={row[1]} h={row[2]} l={row[3]} "
              f"c={row[4]} v={row[5]}")
        if len(row) < 6:
            print(f"  {FAIL} la fila tiene menos de 6 columnas: {row}")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 3. Order book (REST /depth) ─────────────────────────────────────────────────
async def probar_orderbook():
    line("ORDER BOOK REST (orderbook)  /api/v3/depth")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{REST}/api/v3/depth",
                            params={"symbol": SYMBOL, "limit": 5})
        if r.status_code != 200:
            print(f"  {FAIL} HTTP {r.status_code}")
            return
        d = r.json()
        bids = d.get("bids", [])
        asks = d.get("asks", [])
        if not bids or not asks:
            print(f"  {FAIL} sin bids/asks (bids={len(bids)} asks={len(asks)})")
            return
        print(f"  {OK} bids={len(bids)}  asks={len(asks)}")
        print(f"      mejor bid={bids[0]}  mejor ask={asks[0]}")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 4. Precio en tiempo real (WS @ticker) ───────────────────────────────────────
async def probar_ws_ticker(espera=15):
    line("PRECIO WS (price_rt)  @ticker")
    if websockets is None:
        print(f"  {FAIL} falta la librería 'websockets'")
        return
    stream = f"{SYMBOL.lower()}@ticker"
    try:
        async with websockets.connect(f"{WS}/{stream}", ping_interval=20,
                                       max_size=2**22) as ws:
            n = 0
            async with asyncio.timeout(espera):
                async for raw in ws:
                    try:
                        d = json.loads(raw)
                    except Exception:
                        continue
                    if d.get("e") != "24hrTicker":
                        continue
                    # El adaptador usa: c, b, a, P, h, l, q, E
                    print(f"  {OK} tick: precio(c)={d['c']}  chg(P)={d['P']}%  "
                          f"bid(b)={d['b']}  ask(a)={d['a']}")
                    n += 1
                    if n >= 2:
                        break
            if n == 0:
                print(f"  {FAIL} TIMEOUT: no llegó ningún 24hrTicker en {espera}s")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


# ── 5. Vela en vivo (WS @kline) ─────────────────────────────────────────────────
async def probar_ws_kline(espera=15):
    line("VELA EN VIVO WS (candle_rt)  @kline_" + INTERVAL)
    if websockets is None:
        print(f"  {FAIL} falta la librería 'websockets'")
        return
    stream = f"{SYMBOL.lower()}@kline_{INTERVAL}"
    try:
        async with websockets.connect(f"{WS}/{stream}", ping_interval=20,
                                       max_size=2**22) as ws:
            n = 0
            async with asyncio.timeout(espera):
                async for raw in ws:
                    try:
                        d = json.loads(raw)
                    except Exception:
                        continue
                    if d.get("e") != "kline":
                        continue
                    k = d["k"]
                    # El adaptador usa: k.t, k.o, k.h, k.l, k.c, k.v
                    t = datetime.fromtimestamp(k["t"] // 1000, tz=timezone.utc)
                    print(f"  {OK} vela en curso: t={t:%H:%M}  o={k['o']} h={k['h']} "
                          f"l={k['l']} c={k['c']} v={k['v']}  cerrada={k['x']}")
                    n += 1
                    if n >= 2:
                        break
            if n == 0:
                print(f"  {FAIL} TIMEOUT: no llegó ninguna kline en {espera}s")
    except Exception as e:
        print(f"  {FAIL} {type(e).__name__}: {e}")


async def main():
    print(f"\nValidando Binance en vivo — símbolo {SYMBOL}, intervalo {INTERVAL}")
    await probar_precio_rest()
    await probar_klines()
    await probar_orderbook()
    await probar_ws_ticker()
    await probar_ws_kline()
    print("\n" + "-" * 60)
    print("RESUMEN: cada bloque con '\u2713' confirma que esa fuente responde con la")
    print("estructura que el adaptador Binance asume. Un '\u2717' indica que hay que")
    print("ajustar el adaptador (nombre de campo / estructura / disponibilidad).")
    print("-" * 60)


if __name__ == "__main__":
    asyncio.run(main())
