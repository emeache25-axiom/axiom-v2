# AXIOM v2 — Modelo de datos: el PAR como unidad

Diseño del universo de datos centrado en **pares tradeables** en lugar de coins
rankeadas por capitalización. Nace del análisis del 20-21 de julio de 2026.

---

## 1. El cambio de eje

**Antes:** el universo era el catálogo de CoinGecko (2.393 coins ordenadas por
market cap). El sistema razonaba sobre *coins*.

**Ahora:** el universo son los **pares que se pueden operar en MEXC y CoinEx**
(~3.503). El sistema razona sobre *pares*.

### Por qué

El ranking por capitalización mide **tamaño contable**, no operabilidad. Medido
sobre el top 1000 de CoinGecko:

- 150 de las 348 no cubiertas eran **stablecoins y activos tokenizados**
  (BUIDL de BlackRock, fondos de tesorería de Janus Henderson, bonos del Tesoro,
  instrumentos de financiamiento privado `PC00000xx`). Activos enormes que no
  oscilan y no se transan en exchanges retail.
- De las 198 restantes, muchas son **tokens de exchange** (GT, BMX, BTSE, TKX)
  que solo cotizan en su propia casa, o **micro-caps que solo viven en DEX**
  (Olympus cotiza únicamente en Balancer, Camelot, Curve, Sushiswap, Uniswap).
- Cubrir el 100% del top 1000 exigiría integrar decenas de exchanges dispersos
  (BVOX, CoinUp.io, GroveX, Icrypex, Indodax, XT.COM, LBank…) más DEX. Sin
  concentración: cada exchange nuevo aporta una o dos coins.

Medición de exchanges candidatos: los cinco evaluados (Bitget, KuCoin, OKX,
Kraken, Bybit) aportaban **733 bases nuevas pero solo 49 del catálogo**. Bitget
solo, **11**. Rendimiento decreciente confirmado.

**Al mismo tiempo**, el ranking por capitalización *oculta* lo que sí importa:
en el top 15 de pares por volumen de MEXC/CoinEx aparecen **UPC (5,0 M USD)** y
**WXT (3,9 M USD)** — pares que se transan más que muchas coins del top 200 de
CoinGecko.

**Conclusión:** el universo útil no es "lo que existe" sino "lo que se puede
operar". Y eso lo definen los exchanges, no el agregador.

### Qué se conserva de CoinGecko

CoinGecko sigue siendo la fuente de **metadata**, donde no tiene reemplazo:
ranking, capitalización, sector, y la ficha de proyecto (descripción, supply,
ATH/ATL, links). El supply circulante es un dato de *investigación*, no de
mercado: ningún exchange lo tiene.

Es además la parte de CoinGecko que **funciona bien**: `/coins/markets` trae
2.000 coins en 8 llamadas cada 6 h, y `coin_info` es bajo demanda con TTL de
7 días. El problema nunca fue CoinGecko: fue pedirle velas de a una coin por vez.

---

## 2. Dimensionamiento (medido el 20/07/2026)

| Exchange | Pares totales | /BTC | /USDT |
|---|---|---|---|
| MEXC | 2.144 | 22 | 1.765 |
| CoinEx | 1.110 | **179** | 859 |

**Pares combinados MEXC + CoinEx: 3.503**

Distribución por volumen 24h:

| Umbral | Pares |
|---|---|
| todos | 3.243 |
| > 10.000 USD | **2.198** |
| > 100.000 USD | 385 |
| > 1.000.000 USD | 49 |

Pares contra BTC: **187 coins distintas** en total. CoinEx concentra el 73%.
Es el exchange central para la estrategia de oscilación en satoshis.

Cobertura de metadata: de las 2.393 coins del catálogo, **1.250 tienen par**
en los exchanges (52%); del top 300, **219** (73%).

---

## 3. Estructura de tablas

### 3.1 `pairs` — catálogo de pares tradeables (NUEVA)

