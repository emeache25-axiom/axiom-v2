from __future__ import annotations
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from backend.strat.strategy_base import registry
from backend.strat.stats_engine import compute_strategy_stats
from backend.strat.execution_engine import run_cycle
from backend.strat.backtest_engine import run_backtest
from backend.strat.data_engine import data_engine
from backend.strat.backfill import fetch_history
from datetime import datetime, timezone

router = APIRouter(prefix="/api/strat", tags=["bot-v2"])


class BacktestRequest(BaseModel):
    strategy_key:    str
    pair_symbol:     str
    exchange:        str
    timeframe:       Optional[str] = None      # override del timeframe del plugin
    params:          dict = {}
    initial_balance: float = 10000
    trade_amount:    float = 200
    stop_loss_pct:   float = 2.0
    target:          int = 10000
    save:            bool = True


"""
API del Bot v2 (estrategias como plugins) — AXIOM v2.

Endpoints:
  GET    /api/strat/catalog              — plugins disponibles (con params)
  GET    /api/strat/strategies           — instancias configuradas + stats
  POST   /api/strat/strategies           — crear instancia de estrategia
  PUT    /api/strat/strategies/{id}      — editar (params, capital, enabled...)
  DELETE /api/strat/strategies/{id}      — borrar
  POST   /api/strat/strategies/{id}/reset — reset capital/posiciones
  GET    /api/strat/strategies/{id}/stats     — stats de una estrategia
  GET    /api/strat/strategies/{id}/positions — posiciones (open|closed)
  GET    /api/strat/strategies/{id}/pairs     — pares asociados
  PUT    /api/strat/strategies/{id}/pairs     — asociar/desasociar pares
  GET    /api/strat/pairs                 — pares operables de la watchlist
  POST   /api/strat/run                   — forzar un ciclo (debug/manual)
"""



# ── Modelos ───────────────────────────────────────────────────────────────────
class StrategyCreate(BaseModel):
    key:             str
    name:            Optional[str] = None
    initial_balance: float = 10000
    trade_amount:    float = 200
    max_positions:   int = 5
    stop_loss_pct:   float = 2.0
    params:          dict = {}


class StrategyUpdate(BaseModel):
    name:          Optional[str] = None
    enabled:       Optional[bool] = None
    trade_amount:  Optional[float] = None
    max_positions: Optional[int] = None
    stop_loss_pct: Optional[float] = None
    params:        Optional[dict] = None


class PairsUpdate(BaseModel):
    watchlist_ids: List[int]      # pares que quedan asociados a la estrategia


# ── Catálogo de plugins ────────────────────────────────────────────────────────
@router.get("/catalog")
async def get_catalog():
    """Estrategias-plugin disponibles, con sus parámetros configurables."""
    return {"catalog": registry.catalog()}


