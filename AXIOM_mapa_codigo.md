# AXIOM v2 — Mapa del código

Referencia completa del repositorio: qué hace cada archivo, quién depende de
quién, y dónde está la deuda técnica.

**Relevamiento:** 22 de julio de 2026 · commit vigente en `~/apps/axiom-v2`
**Complemento:** `AXIOM_mapa_datos.md` (las 23 tablas) · `AXIOM_modelo_pares.md`
(modelo de datos) · `AXIOM_estado_y_foco.md` (frentes abiertos)

---

## 0. Panorama

**Backend:** ~5.900 líneas de Python en 6 paquetes.
**Frontend:** 8.512 líneas de JavaScript vanilla (sin build, sin npm).

```
axiom-v2/
├── backend/
│   ├── main.py              # arranque FastAPI, lifespan, routers
│   ├── api/          (17)   # endpoints HTTP/WS
│   ├── domain/       (6)    # capa de dominio (Coin, Par, Mercado, Watchlist)
│   ├── services/     (14)   # lógica de negocio y sincronizaciones
│   ├── exchanges/    (5+18) # adaptadores de exchange + protobuf MEXC
│   ├── strat/        (9)    # motor de estrategias y backtesting
│   ├── data/         (4)    # fuentes para el cálculo del régimen
│   └── scheduler/    (1)    # jobs periódicos (APScheduler)
├── frontend/
│   ├── index.html           # shell: nav, contenedores de pantalla, scripts
│   └── static/js/
│       ├── charts/   (22)   # el módulo más grande: gráficos completos
│       ├── screens/  (7)    # pantallas de la app
│       ├── router.js        # navegación (32 líneas)
│       ├── app.js           # registro de pantallas (13 líneas)
│       ├── api.js           # cliente HTTP
│       └── price-service.js # singleton de precios en vivo
├── migrations/       (4)    # SQL numerado (001-004)
├── scripts/          (5)    # SQL de esquema inicial (legacy, ver §7)
├── docs/code/        (11)   # corpus CODE (DOC-00 a DOC-07 + findings)
└── [raíz]            (7)    # ⚠️ scripts de validación sueltos (ver §7)
```

---

## 1. BACKEND — `main.py`

Punto de entrada. 128 líneas.

- Crea la app FastAPI y el pool de asyncpg (`app.state.db_pool`).
- Instancia la capa de dominio: `app.state.domain = AxiomDomain(pool)`.
- Lanza tareas de fondo: `run_price_stream`, `run_capture` (order book),
  `start_scheduler`.
- Registra **todos** los routers.
- Sirve el frontend estático.

---

## 2. BACKEND — `api/` (endpoints)

| Archivo | Líneas | Prefijo | Qué expone |
|---|---|---|---|
| `strat.py` | 485 | `/api/strat` | Estrategias v2: CRUD, backtests, posiciones, stats |
| `watchlist.py` | 467 | `/api/watchlist` | Watchlist + **screener** (3 modos) + `/suggested` |
| `charts.py` | 450 | `/api/charts` | Histórico UDF, estado, indicadores, dibujos |
| `chat.py` | 427 | `/api/chat` | Kepler: 5 tools sobre la capa de dominio (Gemini) |
| `market.py` | 403 | `/api/market` | Coins, categorías, búsqueda, redes |
| `bot.py` | 196 | `/api/bot` | Bot v1 paper: config, reglas, posiciones |
| `alerts.py` | 150 | `/api/alerts` | Alertas de precio (CRUD + test Telegram) |
| `pairs.py` | 138 | `/api/pairs` | **Nuevo**: catálogo de pares, sync, listado filtrable |
| `orderbook.py` | 123 | `/api/orderbook` | Snapshots y series del libro |
| `prices.py` | 104 | `/api/prices` | Precios en vivo + track/untrack + WS |
| `capital.py` | 102 | `/api/capital` | Gestión de capital |
| `regime.py` | 101 | `/api/regime` | Régimen actual, histórico, señales |
| `domain_router.py` | 65 | `/api/domain` | **Pruebas** de la capa de dominio (`?caps=`) |
| `candles.py` | 49 | `/api/candles` | WS de vela en vivo |
| `news.py` | 30 | `/api/news` | Feed de noticias |

**~75 endpoints** en total.

---

## 3. BACKEND — `domain/` (capa de dominio) ⭐

El corazón arquitectónico. Entidades con **capacidades atómicas y componibles**.