Reemplaza a `coin_exchanges`. Modela lo que `watchlist` ya modela bien.

```sql
CREATE TABLE pairs (
    id              BIGSERIAL PRIMARY KEY,
    exchange        TEXT NOT NULL,           -- 'mexc' | 'coinex'
    pair_symbol     TEXT NOT NULL,           -- símbolo REAL del exchange: 'ONTBTC'
    base            TEXT NOT NULL,           -- 'ONT'
    quote           TEXT NOT NULL,           -- 'BTC' | 'USDT' | ...
    coin_id         TEXT REFERENCES coins(id) ON DELETE SET NULL,  -- NULL permitido
    tradeable       BOOLEAN NOT NULL DEFAULT true,   -- el exchange lo marca activo
    -- métricas del ticker (se refrescan seguido, son el ranking)
    last_price      NUMERIC(30,12),
    volume_24h      NUMERIC(24,2),           -- en moneda quote, normalizado a USD
    change_24h      NUMERIC(10,4),
    bid             NUMERIC(30,12),
    ask             NUMERIC(30,12),
    spread_pct      NUMERIC(10,6),           -- (ask-bid)/mid * 100
    -- métricas derivadas de velas (las calcula el sync de OHLCV)
    volatility_30d  NUMERIC(10,4),           -- rango medio diario %
    range_days_pct  NUMERIC(6,2),            -- % de días con rango > umbral
    candles_count   INTEGER DEFAULT 0,       -- velas disponibles
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exchange, pair_symbol)
);

CREATE INDEX idx_pairs_volume    ON pairs (volume_24h DESC NULLS LAST);
CREATE INDEX idx_pairs_vol30     ON pairs (volatility_30d DESC NULLS LAST);
CREATE INDEX idx_pairs_spread    ON pairs (spread_pct ASC NULLS LAST);
CREATE INDEX idx_pairs_coin      ON pairs (coin_id);
CREATE INDEX idx_pairs_quote     ON pairs (quote);
CREATE INDEX idx_pairs_tradeable ON pairs (tradeable) WHERE tradeable;
ALTER TABLE pairs OWNER TO axiom_user;
```

**Decisiones clave:**

- **`coin_id` puede ser NULL.** Si MEXC/CoinEx listan algo que CoinGecko no
  indexa, el par se guarda igual: sigue siendo operable. Solo queda sin metadata.
- **Se guardan TODOS los pares**, sin filtrar por volumen. Cuesta poco y respeta
  el principio de no descartar nada. El filtro va al consultar.
- **Ambos mercados si el par está en los dos exchanges.** ONT/USDT en MEXC y en
  CoinEx son dos filas: precios y liquidez distintos, y para operar importa cuál.
  Habilita además comparación entre mercados a futuro.
- **`last_seen`** permite detectar pares deslistados sin borrarlos.
- Las tres métricas de ordenamiento (**volumen, volatilidad, spread**) viven en
  la misma fila → ordenar por cualquiera es un `ORDER BY` indexado.

### 3.2 `pair_ohlcv` — velas por par (NUEVA)

```sql
CREATE TABLE pair_ohlcv (
    pair_id     BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    open        NUMERIC(30,12),
    high        NUMERIC(30,12),
    low         NUMERIC(30,12),
    close       NUMERIC(30,12),
    volume      NUMERIC(30,8),      -- volumen REAL del exchange
    PRIMARY KEY (pair_id, date)
);
CREATE INDEX idx_pair_ohlcv_date ON pair_ohlcv (date);
ALTER TABLE pair_ohlcv OWNER TO axiom_user;
```

**Por qué velas crudas y no métricas precalculadas:** las métricas resuelven el
screener de hoy, pero sin historia cruda no hay **backtesting** ni screeners
futuros con criterios nuevos. Ya existe un motor de backtesting: necesita la
materia prima.

