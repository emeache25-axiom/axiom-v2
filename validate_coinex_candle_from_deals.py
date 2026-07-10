#!/usr/bin/env python3
"""
Validador de derivación de VELA desde DEALS (CoinEx).
════════════════════════════════════════════════════════════════════════════
CoinEx v2 spot no tiene kline por WebSocket, así que la vela en vivo se construye
acumulando los trades (deals). Este script:
  1. Se suscribe a deals.subscribe de un par.
  2. Construye la vela EN CURSO del timeframe (open/high/low/close/volume).
  3. Cada tanto, compara la vela derivada con la vela REAL del REST (/v2/spot/kline).
Si coinciden (dentro de lo razonable), la lógica de derivación es correcta.

Correr en el server (venv activo):
    python3 validate_coinex_candle_from_deals.py
"""
import asyncio, gzip, json, time
import websockets
import httpx

WS   = "wss://socket.coinex.com/v2/spot"
REST = "https://api.coinex.com"
SYMBOL = "ONTBTC"
TF_SECONDS = 60          # vela de 1 minuto para la prueba
TF_PERIOD  = "1min"      # período equivalente en el REST de CoinEx


def decode(raw):
    if isinstance(raw, bytes):
        try:
            return gzip.decompress(raw).decode("utf-8")
        except OSError:
            return raw.decode("utf-8", errors="replace")
    return raw


def window_start(ts_sec: int) -> int:
    """Inicio del período (vela) al que pertenece un timestamp, alineado."""
    return ts_sec - (ts_sec % TF_SECONDS)


class VelaEnCurso:
    def __init__(self):
        self.start = None
        self.o = self.h = self.l = self.c = None
        self.vol = 0.0
        self.n = 0

    def add_trade(self, price: float, qty: float, ts_sec: int):
        ws = window_start(ts_sec)
        if self.start is None or ws > self.start:
            # nueva vela (o primera): reiniciar
            self.start = ws
            self.o = self.h = self.l = self.c = price
            self.vol = qty
            self.n = 1
        elif ws == self.start:
            # mismo período: actualizar
            self.c = price
            self.h = max(self.h, price)
            self.l = min(self.l, price)
            self.vol += qty
            self.n += 1
        # si ws < self.start es un trade viejo/atrasado: ignorar

    def snapshot(self):
        return dict(start=self.start, o=self.o, h=self.h, l=self.l, c=self.c,
                    vol=round(self.vol, 4), trades=self.n)


async def vela_rest():
    """Última vela del REST (la vela en curso oficial de CoinEx)."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{REST}/v2/spot/kline",
                        params={"market": SYMBOL, "period": TF_PERIOD, "limit": 1})
        b = r.json()
        if b.get("code") == 0 and b.get("data"):
            k = b["data"][-1]
            return dict(start=int(k["created_at"]) // 1000,
                        o=float(k["open"]), h=float(k["high"]),
                        l=float(k["low"]), c=float(k["close"]),
                        vol=round(float(k["volume"]), 4))
    return None


async def main():
    vela = VelaEnCurso()
    print(f"Derivando vela {TF_PERIOD} de {SYMBOL} desde deals. Comparando con REST cada 15s.\n")
    last_cmp = 0
    async with websockets.connect(WS, ping_interval=None, max_size=2**22) as ws:
        await ws.send(json.dumps({
            "method": "deals.subscribe",
            "params": {"market_list": [SYMBOL]}, "id": 1,
        }))
        async with asyncio.timeout(90):   # correr ~90s
            async for raw in ws:
                msg = json.loads(decode(raw))
                if msg.get("method") == "deals.update":
                    data = msg.get("data") or {}
                    deals = data.get("deal_list") or data.get("deals") or []
                    for d in deals:
                        price = float(d["price"])
                        qty   = float(d.get("amount") or d.get("quantity") or 0)
                        # CoinEx da created_at en ms
                        ts = int(d.get("created_at", 0)) // 1000 or int(time.time())
                        vela.add_trade(price, qty, ts)

                now = time.time()
                if now - last_cmp >= 15 and vela.start:
                    last_cmp = now
                    derivada = vela.snapshot()
                    real = await vela_rest()
                    print("── comparación ──")
                    print(f"  derivada: {derivada}")
                    print(f"  real REST: {real}")
                    if real and derivada["start"] == real["start"]:
                        dc = abs((derivada['c'] or 0) - real['c'])
                        print(f"  mismo período ✓  | Δclose={dc:.10f}  "
                              f"| Δvol={abs(derivada['vol']-real['vol']):.4f}")
                    else:
                        print("  (períodos distintos — normal si justo cambió el minuto)")
                    print()
    print("Fin. Si 'derivada' y 'real REST' coinciden en O/H/L/C del mismo período,")
    print("la derivación desde deals es correcta.")


if __name__ == "__main__":
    asyncio.run(main())
