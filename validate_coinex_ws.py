#!/usr/bin/env python3
"""
Validador del WebSocket de order book de CoinEx v2.
NO integra nada a AXIOM. Solo conecta, se suscribe a la profundidad de ONTBTC y
ROSEBTC, e imprime los primeros mensajes CRUDOS para confirmar la estructura real
del mensaje depth.update ANTES de confiar en el parser del capturador.

CoinEx comprime los mensajes del WebSocket con GZIP a nivel de aplicación:
cada mensaje llega como bytes y hay que descomprimirlo con gzip antes de parsear.

Correr en el server de Migue:
    python3 validate_coinex_ws.py
"""
import asyncio, json, gzip
import websockets

URL = "wss://socket.coinex.com/v2/spot"
PAIRS = ["ONTBTC", "ROSEBTC"]


def _decode(raw):
    """CoinEx manda gzip. Si llega bytes, descomprimir; si llega str, usar directo."""
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw


async def main():
    async with websockets.connect(URL, ping_interval=None) as ws:
        sub = {
            "method": "depth.subscribe",
            "params": {"market_list": [[p, 10, "0", True] for p in PAIRS]},
            "id": 1,
        }
        await ws.send(json.dumps(sub))
        print(f">>> suscripto a {PAIRS}\n")
        count = 0
        depth_count = 0
        async for raw in ws:
            count += 1
            try:
                msg = json.loads(_decode(raw))
            except Exception as e:
                print(f"--- mensaje #{count}: no se pudo parsear ({e}) ---")
                print(repr(raw)[:200]); print()
                continue
            method = msg.get("method", "(respuesta)")
            if count <= 3 or (method == "depth.update" and depth_count < 3):
                print(f"--- mensaje #{count} (method={method}) ---")
                print(json.dumps(msg, indent=2)[:1200])
                print()
                if method == "depth.update":
                    depth_count += 1
            if depth_count >= 3 and count > 5:
                print(">>> suficientes mensajes de muestra, cerrando.")
                break

if __name__ == "__main__":
    asyncio.run(main())