**Precisión `NUMERIC(30,12)`:** los pares en satoshis manejan valores como
`0.00000113`. La precisión de `ohlcv_daily` (`24,8`) se queda corta. Se toma la
misma que ya usa `strat_positions`.

**Alcance del sync:** solo pares con `volume_24h > umbral` (por defecto 10.000
USD → ~2.198 pares). El umbral es **configurable por el usuario**.

---

## 4. Vinculación par → coin

El punto delicado: MEXC dice `ONDOUSDT`; hay que saber que ese `ONDO` es
`ondo-finance`.

**Estrategia en capas:**

1. **Cruce directo por símbolo** cuando es unívoco en `coins`.
2. **Desempate por capitalización** cuando dos coins comparten símbolo: gana la
   de mayor market cap (heurística: el par listado suele ser el activo grande).
3. **Alias manuales** en una tabla chica para casos conocidos
   (`TONCOIN → the-open-network`, etc.).
4. **Sin vincular** → `coin_id = NULL`, registrado para revisión.

```sql
CREATE TABLE pair_coin_alias (
    exchange    TEXT NOT NULL,
    base        TEXT NOT NULL,
    coin_id     TEXT NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
    note        TEXT,
    PRIMARY KEY (exchange, base)
);
ALTER TABLE pair_coin_alias OWNER TO axiom_user;
```

Casos detectados que requieren alias o revisión: `TON` (Toncoin se lista como
TONCOIN en algunos exchanges), `LEO`, y los símbolos que colisionan entre coins
distintas.

**Acceso a la metadata desde el par** (requisito explícito): teniendo `coin_id`,
un `JOIN` con `coins` da ranking, capitalización y sector; con `coin_info` da
descripción, supply, ATH, links y web. Ejemplo: viendo `ONDO/USDT` se accede a
toda la ficha de Ondo Finance.

---

## 5. Sincronización

### 5.1 Catálogo de pares — `sync_pairs`
- **Frecuencia:** cada 6 h (junto al sync de coins) y al arrancar.
- **Costo:** **2 llamadas** (una por exchange). Sin rate limit.
- Endpoints: `/api/v3/exchangeInfo` (MEXC), `/v2/spot/market` (CoinEx).
- Upsert por `(exchange, pair_symbol)`; actualiza `last_seen`; marca
  `tradeable=false` los que dejaron de aparecer.

### 5.2 Tickers / ranking — `sync_tickers`
- **Frecuencia:** cada 15-30 min.
- **Costo:** **2 llamadas** (`/api/v3/ticker/24hr` y `/v2/spot/ticker` devuelven
  TODOS los pares de una vez).
- Actualiza `last_price`, `volume_24h`, `change_24h`, `bid`, `ask`, `spread_pct`.
- Es lo que mantiene vivo el ranking por volumen y spread.

### 5.3 Velas — `sync_pair_ohlcv`
- **Frecuencia:** diaria.
- **Alcance:** pares con `volume_24h > umbral` (configurable, por defecto 10 k).
- **Costo:** ~2.198 llamadas repartidas entre MEXC (~1.200 req/min) y CoinEx.
  **Minutos**, no horas.
- Usa los **adaptadores ya construidos** (`get_adapter(ex).get_ohlcv()`).
- Al terminar, recalcula `volatility_30d`, `range_days_pct` y `candles_count`
  en `pairs`.

**Comparación con el sync actual de `ohlcv_daily`:** 2.392 llamadas a CoinGecko
(límite ~30/min) → imposible, 0 filas insertadas. Contra 2.198 llamadas a
exchanges (límite ~1.200/min) → minutos. **Y con volumen real**, que CoinGecko
no devuelve.

---

## 6. Qué pasa con las tablas actuales

### 6.1 `coin_exchanges` → **SE ELIMINA**

Es la versión pobre de `pairs`:
- Clave `(coin_id, exchange)` → **un solo símbolo por coin y exchange**. No puede
  representar que ONT tiene `ONTUSDT` *y* `ONTBTC` en CoinEx.