| Archivo | Líneas | Contenido |
|---|---|---|
| `coin.py` | 298 | `Coin`: `regimen_relativo`, `noticias`, `pares`, `info_proyecto`, `precio_ref`, `metadata_mercado` |
| `mercado.py` | 209 | `Mercado`: `mapa`, `sector`, `ranking`, `regimen_global`, `feed_noticias` |
| `par.py` | 200 | `Par`: `velas_hist`, `order_book_snapshot`, `precio_puntual`, `capacidades`, `estado_chart` |
| `watchlist.py` | 126 | `Watchlist`: `pares_seguidos`, grupos |
| `base.py` | 52 | Mixin `Composable.overview()` — gather paralelo de capacidades |
| `__init__.py` | 48 | Fábrica `AxiomDomain(pool)` → `.coin()`, `.mercado()`, `.watchlist()` |

**Por qué importa:** cada capacidad es una función con entrada y salida limpias.
Eso permitió exponerlas como *tools* del chat sin una línea de adaptación — y es
la precondición de cualquier consumidor futuro (widgets, MCP).

**Dependencias salientes:** `coin.py` → `coin_info_service`, `discover_pairs`,
`Mercado`, `Par`. `par.py` → `get_adapter`, `price_stream`, `candle_stream`.
`mercado.py` → `news_service`.

---

## 4. BACKEND — `services/` (lógica de negocio)

| Archivo | Líneas | Rol | Estado |
|---|---|---|---|
| `signals.py` | 355 | 12 señales del régimen, 3 temporalidades | ✅ |
| `bot_service.py` | 352 | Bot v1: RSI, S/R, evaluación de reglas | ⚠️ usa `ohlcv_daily` viejo |
| `coins_sync.py` | 343 | Sync de `coins` (8 llamadas/6h) + scraping categorías | ✅ eficiente |
| `pairs_sync.py` | 342 | **Nuevo**: catálogo de pares, tickers, vinculación | ✅ |
| `selection_service.py` | 266 | 3 canastas sugeridas según régimen | ✅ |
| `ohlcv_sync.py` | 243 | Sync de velas desde CoinGecko | ❌ **roto** (§6) |
| `coin_info_service.py` | 229 | Ficha de proyecto con TTL 7 días | ✅ |
| `news_service.py` | 224 | Feed de noticias | ✅ |
| `price_stream.py` | 222 | WS multiplexado de precios por exchange | ✅ |
| `orderbook_capture.py` | 205 | Captura de profundidad (CoinEx WS) | ✅ |
| `candle_stream.py` | 195 | Vela en vivo por `exchange:pair:tf` | ✅ |
| `price_service.py` | 192 | Precios batch (REST) | ✅ |
| `snapshot.py` | 182 | Arma el snapshot horario del régimen | ✅ |
| `alert_service.py` | 179 | Evaluación de alertas (cruce, no posición) | ✅ |
| `regime.py` | 132 | Clasificación de régimen | ✅ |

---

## 5. BACKEND — otros paquetes

### `exchanges/` — adaptadores ⭐
`base.py` (141) define `ExchangeAdapter` con **capabilities declarativas**.
Implementaciones: `coinex.py` (252), `mexc.py` (220), `binance.py` (192),
`coingecko.py` (98). `__init__.py` (57) expone `get_adapter(nombre)`.

`_mexc_proto/` — 17 archivos generados de los `.proto` oficiales de MEXC
(WebSocket protobuf). No se editan a mano.

**Principio:** el exchange es siempre explícito, sin fallback silencioso.
`operable` y `capabilities` son atributos independientes.

### `strat/` — motor de estrategias
`execution_engine.py` (224), `feature_engine.py` (192), `backtest_engine.py`
(175), `stats_engine.py` (149), `backfill.py` (138), `data_engine.py` (159),
`strategy_base.py` (135), `pair_discovery.py` (113), `strat_scalp_meanrev.py` (88).

`pair_discovery.py` es notable: descubre pares en vivo desde MEXC/CoinEx y
**conoce CoinEx** (a diferencia de la vieja `coin_exchanges`).

### `data/` — fuentes del régimen
`coinmarketcap.py` (144), `coingecko.py` (126), `binance.py` (93),
`alternative_me.py` (46).

**Nota:** convive con `exchanges/` y parece duplicación, pero **no lo es**:
`data/` alimenta el cálculo del régimen (dominancia, fear&greed, métricas
globales) y solo lo consume `snapshot.py`. `exchanges/` es para datos de mercado
operables. Roles distintos, aunque los nombres confunden.

