-- AXIOM v2 — Schema del Bot de Paper-Trading
-- Aplicar: psql "$DATABASE_URL" -f scripts/03_bot_schema.sql

-- ─────────────────────────────────────────────────────────────
-- Configuración del bot (una sola fila, id=1)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_config (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled         BOOLEAN     NOT NULL DEFAULT false,
    initial_balance NUMERIC(20,2) NOT NULL DEFAULT 10000,
    balance         NUMERIC(20,2) NOT NULL DEFAULT 10000,   -- efectivo disponible
    trade_amount    NUMERIC(20,2) NOT NULL DEFAULT 1000,    -- monto fijo por trade
    stop_loss_pct   NUMERIC(6,3)  NOT NULL DEFAULT 5.0,     -- % bajo la entrada
    max_positions   INTEGER     NOT NULL DEFAULT 10,        -- posiciones abiertas simultáneas
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bot_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Reglas de entrada (armadas por el usuario en el panel)
-- conditions: JSONB array de { field, op, value }
--   field: regimen_largo|regimen_medio|regimen_corto|
--          conviccion_largo|conviccion_medio|conviccion_corto|
--          dist_soporte|dist_resistencia|rsi
--   op:    es|no_es|gt|lt
--   value: string (regímenes) | number
-- Todas las condiciones de una regla son AND.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_rules (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL,
    active     BOOLEAN     NOT NULL DEFAULT true,
    conditions JSONB       NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Posiciones simuladas (abiertas y cerradas)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_positions (
    id            SERIAL PRIMARY KEY,
    coin_id       TEXT        NOT NULL,
    symbol        TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),

    entry_price   NUMERIC(20,8) NOT NULL,
    qty           NUMERIC(30,10) NOT NULL,          -- unidades compradas
    amount        NUMERIC(20,2) NOT NULL,           -- USD invertidos
    stop_price    NUMERIC(20,8) NOT NULL,

    exit_price    NUMERIC(20,8),
    pnl           NUMERIC(20,2),                    -- ganancia/pérdida en USD (al cerrar)
    pnl_pct       NUMERIC(10,3),

    rule_id       INTEGER REFERENCES bot_rules(id) ON DELETE SET NULL,
    entry_reason  TEXT,
    exit_reason   TEXT,                             -- 'regime_flip' | 'stop_loss'

    opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_positions_status ON bot_positions (status);
CREATE INDEX IF NOT EXISTS idx_bot_positions_coin   ON bot_positions (coin_id);

-- ─────────────────────────────────────────────────────────────
-- Log de evaluaciones (auditoría: por qué entró o no)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_signals (
    id         SERIAL PRIMARY KEY,
    coin_id    TEXT        NOT NULL,
    symbol     TEXT        NOT NULL,
    rule_id    INTEGER,
    matched    BOOLEAN     NOT NULL,
    detail     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_signals_created ON bot_signals (created_at DESC);
