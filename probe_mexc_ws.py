#!/usr/bin/env python3
"""
Sonda del WebSocket de MEXC (wbs-api.mexc.com/ws).
Objetivo: ver QUÉ formato entrega cada canal (JSON vs protobuf binario) y cuáles
responden, ANTES de escribir el parser. Si algún canal de precio da JSON, nos
ahorramos el protobuf.

Prueba:
  - miniTicker (precio) con y sin sufijo .pb
  - deals (trades) con y sin .pb
  - detecta si el mensaje es JSON (texto) o binario (protobuf)

Correr en el server (venv activo):
    python3 probe_mexc_ws.py
"""
import asyncio, json
import websockets

WS = "wss://wbs-api.mexc.com/ws"
SYMBOL = "BTCUSDT"


def clasificar(raw):
    """¿El mensaje es JSON de texto o binario protobuf?"""
    if isinstance(raw, bytes):
        # ¿es texto UTF-8 válido que parsea como JSON?
        try:
            s = raw.decode("utf-8")
            json.loads(s)
            return ("JSON(bytes)", s[:300])
        except Exception:
            return ("BINARIO/protobuf", f"{len(raw)} bytes: {raw[:40].hex()}")
    else:
        try:
            json.loads(raw)
            return ("JSON(str)", raw[:300])
        except Exception:
            return ("TEXTO no-JSON", str(raw)[:200])


async def probar(canal, espera=8):
    print(f"\n{'='*60}\n  Canal: {canal}\n{'='*60}")
    sub = {"method": "SUBSCRIPTION", "params": [canal]}
    try:
        async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
            await ws.send(json.dumps(sub))
            n = 0
            try:
                async with asyncio.timeout(espera):
                    async for raw in ws:
                        tipo, muestra = clasificar(raw)
                        # la respuesta de suscripción suele ser JSON con id/code/msg
                        if tipo.startswith("JSON"):
                            try:
                                d = json.loads(raw if isinstance(raw, str) else raw.decode())
                                if "code" in d and "msg" in d:
                                    print(f"  respuesta suscripción: {json.dumps(d)[:150]}")
                                    if d.get("code") != 0:
                                        print(f"  ✗ suscripción rechazada")
                                        return
                                    continue
                            except Exception:
                                pass
                        n += 1
                        print(f"  push #{n}: tipo={tipo}")
                        print(f"    muestra: {muestra}")
                        if n >= 2:
                            break
            except asyncio.TimeoutError:
                if n == 0:
                    print(f"  ? sin datos en {espera}s (¿canal inválido o sin actividad?)")
    except Exception as e:
        print(f"  ✗ ERROR: {type(e).__name__}: {e}")


async def main():
    # Canales protobuf oficiales (con .pb)
    await probar(f"spot@public.aggre.deals.v3.api.pb@100ms@{SYMBOL}")
    await probar(f"spot@public.kline.v3.api.pb@{SYMBOL}@Min1")
    # Intentos SIN .pb (por si acepta JSON legacy)
    await probar(f"spot@public.deals.v3.api@{SYMBOL}")
    await probar(f"spot@public.miniTicker.v3.api@{SYMBOL}@UTC+8")
    print("\n\nRESUMEN:")
    print("- Si algún canal mostró tipo=JSON → podemos usar ese sin protobuf.")
    print("- Si todos los de precio son BINARIO/protobuf → hay que parsear protobuf")
    print("  (los .proto están en github.com/mexcdevelop/websocket-proto).")


if __name__ == "__main__":
    asyncio.run(main())
