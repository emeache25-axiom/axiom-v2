#!/usr/bin/env python3
"""
Validador de los canales WebSocket de CoinEx que usa el adaptador.
Prueba en vivo los tres métodos watch_* con ONTBTC y muestra qué llega, para
confirmar los nombres de canal/campos ANTES de confiar en el adaptador.

Canales a validar:
  - state.subscribe  → ¿precio en tiempo real? (para watch_price)
  - kline.subscribe  → ¿vela en vivo?          (para watch_candle)
  - depth.subscribe  → order book (ya validado con el capturador, se re-chequea)

Correr en el server:
    python3 validate_coinex_channels.py

Qué mirar: para cada canal, si llegan mensajes y con qué estructura. Si algún
canal no responde o tiene otros nombres de campo, se ajusta el adaptador.
"""
import asyncio, gzip, json
import websockets

WS = "wss://socket.coinex.com/v2/spot"
SYMBOL = "ONTBTC"


def decode(raw):
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw


async def probar_canal(nombre, sub_msg, metodo_update, max_msgs=2, espera=15):
    print(f"\n{'='*60}\n  Canal: {nombre}\n{'='*60}")
    print(f"  suscripción: {json.dumps(sub_msg)}")
    try:
        async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
            await ws.send(json.dumps(sub_msg))
            vistos = 0
            try:
                async with asyncio.timeout(espera):
                    async for raw in ws:
                        msg = json.loads(decode(raw))
                        method = msg.get("method", "(respuesta)")
                        if method == "(respuesta)":
                            print(f"  respuesta suscripción: {json.dumps(msg)[:200]}")
                            continue
                        if method == metodo_update:
                            print(f"  ✓ mensaje '{method}':")
                            print(f"    {json.dumps(msg, indent=2)[:700]}")
                            vistos += 1
                            if vistos >= max_msgs:
                                break
                        else:
                            print(f"  (otro método: {method})")
            except asyncio.TimeoutError:
                if vistos == 0:
                    print(f"  ✗ TIMEOUT: no llegó ningún '{metodo_update}' en {espera}s")
    except Exception as e:
        print(f"  ✗ ERROR: {type(e).__name__}: {e}")


async def main():
    # 1. Precio en tiempo real — probamos state.subscribe
    await probar_canal(
        "state (precio RT)",
        {"method": "state.subscribe", "params": {"market_list": [SYMBOL]}, "id": 1},
        "state.update",
    )
    # 2. Vela en vivo — probamos kline.subscribe
    await probar_canal(
        "kline (vela RT)",
        {"method": "kline.subscribe", "params": {"market": SYMBOL, "period": "1min"}, "id": 1},
        "kline.update",
    )
    # 3. Order book — depth.subscribe (ya validado, control)
    await probar_canal(
        "depth (order book, control)",
        {"method": "depth.subscribe", "params": {"market_list": [[SYMBOL, 10, "0", True]]}, "id": 1},
        "depth.update",
    )
    print("\n\nRESUMEN: los canales que mostraron '✓ mensaje' funcionan con los")
    print("nombres que asumí. Los que dieron '✗ TIMEOUT' usan otro nombre/estructura")
    print("y hay que corregirlos en el adaptador antes de usarlos.")


if __name__ == "__main__":
    asyncio.run(main())
