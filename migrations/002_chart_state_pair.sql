-- AXIOM v2 — chart_state: persistir el par exacto (no solo coin_id)
-- Permite que al recargar la web se restaure ONT/BTC en vez de caer en ONT/USDT.

ALTER TABLE chart_state ADD COLUMN IF NOT EXISTS exchange  TEXT;
ALTER TABLE chart_state ADD COLUMN IF NOT EXISTS ex_symbol TEXT;