# ── Instancias de estrategia ────────────────────────────────────────────────────
def _strategy_row(r) -> dict:
    d = dict(r)
    if isinstance(d.get("params"), str):
        try: d["params"] = json.loads(d["params"])
        except Exception: d["params"] = {}
    for k in ("initial_balance", "balance", "trade_amount", "stop_loss_pct"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


@router.get("/strategies")
async def list_strategies(request: Request):
    """Instancias configuradas, cada una con sus stats."""
    pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM strat_strategies ORDER BY id")
    out = []
    for r in rows:
        s = _strategy_row(r)
        plugin = registry.get(s["key"])
        tf = plugin.timeframe if plugin else "5m"
        try:
            stats = await compute_strategy_stats(pool, s["id"], tf)
        except Exception:
            stats = {}
        out.append({**s, "stats": stats,
                    "plugin_name": plugin.name if plugin else s["key"],
                    "timeframe": tf})
    return {"strategies": out}


@router.post("/strategies")
async def create_strategy(request: Request, body: StrategyCreate):
    plugin = registry.get(body.key)
    if not plugin:
        raise HTTPException(404, f"Estrategia '{body.key}' no existe")
    name = body.name or plugin.name
    # Validar params contra los del plugin (quedarse solo con las claves válidas)
    valid = plugin.merge_params(body.params)
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO strat_strategies
                (key, name, params, initial_balance, balance, trade_amount,
                 max_positions, stop_loss_pct)
            VALUES ($1,$2,$3,$4,$4,$5,$6,$7)
            RETURNING *
        """, body.key, name, json.dumps(valid), body.initial_balance,
            body.trade_amount, body.max_positions, body.stop_loss_pct)
    return {"strategy": _strategy_row(row)}


@router.put("/strategies/{sid}")
async def update_strategy(request: Request, sid: int, body: StrategyUpdate):
    sets, vals, i = [], [], 1
    if body.name is not None:
        sets.append(f"name = ${i}"); vals.append(body.name); i += 1
    if body.enabled is not None:
        sets.append(f"enabled = ${i}"); vals.append(body.enabled); i += 1
    if body.trade_amount is not None:
        sets.append(f"trade_amount = ${i}"); vals.append(body.trade_amount); i += 1
    if body.max_positions is not None:
        sets.append(f"max_positions = ${i}"); vals.append(body.max_positions); i += 1
    if body.stop_loss_pct is not None:
        sets.append(f"stop_loss_pct = ${i}"); vals.append(body.stop_loss_pct); i += 1
    if body.params is not None:
        async with request.app.state.db_pool.acquire() as conn:
            cur = await conn.fetchrow("SELECT key FROM strat_strategies WHERE id=$1", sid)
        if not cur:
            raise HTTPException(404, "Estrategia no encontrada")
        plugin = registry.get(cur["key"])
        valid = plugin.merge_params(body.params) if plugin else body.params
        sets.append(f"params = ${i}"); vals.append(json.dumps(valid)); i += 1
    if not sets:
        raise HTTPException(400, "Nada que actualizar")
    vals.append(sid)
    async with request.app.state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE strat_strategies SET {', '.join(sets)} WHERE id=${i} RETURNING *", *vals)
    if not row:
        raise HTTPException(404, "Estrategia no encontrada")
    return {"strategy": _strategy_row(row)}


@router.delete("/strategies/{sid}")
async def delete_strategy(request: Request, sid: int):
    async with request.app.state.db_pool.acquire() as conn:
        res = await conn.execute("DELETE FROM strat_strategies WHERE id=$1", sid)
    if res == "DELETE 0":
        raise HTTPException(404, "Estrategia no encontrada")
    return {"status": "ok"}


@router.post("/strategies/{sid}/reset")
async def reset_strategy(request: Request, sid: int):
    """Cierra posiciones, borra señales/equity y restablece el capital."""
    async with request.app.state.db_pool.acquire() as conn:
        cur = await conn.fetchrow("SELECT initial_balance FROM strat_strategies WHERE id=$1", sid)
        if not cur:
            raise HTTPException(404, "Estrategia no encontrada")
        await conn.execute("DELETE FROM strat_positions WHERE strategy_id=$1", sid)
        await conn.execute("DELETE FROM strat_equity WHERE strategy_id=$1", sid)
        await conn.execute("DELETE FROM strat_signals WHERE strategy_id=$1", sid)
        await conn.execute(
            "UPDATE strat_strategies SET balance=$1, enabled=false WHERE id=$2",
            cur["initial_balance"], sid)
    return {"status": "ok"}


@router.get("/strategies/{sid}/stats")
async def strategy_stats(request: Request, sid: int):
    pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT key FROM strat_strategies WHERE id=$1", sid)
    if not r:
        raise HTTPException(404, "Estrategia no encontrada")
    plugin = registry.get(r["key"])
    tf = plugin.timeframe if plugin else "5m"
    return {"stats": await compute_strategy_stats(pool, sid, tf)}


@router.get("/strategies/{sid}/positions")
async def strategy_positions(request: Request, sid: int, status: Optional[str] = None):
    async with request.app.state.db_pool.acquire() as conn:
        if status in ("open", "closed"):
            rows = await conn.fetch(
                "SELECT * FROM strat_positions WHERE strategy_id=$1 AND status=$2 "
                "ORDER BY opened_at DESC", sid, status)
        else:
            rows = await conn.fetch(
                "SELECT * FROM strat_positions WHERE strategy_id=$1 "
                "ORDER BY opened_at DESC LIMIT 100", sid)
    def fmt(p):
        d = dict(p)
        for k in ("entry_price","qty","amount","stop_price","take_price",
                  "exit_price","pnl","pnl_pct"):
            if d.get(k) is not None:
                d[k] = float(d[k])
        for k in ("opened_at","closed_at"):
            if d.get(k):
                d[k] = d[k].isoformat()
        return d
    return {"positions": [fmt(r) for r in rows]}


# ── Asociación de pares a estrategias ────────────────────────────────────────────
@router.get("/strategies/{sid}/pairs")
async def strategy_pairs(request: Request, sid: int):
    """Pares asociados a la estrategia (con su estado enabled)."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT w.id AS watchlist_id, w.base, w.quote, w.exchange, w.pair_symbol,
                   w.operable, w.bot_enabled,
                   (ws.id IS NOT NULL) AS associated
            FROM watchlist w
            LEFT JOIN watchlist_strategy ws
                   ON ws.watchlist_id = w.id AND ws.strategy_id = $1
            WHERE w.operable = true
            ORDER BY w.position
        """, sid)
    return {"pairs": [dict(r) for r in rows]}


@router.put("/strategies/{sid}/pairs")
async def set_strategy_pairs(request: Request, sid: int, body: PairsUpdate):
    """Define qué pares quedan asociados a la estrategia (reemplaza el set)."""
    async with request.app.state.db_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM watchlist_strategy WHERE strategy_id=$1", sid)
            for wid in body.watchlist_ids:
                await conn.execute("""
                    INSERT INTO watchlist_strategy (watchlist_id, strategy_id, enabled)
                    VALUES ($1,$2,true)
                    ON CONFLICT (watchlist_id, strategy_id) DO UPDATE SET enabled=true
                """, wid, sid)
    return {"status": "ok"}


# ── Pares operables de la watchlist ──────────────────────────────────────────────
@router.get("/pairs")
async def operable_pairs(request: Request):
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id AS watchlist_id, coin_id, base, quote, exchange,
                   pair_symbol, operable, bot_enabled
            FROM watchlist WHERE operable = true ORDER BY position
        """)
    return {"pairs": [dict(r) for r in rows]}


