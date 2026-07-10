#!/usr/bin/env python3
"""
Sonda exhaustiva: ¿CoinEx v2 spot tiene ALGÚN canal de kline por WebSocket?
Prueba varias combinaciones de nombre de método y formato de params contra
wss://socket.coinex.com/v2/spot, y reporta cuál (si alguna) responde OK.

Correr en el server (con venv activo):
    python3 probe_coinex_kline.py
"""
import asyncio, gzip, json
import websockets

WS = "wss://socket.coinex.com/v2/spot"
SYMBOL = "BTCUSDT"   # usamos un par muy líquido para maximizar respuesta


def decode(raw):
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw


# Variantes a probar: (descripción, mensaje de suscripción)
VARIANTES = [
    ("kline.subscribe + params dict market/period",
     {"method": "kline.subscribe", "params": {"market": SYMBOL, "period": "1min"}, "id": 1}),
    ("kline.subscribe + params dict market/period(60)",
     {"method": "kline.subscribe", "params": {"market": SYMBOL, "period": 60}, "id": 1}),
    ("kline.subscribe + params list [market, period]",
     {"method": "kline.subscribe", "params": [SYMBOL, 60], "id": 1}),
    ("kline.subscribe + market_list",
     {"method": "kline.subscribe", "params": {"market_list": [[SYMBOL, "1min"]]}, "id": 1}),
    ("candlestick.subscribe",
     {"method": "candlestick.subscribe", "params": {"market": SYMBOL, "period": "1min"}, "id": 1}),
    ("candle.subscribe",
     {"method": "candle.subscribe", "params": {"market": SYMBOL, "period": "1min"}, "id": 1}),
    ("kline.query (request/response, no push)",
     {"method": "kline.query", "params": {"market": SYMBOL, "period": "1min", "limit": 2}, "id": 1}),
    ("deals.subscribe (control: sabemos que existe)",
     {"method": "deals.subscribe", "params": {"market_list": [SYMBOL]}, "id": 1}),
]


async def probar(desc, msg, espera=6):
    print(f"\n--- {desc} ---")
    print(f"    → {json.dumps(msg)}")
    try:
        async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
            await ws.send(json.dumps(msg))
            try:
                async with asyncio.timeout(espera):
                    async for raw in ws:
                        m = json.loads(decode(raw))
                        # respuesta a la suscripción (tiene 'id' y 'code')
                        if "code" in m and m.get("id") is not None:
                            code = m.get("code")
                            if code == 0:
                                print(f"    ✓ ACEPTADO (code 0): {json.dumps(m)[:150]}")
                            else:
                                print(f"    ✗ rechazado (code {code}): {m.get('message')}")
                            return code == 0
                        # o un push directo
                        if m.get("method"):
                            print(f"    ✓ PUSH recibido: method={m['method']}")
                            return True
            except asyncio.TimeoutError:
                print(f"    ? sin respuesta clara en {espera}s")
                return None
    except Exception as e:
        print(f"    ✗ ERROR conexión: {type(e).__name__}: {e}")
        return None


async def main():
    print(f"Sondeando {WS} en busca de canal kline...\n")
    aceptados = []
    for desc, msg in VARIANTES:
        ok = await probar(desc, msg)
        if ok:
            aceptados.append(desc)
        await asyncio.sleep(0.5)

    print("\n" + "=" * 60)
    if aceptados:
        print("VARIANTES ACEPTADAS:")
        for a in aceptados:
            print(f"  ✓ {a}")
        print("\nSi alguna kline.* fue aceptada, CoinEx SÍ tiene kline por WS.")
    else:
        print("NINGUNA variante de kline fue aceptada.")
        print("Confirmado: CoinEx v2 spot NO tiene kline por WebSocket.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
