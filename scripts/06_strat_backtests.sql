-- AXIOM v2 — Tabla de resultados de backtests históricos
-- Aplicar: psql "$DATABASE_URL" -f scripts/06_strat_backtests.sql
--
-- Guarda el RESULTADO de cada backtest (params usados + métricas), no las velas.
-- Liviano y útil: un historial de experimentos de optimización, comparable.

CREATE TABLE IF NOT EXISTS strat_backtests (
    id            SERIAL PRIMARY KEY,
    strategy_id   INTEGER REFERENCES strat_strategies(id) ON DELETE CASCADE,
    strategy_key  TEXT    NOT NULL,            -- plugin key (por si se borra la instancia)
    strategy_name TEXT    NOT NULL,

    -- Qué se backtesteó
    pair_symbol   TEXT    NOT NULL,
    exchange      TEXT    NOT NULL,
    timeframe     TEXT    NOT NULL,
    candles_used  INTEGER NOT NULL,
    period_from   TIMESTAMPTZ,                 -- primera vela
    period_to     TIMESTAMPTZ,                 -- última vela

    -- Parámetros usados (snapshot)
    params        JSONB   NOT NULL DEFAULT '{}',
    initial_balance NUMERIC(20,2),
    trade_amount  NUMERIC(20,2),

    -- Métricas (resultado del backtest)
    total_return  NUMERIC(12,3),
    trades_total  INTEGER,
    win_rate      NUMERIC(6,2),
    profit_factor NUMERIC(10,3),
    expectancy    NUMERIC(16,4),
    max_drawdown  NUMERIC(8,3),
    sharpe        NUMERIC(10,3),
    best_trade    NUMERIC(16,4),
    worst_trade   NUMERIC(16,4),

    -- Resultado completo (equity curve + trades) por si se quiere re-ver
    full_result   JSONB,

    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strat_bt_strat ON strat_backtests (strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strat_bt_key   ON strat_backtests (strategy_key, created_at DESC);
