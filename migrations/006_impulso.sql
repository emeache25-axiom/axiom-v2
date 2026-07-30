-- AXIOM v2 — Migración 006
-- Impulso open→high: la quinta y sexta métrica de los pares.
--
-- Por qué hace falta, teniendo ya las tres de volatilidad: el RANGO
-- (high−low)/low no distingue dirección. Un día que abre arriba y cierra abajo
-- tiene rango alto igual que uno que abre abajo y sube. El IMPULSO
-- (high−open)/open mide solo el tramo alcista desde la apertura — que es el
-- que importa para comprar en la apertura y vender en el máximo del día.
--
-- Reemplaza al screener open→high de la pantalla Watchlist, que operaba sobre
-- la misma idea pero por fuera del universo de pares.
--
-- Ver AXIOM_modelo_pares.md

ALTER TABLE pairs ADD COLUMN IF NOT EXISTS impulso_oh       NUMERIC(10,4);
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS impulso_dias_pct NUMERIC(6,2);

COMMENT ON COLUMN pairs.impulso_oh IS
  'Promedio de (high-open)/open % sobre las últimas 30 velas diarias';
COMMENT ON COLUMN pairs.impulso_dias_pct IS
  'Porcentaje de días cuyo impulso superó el umbral (1.5% por defecto)';

CREATE INDEX IF NOT EXISTS idx_pairs_impulso
    ON pairs (impulso_oh DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pairs_impulso_dias
    ON pairs (impulso_dias_pct DESC NULLS LAST);

-- Por si la migración se corre como superusuario
ALTER TABLE pairs OWNER TO axiom_user;