- Congelada desde junio de 2026; ningún job la actualiza.
- Sin CoinEx (cero filas), pese a ser exchange operable.
- 774 de sus 1.830 filas apuntan a `'coingecko'`, que no es un exchange.

**Único consumidor:** `charts.py`, en tres puntos, para resolver a qué exchange
pedir velas cuando el frontend no manda el par explícito.

**Migración:** reemplazar esas tres consultas por `pairs`, eligiendo el par de
mayor volumen para esa coin:

```sql
SELECT exchange, pair_symbol
FROM pairs
WHERE coin_id = $1 AND tradeable
ORDER BY volume_24h DESC NULLS LAST
LIMIT 1;
```

Mejora de paso el comportamiento: hoy devuelve un par arbitrario (`LIMIT 1` sin
orden); pasaría a devolver el más líquido.

Luego: `DROP TABLE coin_exchanges;`

### 6.2 `ohlcv_daily` → **SE MANTIENE, con alcance reducido**

No se elimina, porque guarda algo que `pair_ohlcv` **no** puede dar: la vela de
la coin **en USD agregado**, que es el precio de referencia global — el mismo
concepto que usa el mapa de sectores.

Pero se le corrige el problema de raíz:

| | Antes | Después |
|---|---|---|
| Alcance | 2.392 coins | **top 300 por market cap** |
| Fuente | CoinGecko `/coins/{id}/ohlc` | igual |
| Llamadas/día | 2.392 (imposible) | ~300 (viable: ~10 min) |
| Para qué | screeners + bot | referencia USD, régimen, contexto |

Los **screeners de volatilidad e impulso migran a `pair_ohlcv`** — que es donde
tiene sentido medir oscilación: sobre el par que vas a operar, no sobre un
promedio agregado.

El **bot** (RSI, soportes/resistencias) también debería migrar a `pair_ohlcv`:
opera pares, no coins. Mitigado por ahora: está en paper trading.

**Alternativa a evaluar:** si tras la migración nadie consulta `ohlcv_daily`,
se elimina también. Queda como decisión abierta tras medir el uso real.

### 6.3 `watchlist` → **sin cambios**

Ya modela pares correctamente. A futuro podría referenciar `pairs(id)` en vez de
repetir `exchange`/`pair_symbol`, pero no es urgente y rompería compatibilidad.

### 6.4 `watchlist_old` → **eliminar** (residuo sin uso)

---

## 7. El screener sobre el nuevo modelo

La consulta que hoy devuelve 0 resultados pasa a ser SQL directo sobre `pairs`:

```sql
SELECT p.exchange, p.pair_symbol, p.base, p.quote,
       p.volume_24h, p.volatility_30d, p.range_days_pct, p.spread_pct,
       c.name, c.rank, c.market_cap, c.supercat
FROM pairs p
LEFT JOIN coins c ON c.id = p.coin_id
WHERE p.tradeable
  AND p.volume_24h  > $umbral_volumen
  AND p.quote       = $quote          -- 'BTC' para la estrategia en satoshis
  AND p.range_days_pct >= $min_pct_ok
  AND (c.market_cap IS NULL OR c.market_cap < $max_mcap)
ORDER BY p.volume_24h DESC             -- o volatility_30d / spread_pct
LIMIT $n;
```

**Ordenamiento configurable** (requisito explícito): `volume_24h` por defecto,
con opción de `volatility_30d` o `spread_pct`. Los tres están indexados.

**El caso de uso original queda cubierto:** *"altcoins de baja capitalización con
par /BTC que oscilen de forma repetible"* → `quote='BTC'`, `max_mcap` bajo,
`range_days_pct` alto, ordenado por volatilidad. Respuesta en milisegundos.

El **spread** es crítico para la estrategia de satoshis: si el spread es de 2
satoshis y el objetivo es ganar 2, no hay negocio. Ahora es filtrable.

---

## 8. Criterio: en vivo vs. almacenado

Regla derivada del análisis:

