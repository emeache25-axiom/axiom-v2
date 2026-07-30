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

from backend.domain.registry import capacidad, Param


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

    @capacidad(
        nombre="mi_watchlist",
        descripcion=(
            "Los pares que el usuario tiene en seguimiento, con su exchange, "
            "símbolo, si es operable, si tiene bot activo, y los datos de "
            "mercado de cada coin (precio, variaciones, capitalización). Usar "
            "cuando pregunte por 'mis pares', 'mi watchlist' o 'lo que sigo'."
        ),
        entidad="watchlist",
        categoria="watchlist",
        costo="barato",
        devuelve=(
            "lista de pares con coin_id, símbolo, nombre, quote, exchange, "
            "pair_symbol, operable, bot_enabled, grupo, orden, y precio, "
            "change_24h, change_7d, volumen 24h, market_cap y rank de la coin"
        ),
        mide=(
            "las filas de la tabla watchlist —los pares que el usuario cargó "
            "manualmente, tal como los guardó— cruzadas con el precio, el "
            "volumen y la capitalización vigentes de la tabla coins"
        ),
        infiere="nada",
        no_sabe=(
            "si esos pares siguen listados y operables en su exchange: la "
            "watchlist guarda lo que el usuario cargó y no se revalida contra "
            "el catálogo de pares, así que un par deslistado seguiría "
            "apareciendo. El precio es el agregado en USD de la coin (sync cada "
            "6 h), no el precio del par en su exchange ni en tiempo real"
        ),
        fuente=(
            "tabla `watchlist` (alta manual del usuario) cruzada con `coins` "
            "(sync desde CoinGecko cada 6 h)"
        ),
        metodo="lectura directa con LEFT JOIN por coin_id; sin cálculo",
        parametros=[
            Param(
                nombre="grupo",
                tipo=str,
                descripcion="Filtrar por grupo nombrado. Si se omite, devuelve todos.",
                requerido=False,
                ejemplos=("general",),
            ),
        ],
    )
    async def pares_seguidos(self, grupo: str | None = None) -> list:
        """
        Pares de un grupo (o todos), enriquecidos con datos de mercado.
        Cada fila se puede materializar como Par.

        El LEFT JOIN con `coins` trae precio y capitalización en la misma
        consulta: antes esto se hacía con una segunda query desde chat.py, lo
        que duplicaba lógica en el consumidor.
        """
        tiene_grupo = await self._grupo_existe()
        col_grupo = ", COALESCE(w.grupo,'general') AS grupo" if tiene_grupo else ""

        sql = f"""
            SELECT w.id, w.coin_id, w.base AS symbol, w.quote, w.exchange,
                   w.pair_symbol, w.operable, w.bot_enabled, w.position{col_grupo},
                   c.name, c.price, c.change_24h, c.change_7d,
                   c.market_cap, c.volume_24h, c.rank, c.supercat, c.image
            FROM watchlist w
            LEFT JOIN coins c ON c.id = w.coin_id
        """
        async with self._pool.acquire() as conn:
            if tiene_grupo and grupo:
                rows = await conn.fetch(
                    sql + " WHERE COALESCE(w.grupo,'general')=$1 ORDER BY w.position",
                    grupo)
            else:
                rows = await conn.fetch(sql + " ORDER BY w.position")

        def _f(v):
            return float(v) if v is not None else None

        salida = []
        for r in rows:
            d = dict(r)
            for campo in ("price", "change_24h", "change_7d",
                          "market_cap", "volume_24h"):
                d[campo] = _f(d.get(campo))
            if d.get("symbol"):
                d["symbol"] = d["symbol"].upper()
            salida.append(d)
        return salida

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
