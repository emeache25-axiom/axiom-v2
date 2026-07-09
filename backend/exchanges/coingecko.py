"""
AXIOM v2 — Adaptador CoinGecko.
════════════════════════════════════════════════════════════════════════════
NO es un exchange: es un agregador. Radar de descubrimiento. Da precio de
referencia (con retraso) e histórico limitado (para gráfico de referencia,
screener y backtest exploratorio). NO tiene tiempo real, NI vela en vivo, NI
order book — la fuente no los provee.

Uso previsto: ver coins que todavía no están en tus exchanges operables. Si una
resulta interesante, se busca en qué exchange es operable y se incorpora ese.

IMPORTANTE — identificadores: CoinGecko no usa "símbolos de par" sino IDs de
coin (ej. "ontology", "bitcoin"). Los métodos reciben el coin_id de CoinGecko,
no un par tipo ONTBTC. Y el precio se pide contra una moneda (vs_currency),
por defecto USD.

REST: https://api.coingecko.com/api/v3   (plan gratuito, con rate limits)
"""
from __future__ import annotations
import logging
from typing import Optional

import httpx

from .base import ExchangeAdapter

logger = logging.getLogger(__name__)

_REST = "https://api.coingecko.com/api/v3"
_TIMEOUT = 15.0

# timeframe canónico → días de histórico para market_chart (aproximación).
# CoinGecko decide la granularidad según el rango (no se puede pedir intervalo).
_TF_DAYS = {
    "5m": 1, "15m": 1, "30m": 1,
    "1h": 7, "4h": 30, "1d": 365,
    "1w": 365, "1M": max,  # 'max' = todo el histórico
}


class CoinGecko(ExchangeAdapter):
    name = "coingecko"
    label = "CoinGecko"
    operable = False
    # Solo lo que la fuente realmente da. Sin price_rt, sin candle_rt, sin orderbook.
    capabilities = {"price_ref", "ohlcv_limited"}

    # ── Precio de referencia (REST, con retraso) ────────────────────────────────
    async def get_price(self, coin_id: str, vs_currency: str = "usd") -> dict:
        """coin_id es el ID de CoinGecko (ej. 'ontology'), NO un par."""
        cid = coin_id.lower()
        vs  = vs_currency.lower()
        params = {
            "ids": cid, "vs_currencies": vs,
            "include_24hr_change": "true",
            "include_24hr_vol": "true",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/simple/price", params=params)
            if r.status_code != 200:
                return self._price_obj()
            d = r.json().get(cid)
            if not d:
                return self._price_obj()
            return self._price_obj(
                price=d.get(vs),
                change_24h=d.get(f"{vs}_24h_change"),
                volume_24h=d.get(f"{vs}_24h_vol"),
            )

    # ── Histórico limitado (REST) ───────────────────────────────────────────────
    async def get_ohlcv(self, coin_id: str, timeframe: str,
                        start_ms: Optional[int] = None,
                        end_ms: Optional[int] = None,
                        limit: int = 1000,
                        vs_currency: str = "usd") -> list[dict]:
        """
        Devuelve OHLC aproximado desde el endpoint /coins/{id}/ohlc.
        OJO: CoinGecko NO da velas OHLCV verdaderas de un par-en-un-exchange; da
        OHLC agregado del mercado con granularidad automática y sin volumen. Sirve
        para referencia/screener/backtest exploratorio, no para trading fino.
        """
        cid = coin_id.lower()
        days = _TF_DAYS.get(timeframe, 30)
        days_param = "max" if days is max else days
        params = {"vs_currency": vs_currency.lower(), "days": days_param}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(f"{_REST}/coins/{cid}/ohlc", params=params)
            if r.status_code != 200:
                return []
            # Formato CoinGecko OHLC: [ [ts_ms, open, high, low, close], ... ]  (sin volumen)
            out = []
            for row in r.json():
                out.append(self._candle(
                    int(row[0]) // 1000, row[1], row[2], row[3], row[4], 0.0))
            if limit and len(out) > limit:
                out = out[-limit:]
            return out
