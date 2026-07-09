#!/usr/bin/env python3
"""
Validador del parseo PROTOBUF de MEXC en vivo.
Se conecta al WS, recibe los bytes protobuf de deals y kline, los deserializa
con el wrapper compilado (_pb2), y muestra lo extraído. Confirma que el parseo
funciona ANTES de meterlo en el adaptador.

Correr DESDE la carpeta que contiene los _pb2.py (para que resuelvan sus imports):
    cd ~/apps/axiom-v2/backend/exchanges/_mexc_proto
    python3 validate_mexc_proto.py
"""
import asyncio, json, sys, os

# los _pb2.py están en este mismo directorio; asegurar que se encuentren
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import websockets
import PushDataV3ApiWrapper_pb2 as wrapper_pb2

WS = "wss://wbs-api.mexc.com/ws"
SYMBOL = "BTCUSDT"


async def probar_deals(espera=12):
    print("\n" + "="*60 + "\n  DEALS (precio en vivo)\n" + "="*60)
    canal = f"spot@public.aggre.deals.v3.api.pb@100ms@{SYMBOL}"
    async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
        await ws.send(json.dumps({"method": "SUBSCRIPTION", "params": [canal]}))
        n = 0
        try:
            async with asyncio.timeout(espera):
                async for raw in ws:
                    if isinstance(raw, str):
                        # respuesta de suscripción (JSON)
                        print(f"  sub: {raw[:120]}")
                        continue
                    # bytes → deserializar con el wrapper
                    msg = wrapper_pb2.PushDataV3ApiWrapper()
                    msg.ParseFromString(raw)
                    which = msg.WhichOneof("body")
                    if which == "publicAggreDeals":
                        deals = msg.publicAggreDeals.deals
                        for d in deals[:3]:
                            tt = "compra" if d.tradeType == 1 else "venta"
                            print(f"  ✓ deal: precio={d.price} qty={d.quantity} tipo={tt} t={d.time} sym={msg.symbol}")
                        n += 1
                        if n >= 2:
                            break
        except asyncio.TimeoutError:
            if n == 0:
                print("  ✗ sin deals parseados")


async def probar_kline(espera=12):
    print("\n" + "="*60 + "\n  KLINE (vela en vivo)\n" + "="*60)
    canal = f"spot@public.kline.v3.api.pb@{SYMBOL}@Min1"
    async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
        await ws.send(json.dumps({"method": "SUBSCRIPTION", "params": [canal]}))
        n = 0
        try:
            async with asyncio.timeout(espera):
                async for raw in ws:
                    if isinstance(raw, str):
                        print(f"  sub: {raw[:120]}")
                        continue
                    msg = wrapper_pb2.PushDataV3ApiWrapper()
                    msg.ParseFromString(raw)
                    which = msg.WhichOneof("body")
                    if which == "publicSpotKline":
                        k = msg.publicSpotKline
                        print(f"  ✓ vela: int={k.interval} start={k.windowStart} "
                              f"O={k.openingPrice} H={k.highestPrice} L={k.lowestPrice} "
                              f"C={k.closingPrice} vol={k.volume} sym={msg.symbol}")
                        n += 1
                        if n >= 2:
                            break
        except asyncio.TimeoutError:
            if n == 0:
                print("  ✗ sin velas parseadas")


async def main():
    await probar_deals()
    await probar_kline()
    print("\nSi viste '✓ deal' y '✓ vela' con valores, el parseo protobuf funciona.")


if __name__ == "__main__":
    asyncio.run(main())
