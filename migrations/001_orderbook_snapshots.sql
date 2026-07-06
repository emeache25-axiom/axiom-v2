-- AXIOM v2 — Order Book Capture · migración 001
-- Tabla de snapshots del libro de órdenes para pares satoshi /BTC (CoinEx).
-- Diseñada para hardware modesto: métricas de desequilibrio pre-calculadas en
-- cada snapshot para no reprocesar millones de filas después.

CREATE TABLE IF NOT EXISTS ob_snapshots (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL,          -- momento del snapshot (server)
    exchange     TEXT NOT NULL,                 -- 'coinex'
    pair         TEXT NOT NULL,                 -- 'ONTBTC', 'ROSEBTC'

    -- Mejores niveles (para consultas rápidas sin abrir el JSON)
    best_bid     DOUBLE PRECISION,              -- mejor precio de compra
    best_ask     DOUBLE PRECISION,              -- mejor precio de venta
    mid          DOUBLE PRECISION,              -- (bid+ask)/2
    spread_pct   DOUBLE PRECISION,              -- (ask-bid)/mid * 100

    -- Métricas de desequilibrio (pre-calculadas sobre los N niveles capturados)
    bid_vol      DOUBLE PRECISION,              -- suma de volumen del lado compra
    ask_vol      DOUBLE PRECISION,              -- suma de volumen del lado venta
    imbalance    DOUBLE PRECISION,              -- (bid_vol-ask_vol)/(bid_vol+ask_vol) ∈ [-1,1]

    -- Libro completo capturado (N niveles por lado) como JSON, por si se quiere
    -- reanalizar con otra métrica en el futuro. bids/asks = [[precio, volumen], ...]
    bids         JSONB,
    asks         JSONB
);

-- Índice principal: consultar por par + tiempo (el 99% de las queries).
CREATE INDEX IF NOT EXISTS idx_ob_pair_ts ON ob_snapshots (pair, ts);
-- Índice para barrer por tiempo global (limpieza, exportación).
CREATE INDEX IF NOT EXISTS idx_ob_ts ON ob_snapshots (ts);

-- NOTA sobre volumen de datos (hardware modesto):
--   snapshot cada 2s = 43.200/día por par. 2 pares ≈ 86.400 filas/día.
--   30 días ≈ 2.6M filas. PostgreSQL 17 lo maneja sin problema con estos índices.
--   El JSONB de 10 niveles por lado pesa ~400 bytes; 2.6M ≈ ~1GB en 30 días.
--   Si el disco aprieta, se puede purgar el JSONB viejo conservando las métricas
--   (best_bid/ask, imbalance, etc.) que son lo que se usa para el análisis.