# ── Ejecución manual de un ciclo (debug) ─────────────────────────────────────────
@router.post("/strategies/{sid}/backtest")
async def backtest_strategy(request: Request, sid: int, pair_symbol: str = "",
                            exchange: str = "", target: int = 10000, save: bool = True):
    """
    Corre un backtest de la estrategia sobre el histórico de un par.
    Si no se pasa pair_symbol/exchange, usa el primer par operable asociado.
    """
    pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        s = await conn.fetchrow("SELECT * FROM strat_strategies WHERE id=$1", sid)
        if not s:
            raise HTTPException(404, "Estrategia no encontrada")
        # Resolver par si no vino explícito
        if not pair_symbol or not exchange:
            row = await conn.fetchrow("""
                SELECT w.pair_symbol, w.exchange FROM watchlist w
                JOIN watchlist_strategy ws ON ws.watchlist_id = w.id
                WHERE ws.strategy_id=$1 AND w.operable=true
                ORDER BY w.position LIMIT 1
            """, sid)
            if not row:
                raise HTTPException(400, "La estrategia no tiene pares operables asociados")
            pair_symbol, exchange = row["pair_symbol"], row["exchange"]

    plugin = registry.get(s["key"])
    if not plugin:
        raise HTTPException(404, f"Plugin '{s['key']}' no encontrado")

    overrides = s["params"]
    if isinstance(overrides, str):
        try: overrides = json.loads(overrides)
        except Exception: overrides = {}
    p = plugin.merge_params(overrides)

    candles = await fetch_history(pair_symbol, plugin.timeframe, exchange, target=target)
    if not candles:
        raise HTTPException(502, f"No se pudieron obtener velas de {pair_symbol} en {exchange}")

    result = run_backtest(
        plugin, p, candles,
        initial_balance=float(s["initial_balance"]),
        trade_amount=float(s["trade_amount"]),
        stop_loss_pct=float(s["stop_loss_pct"]),
    )
    result["pair_symbol"] = pair_symbol
    result["exchange"] = exchange
    result["timeframe"] = plugin.timeframe

    pf = datetime.fromtimestamp(candles[0]["time"], tz=timezone.utc) if candles else None
    pt = datetime.fromtimestamp(candles[-1]["time"], tz=timezone.utc) if candles else None
    result["period_from"] = pf.isoformat() if pf else None
    result["period_to"] = pt.isoformat() if pt else None

    bt_id = None
    if save and "error" not in result:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO strat_backtests
                    (strategy_id, strategy_key, strategy_name, pair_symbol, exchange,
                     timeframe, candles_used, period_from, period_to, params,
                     initial_balance, trade_amount, total_return, trades_total,
                     win_rate, profit_factor, expectancy, max_drawdown, sharpe,
                     best_trade, worst_trade, full_result)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
                RETURNING id
            """, sid, s["key"], s["name"], pair_symbol, exchange, plugin.timeframe,
                result.get("candles_used"), pf, pt, json.dumps(p),
                float(s["initial_balance"]), float(s["trade_amount"]),
                result.get("total_return"), result.get("trades_total"),
                result.get("win_rate"), result.get("profit_factor"),
                result.get("expectancy"), result.get("max_drawdown"),
                result.get("sharpe"), result.get("best_trade"),
                result.get("worst_trade"), json.dumps(result))
            bt_id = row["id"]
    result["backtest_id"] = bt_id
    return {"backtest": result}


@router.get("/strategies/{sid}/backtests")
async def list_backtests(request: Request, sid: int):
    """Backtests guardados de una estrategia (sin el full_result, liviano)."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, pair_symbol, exchange, timeframe, candles_used,
                   period_from, period_to, params, total_return, trades_total,
                   win_rate, profit_factor, expectancy, max_drawdown, sharpe,
                   best_trade, worst_trade, note, created_at
            FROM strat_backtests WHERE strategy_id=$1 ORDER BY created_at DESC
        """, sid)
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("params"), str):
            try: d["params"] = json.loads(d["params"])
            except Exception: pass
        for k in ("total_return","win_rate","profit_factor","expectancy",
                  "max_drawdown","sharpe","best_trade","worst_trade"):
            if d.get(k) is not None: d[k] = float(d[k])
        for k in ("period_from","period_to","created_at"):
            if d.get(k): d[k] = d[k].isoformat()
        out.append(d)
    return {"backtests": out}


@router.get("/backtests")
async def list_all_backtests(request: Request):
    """Todos los backtests guardados (para el laboratorio), sin full_result."""
    async with request.app.state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, strategy_key, strategy_name, pair_symbol, exchange, timeframe,
                   candles_used, period_from, period_to, total_return, trades_total,
                   win_rate, profit_factor, expectancy, max_drawdown, sharpe, created_at
            FROM strat_backtests ORDER BY created_at DESC LIMIT 100
        """)
    out = []
    for r in rows:
        d = dict(r)
        for k in ("total_return","win_rate","profit_factor","expectancy","max_drawdown","sharpe"):
            if d.get(k) is not None: d[k] = float(d[k])
        for k in ("period_from","period_to","created_at"):
            if d.get(k): d[k] = d[k].isoformat()
        out.append(d)
    return {"backtests": out}


