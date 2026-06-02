"""
AXIOM v2 — Sync OHLCV diario
Descarga velas diarias desde CoinGecko y las persiste en ohlcv_daily.

Modos:
  - sync_full(pool)        → descarga 30 días históricos para todas las coins
                             (sync inicial, ~30 min, corre en background)
  - sync_incremental(pool) → descarga solo el día anterior para todas las coins
                             (corre diariamente a las 00:01 GMT)
"""
from __future__ import annotations
import asyncio
import logging
from datetime import date, timedelta, timezone, datetime

import httpx
import asyncpg

logger = logging.getLogger(__name__)

_CG_BASE  = "https://api.coingecko.com/api/v3"
_HEADERS  = {"Accept": "application/json"}
_TIMEOUT  = 15.0

# Límites de concurrencia y rate limiting
_SEMAPHORE_SIZE = 1      # 1 request a la vez — free tier CoinGecko
_DELAY_BETWEEN  = 2.0    # 2s entre requests → ~30 req/min, bien bajo el límite
_RETRY_WAIT     = 60.0   # espera si recibimos 429


async def _fetch_ohlc(
    client:  httpx.AsyncClient,
    sem:     asyncio.Semaphore,
    coin_id: str,
    days:    int,
) -> list[list] | None:
    """
    Descarga OHLC de CoinGecko para una coin.
    Formato respuesta: [[timestamp_ms, open, high, low, close], ...]
    """
    async with sem:
        await asyncio.sleep(_DELAY_BETWEEN)
        try:
            r = await client.get(
                f"{_CG_BASE}/coins/{coin_id}/ohlc",
                params={"vs_currency": "usd", "days": str(days)},
                timeout=_TIMEOUT,
            )
            if r.status_code == 429:
                logger.warning(f"[ohlcv] Rate limit en {coin_id} — esperando {_RETRY_WAIT}s")
                await asyncio.sleep(_RETRY_WAIT)
                # Reintentar una vez
                r = await client.get(
                    f"{_CG_BASE}/coins/{coin_id}/ohlc",
                    params={"vs_currency": "usd", "days": str(days)},
                    timeout=_TIMEOUT,
                )
            if r.status_code != 200:
                logger.debug(f"[ohlcv] {coin_id}: HTTP {r.status_code}")
                return None
            return r.json()
        except Exception as e:
            logger.warning(f"[ohlcv] Error en {coin_id}: {e}")
            return None


def _parse_ohlc(raw: list[list]) -> list[dict]:
    """Convierte respuesta de CoinGecko a lista de dicts con fecha."""
    seen_dates: set[date] = set()
    result = []
    for row in raw:
        if len(row) < 5:
            continue
        ts_ms, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
        d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date()
        if d in seen_dates:
            continue
        seen_dates.add(d)
        result.append({"date": d, "open": o, "high": h, "low": l, "close": c})
    return result


async def _upsert_ohlcv(
    conn:    asyncpg.Connection,
    coin_id: str,
    rows:    list[dict],
) -> int:
    """Inserta o actualiza filas en ohlcv_daily. Devuelve cantidad insertada."""
    if not rows:
        return 0
    await conn.executemany("""
        INSERT INTO ohlcv_daily (coin_id, date, open, high, low, close, source)
        VALUES ($1, $2, $3, $4, $5, $6, 'coingecko')
        ON CONFLICT (coin_id, date) DO UPDATE
            SET open   = EXCLUDED.open,
                high   = EXCLUDED.high,
                low    = EXCLUDED.low,
                close  = EXCLUDED.close,
                source = EXCLUDED.source
    """, [(coin_id, r["date"], r["open"], r["high"], r["low"], r["close"]) for r in rows])
    return len(rows)


async def _get_coin_ids(pool: asyncpg.Pool) -> list[str]:
    """Devuelve todos los coin_ids ordenados por rank."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id FROM coins
            ORDER BY rank ASC NULLS LAST, id ASC
        """)
    return [r["id"] for r in rows]


