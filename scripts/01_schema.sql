-- AXIOM v2 — Schema inicial del módulo Régimen
-- Aplicar con: psql "$DATABASE_URL" -f scripts/01_schema.sql

-- ─────────────────────────────────────────────────────────────
-- Tabla: snapshots
-- Una fila por cada foto del mercado (cada 60 minutos).
-- Contiene los 3 regímenes y sus métricas como columnas directas.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
    id                SERIAL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    btc_price         NUMERIC(12,2) NOT NULL,

    -- Régimen de corto plazo: ALCISTA | LATERAL | BAJISTA
    regime_corto      TEXT        NOT NULL,
    conviction_corto  SMALLINT    NOT NULL,
    consensus_corto   SMALLINT    NOT NULL,
    confirmed_corto   BOOLEAN     NOT NULL,

    -- Régimen de medio plazo: ACUMULACION | ALCISTA_A | ALCISTA_B | DISTRIBUCION | BAJISTA
    regime_medio      TEXT        NOT NULL,
    conviction_medio  SMALLINT    NOT NULL,
    consensus_medio   SMALLINT    NOT NULL,
    confirmed_medio   BOOLEAN     NOT NULL,

    -- Régimen de largo plazo: ACUMULACION | ALCISTA_A | ALCISTA_B | DISTRIBUCION | BAJISTA
    regime_largo      TEXT        NOT NULL,
    conviction_largo  SMALLINT    NOT NULL,
    consensus_largo   SMALLINT    NOT NULL,
    confirmed_largo   BOOLEAN     NOT NULL
);

-- Índice para consultar la evolución temporal de los regímenes
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
    ON snapshots (created_at);


-- ─────────────────────────────────────────────────────────────
-- Tabla: signal_readings
-- Una fila por cada señal en cada snapshot.
-- Incluye señales núcleo (votan) y de contexto (no votan).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_readings (
    id            SERIAL PRIMARY KEY,
    snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,

    signal_id     TEXT    NOT NULL,   -- 'mvrv', 'nupl', 'funding_btc', etc.
    timeframe     TEXT    NOT NULL,   -- 'largo' | 'medio' | 'corto'
    dimension     TEXT,               -- 'valuacion' | 'momentum' | 'sentimiento' | 'flujo' | 'participacion'
    is_core       BOOLEAN NOT NULL,   -- true = vota al régimen | false = contexto

    raw_value     NUMERIC,            -- valor crudo de la señal
    voted_regime  TEXT                -- régimen votado (NULL si es de contexto)
);

-- Índice para traer todas las señales de un snapshot
CREATE INDEX IF NOT EXISTS idx_signal_readings_snapshot
    ON signal_readings (snapshot_id);

-- Índice para analizar una señal a lo largo del tiempo
CREATE INDEX IF NOT EXISTS idx_signal_readings_signal
    ON signal_readings (signal_id);
