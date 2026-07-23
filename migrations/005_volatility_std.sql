-- AXIOM v2 — Migración 005
-- Tercera métrica de volatilidad: desvío estándar de los retornos diarios.
--
-- Las tres métricas que ordenan el screener:
--   volatility_30d — rango diario promedio (high-low)/low %   ← PRINCIPAL
--   volatility_std — desvío estándar de retornos diarios %    ← esta migración
--   range_days_pct — % de días con rango sobre el umbral
--
-- Ver AXIOM_modelo_pares.md

ALTER TABLE pairs ADD COLUMN IF NOT EXISTS volatility_std NUMERIC(10,4);

CREATE INDEX IF NOT EXISTS idx_pairs_volstd
    ON pairs (volatility_std DESC NULLS LAST);

-- Por si la migración se corre como superusuario
ALTER TABLE pairs OWNER TO axiom_user;
