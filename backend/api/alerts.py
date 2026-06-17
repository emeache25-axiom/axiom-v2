"""
API de Alertas de Precio — AXIOM v2.
"""
from __future__ import annotations
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services.alert_service import send_telegram

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    coin_id:      str
    symbol:       str
    exchange:     str = "coingecko"
    direction:    str            # 'above' | 'below'
    target_price: float
    recurring:    bool = False
    note:         Optional[str] = None


class AlertUpdate(BaseModel):
    direction:    Optional[str]   = None
    target_price: Optional[float] = None
    recurring:    Optional[bool]  = None
    active:       Optional[bool]  = None
    note:         Optional[str]   = None


def _fmt(r) -> dict:
    return {
        "id":                r["id"],
        "coin_id":           r["coin_id"],
        "symbol":            r["symbol"],
        "exchange":          r["exchange"],
        "direction":         r["direction"],
        "target_price":      float(r["target_price"]),
        "recurring":         r["recurring"],
        "active":            r["active"],
        "note":              r["note"],
        "created_at":        r["created_at"].isoformat() if r["created_at"] else None,
        "last_triggered_at": r["last_triggered_at"].isoformat() if r["last_triggered_at"] else None,
        "trigger_count":     r["trigger_count"],
    }


@router.get("/")
async def list_alerts(request: Request, coin_id: Optional[str] = None):
    """Lista de alertas. Opcionalmente filtra por coin_id."""
    async with request.app.state.db_pool.acquire() as conn:
        if coin_id:
            rows = await conn.fetch("""
                SELECT * FROM price_alerts WHERE coin_id = $1
                ORDER BY active DESC, created_at DESC
            """, coin_id)
        else:
            rows = await conn.fetch("""
                SELECT * FROM price_alerts
                ORDER BY active DESC, created_at DESC
            """)
    return {"alerts": [_fmt(r) for r in rows]}


@router.post("/")
async def create_alert(request: Request, body: AlertCreate):
    """Crea una alerta. Si el objetivo YA está alcanzado al crear, se marca
    'in' (no dispara al instante); recién dispara cuando el precio salga de la
    zona y vuelva a alcanzarlo. Si todavía no está alcanzado, last_side NULL."""
    if body.direction not in ("above", "below"):
        raise HTTPException(400, "direction debe ser 'above' o 'below'")
    if body.target_price <= 0:
        raise HTTPException(400, "target_price debe ser positivo")

    from backend.services.price_service import get_price
    async with request.app.state.db_pool.acquire() as conn:
        db = await conn.fetchrow("SELECT price FROM coins WHERE id=$1", body.coin_id)
    db_price = {"price": db["price"]} if db else None
    pdata = await get_price(body.symbol, body.exchange, db_price)
    cur = pdata.get("price")

    # ¿El objetivo ya está cumplido al momento de crear?
    already = False
    if cur is not None:
        already = (cur >= body.target_price) if body.direction == "above" else (cur <= body.target_price)
    last_side = "in" if already else None

    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO price_alerts
                (coin_id, symbol, exchange, direction, target_price, recurring, note, last_side)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
        """, body.coin_id, body.symbol.upper(), body.exchange, body.direction,
            body.target_price, body.recurring, body.note, last_side)

    return {"alert": _fmt(row), "already_reached": already}


@router.put("/{alert_id}")
async def update_alert(request: Request, alert_id: int, body: AlertUpdate):
    """Actualiza una alerta (reactivar, cambiar precio/dirección, etc.)."""
    sets, vals, i = [], [], 1
    if body.direction is not None:
        if body.direction not in ("above", "below"):
            raise HTTPException(400, "direction inválida")
        sets.append(f"direction = ${i}"); vals.append(body.direction); i += 1
    if body.target_price is not None:
        sets.append(f"target_price = ${i}"); vals.append(body.target_price); i += 1
    if body.recurring is not None:
        sets.append(f"recurring = ${i}"); vals.append(body.recurring); i += 1
    if body.active is not None:
        sets.append(f"active = ${i}"); vals.append(body.active); i += 1
        # Al reactivar, resetear last_side para que vuelva a calibrar
        if body.active:
            sets.append("last_side = NULL")
    if body.note is not None:
        sets.append(f"note = ${i}"); vals.append(body.note); i += 1

    if not sets:
        raise HTTPException(400, "Nada que actualizar")

    vals.append(alert_id)
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE price_alerts SET {', '.join(sets)} WHERE id = ${i} RETURNING *",
            *vals
        )
    if not row:
        raise HTTPException(404, "Alerta no encontrada")
    return {"alert": _fmt(row)}


@router.delete("/{alert_id}")
async def delete_alert(request: Request, alert_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        res = await conn.execute("DELETE FROM price_alerts WHERE id = $1", alert_id)
    if res == "DELETE 0":
        raise HTTPException(404, "Alerta no encontrada")
    return {"status": "ok"}


@router.post("/test-telegram")
async def test_telegram(request: Request):
    """Envía un mensaje de prueba para verificar la configuración de Telegram."""
    ok = await send_telegram("✅ <b>AXIOM v2</b> — Telegram configurado correctamente.")
    if not ok:
        raise HTTPException(500, "No se pudo enviar. Verificá TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.")
    return {"status": "ok"}
