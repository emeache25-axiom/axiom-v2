"""
API del Bot de Paper-Trading — AXIOM v2.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from backend.services.bot_service import compute_stats

router = APIRouter(prefix="/api/bot", tags=["bot"])


class ConfigUpdate(BaseModel):
    enabled:         Optional[bool]  = None
    trade_amount:    Optional[float] = None
    stop_loss_pct:   Optional[float] = None
    max_positions:   Optional[int]   = None


class RuleCreate(BaseModel):
    name:       str
    conditions: List[dict]   # [{field, op, value}]
    kind:       str = "entry"   # 'entry' | 'exit'
    active:     bool = True


class RuleUpdate(BaseModel):
    name:       Optional[str]        = None
    conditions: Optional[List[dict]] = None
    kind:       Optional[str]        = None
    active:     Optional[bool]       = None


# ── Config ──────────────────────────────────────────────────────────────────
@router.get("/config")
async def get_config(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM bot_config WHERE id = 1")
    return {"config": dict(row)} if row else {"config": None}


@router.put("/config")
async def update_config(request: Request, body: ConfigUpdate):
    sets, vals, i = [], [], 1
    for field in ("enabled", "trade_amount", "stop_loss_pct", "max_positions"):
        v = getattr(body, field)
        if v is not None:
            sets.append(f"{field} = ${i}"); vals.append(v); i += 1
    if not sets:
        raise HTTPException(400, "Nada que actualizar")
    sets.append("updated_at = now()")
    vals.append(1)
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE bot_config SET {', '.join(sets)} WHERE id = ${i} RETURNING *", *vals
        )
    return {"config": dict(row)}


# ── Reglas ──────────────────────────────────────────────────────────────────
@router.get("/rules")
async def list_rules(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM bot_rules ORDER BY created_at")
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d["conditions"], str):
            d["conditions"] = json.loads(d["conditions"])
        out.append(d)
    return {"rules": out}


@router.post("/rules")
async def create_rule(request: Request, body: RuleCreate):
    kind = body.kind if body.kind in ("entry", "exit") else "entry"
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO bot_rules (name, kind, conditions, active)
            VALUES ($1, $2, $3, $4) RETURNING *
        """, body.name, kind, json.dumps(body.conditions), body.active)
    d = dict(row)
    if isinstance(d["conditions"], str):
        d["conditions"] = json.loads(d["conditions"])
    return {"rule": d}


@router.put("/rules/{rule_id}")
async def update_rule(request: Request, rule_id: int, body: RuleUpdate):
    sets, vals, i = [], [], 1
    if body.name is not None:
        sets.append(f"name = ${i}"); vals.append(body.name); i += 1
    if body.conditions is not None:
        sets.append(f"conditions = ${i}"); vals.append(json.dumps(body.conditions)); i += 1
    if body.kind is not None and body.kind in ("entry", "exit"):
        sets.append(f"kind = ${i}"); vals.append(body.kind); i += 1
    if body.active is not None:
        sets.append(f"active = ${i}"); vals.append(body.active); i += 1
    if not sets:
        raise HTTPException(400, "Nada que actualizar")
    vals.append(rule_id)
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE bot_rules SET {', '.join(sets)} WHERE id = ${i} RETURNING *", *vals
        )
    if not row:
        raise HTTPException(404, "Regla no encontrada")
    d = dict(row)
    if isinstance(d["conditions"], str):
        d["conditions"] = json.loads(d["conditions"])
    return {"rule": d}


@router.delete("/rules/{rule_id}")
async def delete_rule(request: Request, rule_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        res = await conn.execute("DELETE FROM bot_rules WHERE id = $1", rule_id)
    if res == "DELETE 0":
        raise HTTPException(404, "Regla no encontrada")
    return {"status": "ok"}


# ── Posiciones ──────────────────────────────────────────────────────────────
def _fmt_pos(r) -> dict:
    return {
        "id":           r["id"],
        "coin_id":      r["coin_id"],
        "symbol":       r["symbol"],
        "exchange":     r["exchange"],
        "status":       r["status"],
        "entry_price":  float(r["entry_price"]),
        "qty":          float(r["qty"]),
        "amount":       float(r["amount"]),
        "stop_price":   float(r["stop_price"]),
        "exit_price":   float(r["exit_price"]) if r["exit_price"] else None,
        "pnl":          float(r["pnl"]) if r["pnl"] is not None else None,
        "pnl_pct":      float(r["pnl_pct"]) if r["pnl_pct"] is not None else None,
        "entry_reason": r["entry_reason"],
        "exit_reason":  r["exit_reason"],
        "opened_at":    r["opened_at"].isoformat() if r["opened_at"] else None,
        "closed_at":    r["closed_at"].isoformat() if r["closed_at"] else None,
    }


@router.get("/positions")
async def list_positions(request: Request, status: Optional[str] = None):
    pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        if status in ("open", "closed"):
            rows = await conn.fetch(
                "SELECT * FROM bot_positions WHERE status=$1 ORDER BY opened_at DESC", status
            )
        else:
            rows = await conn.fetch("SELECT * FROM bot_positions ORDER BY opened_at DESC LIMIT 100")

    out = [_fmt_pos(r) for r in rows]

    # Para las abiertas, calcular precio actual y P&L no realizado en vivo
    from backend.services.bot_service import _coin_price
    for p in out:
        if p["status"] != "open":
            continue
        cur = await _coin_price(pool, p["coin_id"], p["symbol"], p.get("exchange") or "binance")
        if cur is not None:
            p["current_price"] = cur
            p["live_pnl"] = round(p["qty"] * cur - p["amount"], 2)
            p["live_pnl_pct"] = round((cur - p["entry_price"]) / p["entry_price"] * 100, 3)
        else:
            p["current_price"] = None
            p["live_pnl"] = None
            p["live_pnl_pct"] = None

    return {"positions": out}


# ── Stats ───────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_stats(request: Request):
    return {"stats": await compute_stats(request.app.state.db_pool)}


# ── Reset ───────────────────────────────────────────────────────────────────
@router.post("/reset")
async def reset_bot(request: Request):
    """Cierra todo, borra posiciones/señales y restablece el balance inicial."""
    async with request.app.state.db_pool.acquire() as conn:
        cfg = await conn.fetchrow("SELECT initial_balance FROM bot_config WHERE id=1")
        await conn.execute("DELETE FROM bot_positions")
        await conn.execute("DELETE FROM bot_signals")
        await conn.execute("""
            UPDATE bot_config SET balance = $1, enabled = false, updated_at = now()
            WHERE id = 1
        """, cfg["initial_balance"])
    return {"status": "ok"}
