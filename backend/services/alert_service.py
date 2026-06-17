"""
AXIOM v2 — Servicio de Alertas de Precio.

Evalúa alertas contra el RANGO (high/low) de la última vela de 1 minuto, no
contra un precio puntual: así captura mechas que tocan el objetivo y vuelven
dentro del mismo minuto.

Lógica de ALCANCE (no de cruce exacto):
  - 'above': dispara si high_1m >= target
  - 'below': dispara si low_1m  <= target

Anti-spam:
  - no recurrente: dispara una vez y queda inactiva
  - recurrente: re-arma solo si pasó el cooldown Y el precio salió de la zona
"""
from __future__ import annotations
import os
import logging
import asyncio
from datetime import datetime, timezone, timedelta

import httpx

from backend.services.price_service import get_price

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"
_TIMEOUT = 8.0
COOLDOWN_MINUTES = 15


async def send_telegram(text: str) -> bool:
    """Envía un mensaje por Telegram. Lee credenciales en runtime."""
    token   = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        logger.warning("[alerts] Telegram no configurado (falta TOKEN o CHAT_ID)")
        return False
    url = f"{TELEGRAM_API}/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(url, json={
                "chat_id": chat_id, "text": text,
                "parse_mode": "HTML", "disable_web_page_preview": True,
            })
            if r.status_code != 200:
                logger.error(f"[alerts] Telegram HTTP {r.status_code}: {r.text[:200]}")
                return False
            return True
    except Exception as exc:
        logger.error(f"[alerts] Error enviando Telegram: {exc}")
        return False


def _fmt_price(v) -> str:
    if v is None:
        return "—"
    v = float(v)
    return f"{v:,.2f}" if abs(v) >= 1 else f"{v:.8f}".rstrip("0").rstrip(".")


async def _last_minute_range(symbol: str, exchange: str) -> dict | None:
    """
    Trae las últimas velas de 1m y devuelve {high, low, close} combinando las
    dos más recientes (minuto cerrado + en curso), para capturar mechas.
    Binance como fuente (o fallback). MEXC si está configurado.
    """
    sym = f"{symbol.upper()}USDT"
    endpoints = []
    if exchange == "mexc":
        endpoints.append("https://api.mexc.com/api/v3/klines")
    endpoints.append("https://api.binance.com/api/v3/klines")

    for base in endpoints:
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.get(base, params={"symbol": sym, "interval": "1m", "limit": 2})
                if r.status_code != 200:
                    continue
                rows = r.json()
                if not rows:
                    continue
                highs = [float(row[2]) for row in rows]
                lows  = [float(row[3]) for row in rows]
                close = float(rows[-1][4])
                return {"high": max(highs), "low": min(lows), "close": close}
        except Exception:
            continue
    return None


async def evaluate_alerts(pool) -> dict:
    """Evalúa todas las alertas activas. Returns: {evaluated, triggered}."""
    async with pool.acquire() as conn:
        alerts = await conn.fetch("""
            SELECT id, coin_id, symbol, exchange, direction, target_price,
                   recurring, note, last_triggered_at, last_side
            FROM price_alerts
            WHERE active = true
        """)
    if not alerts:
        return {"evaluated": 0, "triggered": 0}

    coin_ids = list({a["coin_id"] for a in alerts})
    async with pool.acquire() as conn:
        db_rows = await conn.fetch("SELECT id, price FROM coins WHERE id = ANY($1)", coin_ids)
    db_map = {r["id"]: {"price": r["price"]} for r in db_rows}

    now = datetime.now(timezone.utc)
    triggered = 0

    async def eval_one(a):
        nonlocal triggered
        target = float(a["target_price"])
        direction = a["direction"]

        rng = await _last_minute_range(a["symbol"], a["exchange"])
        if rng:
            hi, lo, close = rng["high"], rng["low"], rng["close"]
        else:
            pdata = await get_price(a["symbol"], a["exchange"], db_map.get(a["coin_id"]))
            px = pdata.get("price")
            if px is None:
                return
            hi = lo = close = px

        reached = (hi >= target) if direction == "above" else (lo <= target)
        in_zone = (close >= target) if direction == "above" else (close <= target)

        last = a["last_triggered_at"]
        cooled = (last is None) or (now - last >= timedelta(minutes=COOLDOWN_MINUTES))
        was_in = (a["last_side"] == "in")

        should_fire = False
        if reached and not was_in:
            # was_in=True significa que el objetivo ya estaba cumplido (al crear
            # o tras un disparo previo): no re-disparar hasta salir de la zona.
            if last is None:
                should_fire = True
            elif a["recurring"] and cooled:
                should_fire = True

        async with pool.acquire() as conn:
            if should_fire:
                arrow = "🔺" if direction == "above" else "🔻"
                cond = "alcanzó" if direction == "above" else "cayó a"
                note = f"\n📝 {a['note']}" if a["note"] else ""
                msg = (
                    f"{arrow} <b>Alerta {a['symbol'].upper()}</b>\n"
                    f"El precio {cond} <b>${_fmt_price(target)}</b>\n"
                    f"Último: <b>${_fmt_price(close)}</b>  (min {_fmt_price(lo)}–{_fmt_price(hi)}){note}"
                )
                await send_telegram(msg)
                triggered += 1
                if a["recurring"]:
                    await conn.execute("""
                        UPDATE price_alerts
                        SET last_triggered_at = now(), trigger_count = trigger_count + 1,
                            last_side = 'in'
                        WHERE id = $1
                    """, a["id"])
                else:
                    await conn.execute("""
                        UPDATE price_alerts
                        SET active = false, last_triggered_at = now(),
                            trigger_count = trigger_count + 1, last_side = 'in'
                        WHERE id = $1
                    """, a["id"])
            else:
                new_side = "in" if in_zone else "out"
                if new_side != (a["last_side"] or ""):
                    await conn.execute(
                        "UPDATE price_alerts SET last_side = $1 WHERE id = $2",
                        new_side, a["id"]
                    )

    await asyncio.gather(*[eval_one(a) for a in alerts])
    return {"evaluated": len(alerts), "triggered": triggered}
