-- AXIOM v2 — Schema de Alertas de Precio
-- Aplicar con: psql "$DATABASE_URL" -f scripts/02_alerts_schema.sql

-- ─────────────────────────────────────────────────────────────
-- Tabla: price_alerts
-- Una fila por alerta de precio configurada por el usuario.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alerts (
    id                SERIAL PRIMARY KEY,
    coin_id           TEXT        NOT NULL,
    symbol            TEXT        NOT NULL,
    exchange          TEXT        NOT NULL DEFAULT 'coingecko',

    -- Condición: 'above' (cruza hacia arriba) | 'below' (cruza hacia abajo)
    direction         TEXT        NOT NULL CHECK (direction IN ('above', 'below')),
    target_price      NUMERIC(20,8) NOT NULL,

    -- Comportamiento al cumplirse (configurable por alerta)
    recurring         BOOLEAN     NOT NULL DEFAULT false,
    active            BOOLEAN     NOT NULL DEFAULT true,

    -- Nota opcional que se incluye en el mensaje de Telegram
    note              TEXT,

    -- Estado para detección de CRUCE (no de simple "está por encima/debajo"):
    -- guardamos de qué lado del target estaba el precio en la última evaluación.
    -- 'above' | 'below' | NULL (sin evaluar aún)
    last_side         TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_triggered_at TIMESTAMPTZ,
    trigger_count     INTEGER     NOT NULL DEFAULT 0
);

-- Índice para traer las alertas activas rápido en cada evaluación
CREATE INDEX IF NOT EXISTS idx_price_alerts_active
    ON price_alerts (active) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_price_alerts_coin
    ON price_alerts (coin_id);
