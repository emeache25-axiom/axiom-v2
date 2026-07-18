-- AXIOM v2 — Migración 003
-- Tabla coin_info: cachea la información de proyecto que viene de CoinGecko
-- (/coins/{id}). Son datos que cambian poco (descripción, supply, links, ATH),
-- por eso se persisten y se refrescan periódicamente en vez de pedirlos en
-- caliente en cada vista.

CREATE TABLE IF NOT EXISTS coin_info (
    coin_id             TEXT PRIMARY KEY,

    -- Descripción del proyecto (es si existe, si no en)
    descripcion         TEXT,
    descripcion_lang    TEXT,           -- 'es' | 'en'

    -- Supply
    supply_circulante   NUMERIC,
    supply_total        NUMERIC,
    supply_max          NUMERIC,

    -- Máximos y mínimos históricos (USD)
    ath                 NUMERIC,
    ath_date            TIMESTAMPTZ,
    ath_change_pct      NUMERIC,
    atl                 NUMERIC,
    atl_date            TIMESTAMPTZ,

    -- Identidad del proyecto
    genesis_date        DATE,
    hashing_algorithm   TEXT,
    country_origin      TEXT,
    categories          JSONB,          -- categorías de CoinGecko (lista)

    -- Enlaces (homepage, whitepaper, twitter, github, explorers...)
    links               JSONB,

    -- Control de refresco
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Para saber rápido qué filas están vencidas y hay que refrescar
CREATE INDEX IF NOT EXISTS idx_coin_info_updated ON coin_info (updated_at);