### `scheduler/tasks.py` (219)
7 jobs: régimen (60 min), alertas (1 min), bot v1, precios coins (6 h),
categorías (7 d), OHLCV incremental (00:01 GMT), estrategias v2 (5 min).

---

## 6. FRONTEND

### Arquitectura
Vanilla JS con namespace global `window.AXIOM` (alias `NS`). Sin build, sin npm.
Los scripts se cargan en orden de dependencia desde `index.html`.

`router.js` (32) — `Router.go(id)` busca en `window.Screens[id]` y llama
`onEnter`/`onLeave`.
`app.js` (13) — registra el mapa `window.Screens`.

### `charts/` — el módulo grande (22 archivos)

**core/** — `chart-engine.js` (433, wrapper de LWC + precio en vivo híbrido),
`coords.js` (199), `store.js` (120), `api.js` (46).

**indicators/** — `manager.js` (459), `special.js` (160), `overlays.js` (106),
`lib.js` (102), `oscillators.js` (96), `registry.js` (59).

**drawings/** — `manager.js` (413), `tools-misc.js` (169), `primitive.js` (150),
`tools-lines.js` (114), `tools-trade.js` (101), `registry.js` (57),
`geometry.js` (57).

**ui/** — `watchlist-panel.js` (236), `legend.js` (191), `alerts.js` (180),
`drawing-dialogs.js` (162), `indicators-modal.js` (135), `ohlc-bar.js` (97),
`toolbar.js` (59).

`charts-screen.js` (424) — orquestador de la pantalla.

**El patrón `registry.js`** (indicadores y dibujos) es el modelo a replicar para
el futuro `WidgetRegistry`: mapa + `register`/`get`/`has`/`list`/`grouped`, con
contratos autocontenidos.

### `screens/`
`watchlist.js` (1.668 — **el archivo más grande del frontend**), `market.js`
(598), `bot.js` (572), `regime.js` (270), `bot_orderbook.js` (214),
`news.js` (181), `capital.js` (180), `chat.js` (168).

### `price-service.js` (136)
Singleton de precios en vivo. WS a `/api/prices/ws`, índice por coin, sistema de
suscripción. Lo consumen watchlist, panel lateral y el gráfico.

---

## 7. AUDITORÍA — hallazgos

### 7.1 Archivos sueltos en la raíz ⚠️

Siete scripts de validación/prueba conviven con el código de producción:

```
validate_binance.py                    (202)
validate_coinex_candle_from_deals.py   (126)
validate_coingecko.py                  (123)
probe_coinex_kline.py                   (99)
probe_mexc_ws.py                        (90)
validate_coinex_channels.py             (89)
validate_coinex_ws.py                   (62)
```

Fueron útiles para validar los adaptadores (de ahí salieron hallazgos reales,
como que CoinEx no tiene canal kline). **Sugerencia:** mover a `tools/` o
`scripts/validation/`. No borrar: documentan cómo se verificó cada API.

### 7.2 Pantallas huérfanas ⚠️

- **`capital.js`** (180 líneas) — el script se carga en `index.html`, pero
  **no está en `window.Screens`** ni tiene botón de navegación. Código muerto
  desde la UI. El endpoint `/api/capital` (102 líneas) tampoco tiene consumidor.
- **`market.js`** (598 líneas) — **sí** está en `window.Screens` como `market`,
  pero **no hay botón** con `data-screen="market"`. Inalcanzable por navegación.
  (La pantalla Mercado visible es `regime.js`.)

Navegación real: `regime`, `watchlist`, `charts`, `news`, `bot`, `chat`.

### 7.3 Typo en `charts-screen.js` ⚠️
Línea 421: expone `NS.Screen` (singular). El resto del código usa `NS.Screens`.
Funciona porque también expone `window.ChartsScreen`, que es lo que consume
`app.js` — pero el `NS.Screen` queda como propiedad inútil.

### 7.4 Sincronizaciones: eficiente vs. roto

| Sync | Llamadas | Resultado |
|---|---|---|
| `coins_sync` | 8 cada 6 h | ✅ 2.000 coins |
| `pairs_sync` | 2 + 2 | ✅ 3.246 pares |
| `coin_info_service` | 1 bajo demanda | ✅ TTL 7 días |
| **`ohlcv_sync`** | **2.392 diarias** | ❌ **0 filas, 2.392 errores** |

Mismo proveedor (CoinGecko), resultado opuesto. La diferencia es endpoint masivo
vs. uno por coin. Detalle completo en `AXIOM_mapa_datos.md` §2.

### 7.5 Duplicación de acceso a exchanges

- `strat/data_engine.py` y `strat/backfill.py` tienen sus **propias** funciones
  de klines en vez de usar `exchanges/`. **No tienen el bug** de ms→segundos
  (verificado), así que es prolijidad, no urgencia.
- `charts.py` conserva un `WsManager` de Binance que coexiste con
  `candle_stream`. Resolver cuál queda.

### 7.6 `scripts/` vs `migrations/`

Dos mecanismos de esquema conviviendo:
- `scripts/` (5 archivos): `01_schema.sql`, `02_alerts_schema.sql`,
  `03_bot_schema.sql`, `03b_bot_migration.sql`, `06_strat_backtests.sql` —
  esquema inicial, numeración con huecos (falta 04, 05).
- `migrations/` (4 archivos): `001` a `004` — convención actual.

**Sugerencia:** documentar `scripts/` como histórico y usar solo `migrations/`
de acá en adelante.

### 7.7 Lo que está bien y conviene no tocar

- **`.gitignore` correcto**: `venv/` y `site/` ignorados (0 archivos trackeados
  de cada uno). El repo está limpio.
- **`domain/`**: cohesión alta, dependencias claras, sin ciclos.
- **`exchanges/`**: contrato de capabilities bien resuelto.
- **`charts/`**: pese a ser el módulo más grande, está bien dividido en
  core/indicators/drawings/ui con responsabilidades separadas.

### 7.8 Candidatos a revisión por tamaño

- `frontend/static/js/screens/watchlist.js` (**1.668 líneas**) — casi el doble
  que el siguiente. Probablemente mezcla lista, filtros, screener, sugeridas y
  modales. Candidato natural a dividirse como se hizo con `charts/`.
- `backend/api/strat.py` (485) y `backend/api/watchlist.py` (467) — los routers
  más grandes; el segundo incluye el screener completo, que podría vivir en un
  servicio.

---

## 8. Grafo de dependencias (backend)

```
main.py
 ├── api/* ──────────► services/* ──► data/* (solo snapshot)
 │    └── domain/* ───► exchanges/*
 │                └──► services/*
 ├── scheduler/tasks ► services/*
 └── strat/* ────────► exchanges/* (parcial: data_engine y backfill duplican)
```

**Sin ciclos.** La capa de dominio depende de servicios y adaptadores, nunca al
revés. `data/` es hoja: solo lo usa `snapshot.py`.

**Puntos de entrada a datos de mercado:**
1. `exchanges/get_adapter()` — la puerta correcta (gráficos, dominio, streams).
2. `data/*` — solo para el régimen.
3. `strat/data_engine.py` y `backfill.py` — duplicación pendiente de consolidar.

---

## 9. Resumen de deuda

| # | Hallazgo | Gravedad | Esfuerzo |
|---|---|---|---|
| 1 | `ohlcv_sync` no funciona (2.392 llamadas/día) | 🔴 alta | medio |
| 2 | `watchlist.js` con 1.668 líneas | 🟡 media | alto |
| 3 | `market.js` inalcanzable (598 líneas) | 🟡 media | bajo (decidir) |
| 4 | `capital.js` + `/api/capital` sin consumidor | 🟡 media | bajo (decidir) |
| 5 | 7 scripts de validación en la raíz | 🟢 baja | bajo |
| 6 | `data_engine`/`backfill` duplican acceso | 🟢 baja | medio |
| 7 | `WsManager` Binance vs `candle_stream` | 🟢 baja | bajo |
| 8 | `scripts/` vs `migrations/` | 🟢 baja | bajo (documentar) |
| 9 | Typo `NS.Screen` en charts-screen | 🟢 baja | trivial |

**Nada de esto bloquea el desarrollo.** El único hallazgo que afecta
funcionalidad real es el #1, ya diagnosticado y con solución diseñada en
`AXIOM_modelo_pares.md`.

---

## 10. Decisiones que este mapa deja planteadas

1. **`market.js` y `capital.js`**: ¿se recuperan (agregando navegación) o se
   eliminan? Son 778 líneas de código escrito y no accesible.
2. **`watchlist.js`**: ¿se divide como `charts/`? Es el archivo con más riesgo
   de volverse inmanejable.
3. **`scripts/` → histórico**: consolidar en `migrations/`.
4. **Scripts de validación**: mover a `tools/`.
