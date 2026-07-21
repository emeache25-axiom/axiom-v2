-- AXIOM v2 — Migración 004
-- El PAR como unidad del universo.
--
-- pairs           → catálogo de pares tradeables en MEXC y CoinEx (~3.500)
-- pair_ohlcv      → velas diarias por par (crudas, para screener y backtesting)
-- pair_coin_alias → resolución manual de vínculos par→coin ambiguos
--
-- Ver AXIOM_modelo_pares.md para el diseño y las decisiones.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo de pares
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pairs (
    id              BIGSERIAL PRIMARY KEY,

    -- Identidad del par en el exchange
    exchange        TEXT NOT NULL,              -- 'mexc' | 'coinex'
    pair_symbol     TEXT NOT NULL,              -- símbolo REAL: 'ONTBTC'
    base            TEXT NOT NULL,              -- 'ONT'
    quote           TEXT NOT NULL,              -- 'BTC' | 'USDT' | ...

    -- Vínculo con el catálogo de coins. NULL permitido a propósito:
    -- si MEXC/CoinEx listan algo que CoinGecko no indexa, el par se guarda
    -- igual porque sigue siendo operable; solo queda sin metadata.
    coin_id         TEXT REFERENCES coins(id) ON DELETE SET NULL,

    tradeable       BOOLEAN NOT NULL DEFAULT true,

    -- Métricas del ticker (refrescadas cada 15-30 min) — el ranking
    last_price      NUMERIC(30,12),
    volume_24h      NUMERIC(24,2),              -- normalizado a USD
    change_24h      NUMERIC(10,4),
    bid             NUMERIC(30,12),
    ask             NUMERIC(30,12),
    spread_pct      NUMERIC(10,6),              -- (ask-bid)/mid*100

    -- Métricas derivadas de las velas (las calcula el sync de OHLCV)
    volatility_30d  NUMERIC(10,4),              -- rango medio diario %
    range_days_pct  NUMERIC(6,2),               -- % de días con rango > umbral
    candles_count   INTEGER NOT NULL DEFAULT 0,

    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (exchange, pair_symbol)
);

-- Índices para los tres criterios de ordenamiento del screener
CREATE INDEX IF NOT EXISTS idx_pairs_volume    ON pairs (volume_24h DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pairs_vol30     ON pairs (volatility_30d DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pairs_spread    ON pairs (spread_pct ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pairs_coin      ON pairs (coin_id);
CREATE INDEX IF NOT EXISTS idx_pairs_quote     ON pairs (quote);
CREATE INDEX IF NOT EXISTS idx_pairs_base      ON pairs (base);
CREATE INDEX IF NOT EXISTS idx_pairs_tradeable ON pairs (tradeable) WHERE tradeable;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Velas por par
-- ─────────────────────────────────────────────────────────────────────────────
-- Precisión 30,12: los pares en satoshis manejan valores como 0.00000113.
-- La de ohlcv_daily (24,8) se queda corta. Misma que usa strat_positions.
CREATE TABLE IF NOT EXISTS pair_ohlcv (
    pair_id     BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
    date        DATE   NOT NULL,
    open        NUMERIC(30,12),
    high        NUMERIC(30,12),
    low         NUMERIC(30,12),
    close       NUMERIC(30,12),
    volume      NUMERIC(30,8),                  -- volumen REAL del exchange
    PRIMARY KEY (pair_id, date)
);

CREATE INDEX IF NOT EXISTS idx_pair_ohlcv_date ON pair_ohlcv (date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Alias manuales par→coin
-- ─────────────────────────────────────────────────────────────────────────────
-- Para casos que el cruce automático por símbolo no resuelve:
-- símbolos que colisionan entre coins distintas, o variantes de nombre
-- (ej. TONCOIN en el exchange vs 'the-open-network' en CoinGecko).
CREATE TABLE IF NOT EXISTS pair_coin_alias (
    exchange    TEXT NOT NULL,
    base        TEXT NOT NULL,
    coin_id     TEXT NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (exchange, base)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Propiedad: si la migración se corre como superusuario (sudo -u postgres),
-- las tablas quedarían de 'postgres' y la app daría "permission denied".
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pairs           OWNER TO axiom_user;
ALTER TABLE pair_ohlcv      OWNER TO axiom_user;
ALTER TABLE pair_coin_alias OWNER TO axiom_user;
ALTER SEQUENCE pairs_id_seq OWNER TO axiom_user;
