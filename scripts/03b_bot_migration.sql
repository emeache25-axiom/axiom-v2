-- AXIOM v2 — Migración del Bot: columnas nuevas
-- Aplicar: psql "$DATABASE_URL" -f scripts/03b_bot_migration.sql

ALTER TABLE bot_positions
    ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'binance';

ALTER TABLE bot_rules
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'entry';

-- Constraint del kind (se agrega solo si no existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bot_rules_kind_check'
    ) THEN
        ALTER TABLE bot_rules
            ADD CONSTRAINT bot_rules_kind_check CHECK (kind IN ('entry', 'exit'));
    END IF;
END $$;