- **Almacenar** cuando la consulta toca **muchos** pares y tolera datos de horas:
  screeners, rankings, backtesting. En vivo sería inviable — evaluar volatilidad
  de 2.198 pares en caliente son ~2.198 llamadas: **5 a 15 minutos por consulta**,
  contra milisegundos en SQL.
- **En vivo** cuando toca **uno** y se quiere exactitud: gráfico de un par,
  precio del header, order book. Los gráficos ya funcionan así y no cambian.
- **Caché con TTL** para lo caro pero estable: `coin_info` (7 días).
- **Dos etapas** para lo caro sobre muchos: filtro barato en SQL → 20 candidatas
  → análisis fino en vivo sobre esas.

---

## 9. Plan de implementación

| # | Paso | Entregable | Riesgo |
|---|---|---|---|
| 1 | Migración `004_pairs.sql` | `pairs`, `pair_ohlcv`, `pair_coin_alias` | ninguno (tablas nuevas) |
| 2 | `sync_pairs` + vinculación con coins | catálogo poblado (~3.503) | bajo |
| 3 | `sync_tickers` (job 15-30 min) | ranking vivo por volumen/spread | bajo |
| 4 | `sync_pair_ohlcv` + métricas derivadas | velas de ~2.198 pares | medio (volumen de datos) |
| 5 | Screener sobre `pairs` | screener funcionando | bajo |
| 6 | Migrar `charts.py` a `pairs` | `coin_exchanges` sin consumidores | bajo |
| 7 | `DROP TABLE coin_exchanges` + `watchlist_old` | limpieza | ninguno |
| 8 | Reducir `ohlcv_daily` al top 300 | sync viable | bajo |
| 9 | Migrar bot a `pair_ohlcv` | bot sobre pares reales | medio |

Los pasos 1-5 son el núcleo: dejan el screener funcionando. El resto es limpieza
y consolidación.

---

## 10. Qué resuelve

| Problema | Estado |
|---|---|
| Screener de volatilidad devuelve 0 | Resuelto: velas frescas de pares reales |
| `ohlcv_daily` con 13 días de retraso | Resuelto: sync viable (300 vs 2.392 llamadas) |
| Volumen siempre NULL | Resuelto: los exchanges lo devuelven |
| No se puede screenear pares /BTC | Resuelto: el par es la unidad |
| `coin_exchanges` congelada y sin CoinEx | Resuelto: `pairs` se sincroniza cada 6 h |
| No se puede filtrar por spread | Resuelto: está en `pairs` |
| Rate limit de CoinGecko | Resuelto: las velas vienen de exchanges |
| Metadata desde el par | Resuelto: `JOIN` con `coins`/`coin_info` |

---

## 11. Decisiones registradas

1. El universo son **pares tradeables en MEXC y CoinEx**, no el top-N por
   capitalización.
2. **Binance** queda como adaptador disponible pero **fuera del universo**: no se
   opera ahí.
3. Se guardan **todos los pares**, sin filtro de volumen. El filtro va al
   consultar.
4. Umbral de sync de velas: **10.000 USD por defecto, configurable**.
5. **Velas crudas**, no métricas precalculadas (el backtesting necesita historia).
6. Si un par está en ambos exchanges, **se guardan ambos mercados**.
7. Un par que MEXC/CoinEx listan y CoinGecko no indexa **se guarda igual**
   (`coin_id = NULL`): sigue siendo operable.
8. **CoinGecko se conserva** para metadata (ranking, mcap, sector) y ficha de
   proyecto. No tiene reemplazo para supply circulante.
9. No se suman exchanges: los cinco evaluados aportaban 49 coins del catálogo
   sobre 733 bases nuevas. Rendimiento decreciente.
10. **DEX descartados** para esta etapa: sus pares son contra WETH/USDC/USDT (no
    BTC), el gas y el slippage se comen un margen del 1,7%, y el volumen se
    concentra en stablecoins.