async def _get_coins_needing_full_sync(pool: asyncpg.Pool) -> list[str]:
    """Coins que no tienen datos OHLCV de los últimos 7 días."""
    cutoff = date.today() - timedelta(days=7)
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.id
            FROM coins c
            LEFT JOIN (
                SELECT coin_id, MAX(date) as last_date
                FROM ohlcv_daily
                GROUP BY coin_id
            ) o ON c.id = o.coin_id
            WHERE o.last_date IS NULL OR o.last_date < $1
            ORDER BY c.rank ASC NULLS LAST, c.id ASC
        """, cutoff)
    return [r["id"] for r in rows]


# ── Sync completo (inicial) ───────────────────────────────────────────────────

async def sync_full(pool: asyncpg.Pool) -> dict:
    """
    Descarga 30 días de OHLCV para todas las coins que no tienen datos recientes.
    Corre en background — puede tardar ~30 minutos.
    """
    coin_ids = await _get_coins_needing_full_sync(pool)

    if not coin_ids:
        logger.info("[ohlcv] sync_full: todas las coins ya tienen datos recientes")
        return {"mode": "full", "processed": 0, "inserted": 0, "errors": 0}

    logger.info(f"[ohlcv] sync_full: iniciando descarga de {len(coin_ids)} coins (30 días)")

    sem      = asyncio.Semaphore(_SEMAPHORE_SIZE)
    inserted = 0
    errors   = 0
    processed = 0

    async with httpx.AsyncClient(headers=_HEADERS) as client:
        # Procesamos en batches de 50 para no saturar memoria
        batch_size = 50
        for batch_start in range(0, len(coin_ids), batch_size):
            batch = coin_ids[batch_start:batch_start + batch_size]

            tasks = [_fetch_ohlc(client, sem, cid, 30) for cid in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            async with pool.acquire() as conn:
                for coin_id, raw in zip(batch, results):
                    if isinstance(raw, Exception) or raw is None:
                        errors += 1
                        continue
                    rows = _parse_ohlc(raw)
                    n = await _upsert_ohlcv(conn, coin_id, rows)
                    inserted += n
                    processed += 1

            pct = round((batch_start + len(batch)) / len(coin_ids) * 100)
            logger.info(
                f"[ohlcv] sync_full: {batch_start + len(batch)}/{len(coin_ids)} "
                f"({pct}%) — {inserted} filas insertadas, {errors} errores"
            )

    logger.info(f"[ohlcv] sync_full completado: {processed} coins, {inserted} filas, {errors} errores")
    return {"mode": "full", "processed": processed, "inserted": inserted, "errors": errors}


# ── Sync incremental (diario) ─────────────────────────────────────────────────

async def sync_incremental(pool: asyncpg.Pool) -> dict:
    """
    Descarga el día anterior para todas las coins.
    Corre diariamente a las 00:01 GMT.
    """
    yesterday = date.today() - timedelta(days=1)
    coin_ids  = await _get_coin_ids(pool)

    logger.info(f"[ohlcv] sync_incremental: descargando {yesterday} para {len(coin_ids)} coins")

    sem      = asyncio.Semaphore(_SEMAPHORE_SIZE)
    inserted = 0
    errors   = 0

    async with httpx.AsyncClient(headers=_HEADERS) as client:
        batch_size = 50
        for batch_start in range(0, len(coin_ids), batch_size):
            batch = coin_ids[batch_start:batch_start + batch_size]

            tasks   = [_fetch_ohlc(client, sem, cid, 2) for cid in batch]  # days=2 → hoy + ayer
            results = await asyncio.gather(*tasks, return_exceptions=True)

            async with pool.acquire() as conn:
                for coin_id, raw in zip(batch, results):
                    if isinstance(raw, Exception) or raw is None:
                        errors += 1
                        continue
                    rows = _parse_ohlc(raw)
                    # Solo insertar el día de ayer
                    rows = [r for r in rows if r["date"] == yesterday]
                    if rows:
                        n = await _upsert_ohlcv(conn, coin_id, rows)
                        inserted += n

    logger.info(f"[ohlcv] sync_incremental completado: {inserted} filas para {yesterday}, {errors} errores")
    return {"mode": "incremental", "date": str(yesterday), "inserted": inserted, "errors": errors}


# ── Estado del sync ───────────────────────────────────────────────────────────

async def get_sync_status(pool: asyncpg.Pool) -> dict:
    """Devuelve estadísticas del estado actual de ohlcv_daily."""
    async with pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT
                COUNT(DISTINCT coin_id)  AS coins_with_data,
                COUNT(*)                 AS total_rows,
                MIN(date)                AS oldest_date,
                MAX(date)                AS newest_date
            FROM ohlcv_daily
        """)
        total_coins = await conn.fetchval("SELECT COUNT(*) FROM coins")

    return {
        "coins_with_data": stats["coins_with_data"],
        "total_coins":     total_coins,
        "total_rows":      stats["total_rows"],
        "oldest_date":     str(stats["oldest_date"]) if stats["oldest_date"] else None,
        "newest_date":     str(stats["newest_date"]) if stats["newest_date"] else None,
        "coverage_pct":    round(stats["coins_with_data"] / total_coins * 100, 1) if total_coins else 0,
    }