@router.get("/backtests/{bt_id}")
async def get_backtest(request: Request, bt_id: int):
    """Resultado completo de un backtest (con equity curve y trades)."""
    async with request.app.state.db_pool.acquire() as conn:
        r = await conn.fetchrow("SELECT full_result FROM strat_backtests WHERE id=$1", bt_id)
    if not r:
        raise HTTPException(404, "Backtest no encontrado")
    fr = r["full_result"]
    if isinstance(fr, str):
        try: fr = json.loads(fr)
        except Exception: fr = {}
    return {"backtest": fr}


@router.delete("/backtests/{bt_id}")
async def delete_backtest(request: Request, bt_id: int):
    async with request.app.state.db_pool.acquire() as conn:
        res = await conn.execute("DELETE FROM strat_backtests WHERE id=$1", bt_id)
    if res == "DELETE 0":
        raise HTTPException(404, "Backtest no encontrado")
    return {"status": "ok"}


@router.post("/backtest")
async def backtest_free(request: Request, body: BacktestRequest):
    """Backtest independiente: no toca ninguna instancia. Todo al vuelo."""
    plugin = registry.get(body.strategy_key)
    if not plugin:
        raise HTTPException(404, f"Estrategia '{body.strategy_key}' no existe")
    tf = body.timeframe or plugin.timeframe
    p = plugin.merge_params(body.params)

    candles = await fetch_history(body.pair_symbol, tf, body.exchange, target=body.target)
    if not candles:
        raise HTTPException(502, f"Sin velas de {body.pair_symbol} en {body.exchange}")

    # El backtest usa el timeframe pedido aunque el plugin declare otro.
    orig_tf = plugin.timeframe
    try:
        plugin.timeframe = tf
        result = run_backtest(
            plugin, p, candles,
            initial_balance=body.initial_balance,
            trade_amount=body.trade_amount,
            stop_loss_pct=body.stop_loss_pct,
        )
    finally:
        plugin.timeframe = orig_tf

    result["pair_symbol"] = body.pair_symbol
    result["exchange"] = body.exchange
    result["timeframe"] = tf
    pf = datetime.fromtimestamp(candles[0]["time"], tz=timezone.utc) if candles else None
    pt = datetime.fromtimestamp(candles[-1]["time"], tz=timezone.utc) if candles else None
    result["period_from"] = pf.isoformat() if pf else None
    result["period_to"] = pt.isoformat() if pt else None

    bt_id = None
    if body.save and "error" not in result:
        async with request.app.state.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO strat_backtests
                    (strategy_id, strategy_key, strategy_name, pair_symbol, exchange,
                     timeframe, candles_used, period_from, period_to, params,
                     initial_balance, trade_amount, total_return, trades_total,
                     win_rate, profit_factor, expectancy, max_drawdown, sharpe,
                     best_trade, worst_trade, full_result)
                VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
                RETURNING id
            """, body.strategy_key, plugin.name, body.pair_symbol, body.exchange, tf,
                result.get("candles_used"), pf, pt, json.dumps(p),
                body.initial_balance, body.trade_amount,
                result.get("total_return"), result.get("trades_total"),
                result.get("win_rate"), result.get("profit_factor"),
                result.get("expectancy"), result.get("max_drawdown"),
                result.get("sharpe"), result.get("best_trade"),
                result.get("worst_trade"), json.dumps(result))
            bt_id = row["id"]
    result["backtest_id"] = bt_id
    return {"backtest": result}


@router.post("/run")
async def run_now(request: Request):
    """Fuerza un ciclo del bot ya mismo (sin esperar al scheduler)."""
    result = await run_cycle(request.app.state.db_pool)
    return {"result": result}
