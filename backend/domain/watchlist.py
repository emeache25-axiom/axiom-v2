"""
AXIOM v2 — Capa de dominio: colección Watchlist.
════════════════════════════════════════════════════════════════════════════
NO es entidad: es una COLECCIÓN de Pares con CRUD y GRUPOS nombrados. La riqueza
(precio vivo, sparkline) vive en el Par; la Watchlist agrupa y persiste.

Cada elemento devuelto es una fila que puede materializarse como Par:
    par = domain.par(row["coin_id"], row["exchange"], row["quote"])

GRUPOS: un par pertenece a UN solo grupo (columna `grupo`, relación simple).
NOTA: la migración de la columna `grupo` es un paso aparte (ver diseño §7). Este
código detecta si la columna existe y degrada con gracia si todavía no está, para
no romper hasta que se corra la migración.

No incluye screener/sugeridas (eso es de Mercado).
"""
from __future__ import annotations


class Watchlist:
    def __init__(self, pool):
        self._pool = pool
        self._has_grupo: bool | None = None   # se detecta una vez

    async def _grupo_existe(self) -> bool:
        if self._has_grupo is not None:
            return self._has_grupo
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT 1 FROM information_schema.columns
                   WHERE table_name='watchlist' AND column_name='grupo'"""
            )
        self._has_grupo = row is not None
        return self._has_grupo

    # ── Lecturas ──────────────────────────────────────────────────────────────

    async def listas(self) -> list:
        """Grupos existentes con conteo. Si no hay columna grupo, devuelve 'general'."""
        if not await self._grupo_existe():
            n = await self._contar_total()
            return [{"grupo": "general", "n_pares": n}]
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT COALESCE(grupo,'general') AS grupo, COUNT(*) AS n_pares
                   FROM watchlist GROUP BY COALESCE(grupo,'general') ORDER BY grupo"""
            )
        return [dict(r) for r in rows]

    async def pares_seguidos(self, grupo: str | None = None) -> list:
        """Pares de un grupo (o todos). Cada fila se puede materializar como Par."""
        base = """SELECT id, coin_id, base AS symbol, quote, exchange,
                         pair_symbol, operable, bot_enabled, position{grupo_col}
                  FROM watchlist"""
        if await self._grupo_existe():
            base = base.format(grupo_col=", COALESCE(grupo,'general') AS grupo")
            if grupo:
                base += " WHERE COALESCE(grupo,'general')=$1"
                order = " ORDER BY position"
                async with self._pool.acquire() as conn:
                    rows = await conn.fetch(base + order, grupo)
            else:
                async with self._pool.acquire() as conn:
                    rows = await conn.fetch(base + " ORDER BY position")
        else:
            base = base.format(grupo_col="")
            async with self._pool.acquire() as conn:
                rows = await conn.fetch(base + " ORDER BY position")
        return [dict(r) for r in rows]

    async def _contar_total(self) -> int:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT COUNT(*) AS n FROM watchlist")
        return row["n"] if row else 0

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def agregar_par(self, coin_id, exchange, quote, pair_symbol,
                          base=None, grupo="general"):
        """Agrega un par. Si existe la columna grupo, lo asigna."""
        base = base or (pair_symbol.replace(quote, "") if pair_symbol and quote else None)
        async with self._pool.acquire() as conn:
            if await self._grupo_existe():
                await conn.execute(
                    """INSERT INTO watchlist (coin_id, base, quote, exchange, pair_symbol, grupo)
                       VALUES ($1,$2,$3,$4,$5,$6)
                       ON CONFLICT DO NOTHING""",
                    coin_id, base, quote, exchange, pair_symbol, grupo,
                )
            else:
                await conn.execute(
                    """INSERT INTO watchlist (coin_id, base, quote, exchange, pair_symbol)
                       VALUES ($1,$2,$3,$4,$5)
                       ON CONFLICT DO NOTHING""",
                    coin_id, base, quote, exchange, pair_symbol,
                )

    async def quitar_par(self, id):
        async with self._pool.acquire() as conn:
            await conn.execute("DELETE FROM watchlist WHERE id=$1", id)

    async def mover_par(self, id, grupo):
        if not await self._grupo_existe():
            return  # sin columna, no-op (hasta la migración)
        async with self._pool.acquire() as conn:
            await conn.execute("UPDATE watchlist SET grupo=$2 WHERE id=$1", id, grupo)

    async def renombrar_grupo(self, viejo, nuevo):
        if not await self._grupo_existe():
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE watchlist SET grupo=$2 WHERE COALESCE(grupo,'general')=$1",
                viejo, nuevo)

    async def borrar_grupo(self, grupo, destino="general"):
        if not await self._grupo_existe():
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE watchlist SET grupo=$2 WHERE COALESCE(grupo,'general')=$1",
                grupo, destino)

    async def reordenar(self, id, position):
        async with self._pool.acquire() as conn:
            await conn.execute("UPDATE watchlist SET position=$2 WHERE id=$1", id, position)
