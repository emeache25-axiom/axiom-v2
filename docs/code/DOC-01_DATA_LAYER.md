# DOC-01 — DATA LAYER: Qué datos, de dónde, con qué calidad

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-01 (capa de datos del corpus)
**Versión:** 2.0
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00 (Master). Alimenta a: DOC-02 (DNA), DOC-03 (State),
DOC-05 (Universe).

---

## 1. PROPÓSITO

El Data Layer es la fundación de CODE. Todo motor del sistema —DNA, State, Edge,
Universe, Portfolio— consume datos de acá y de ningún otro lado. Si esta capa
miente, todo lo que se construya encima miente con elegancia.

Su responsabilidad es una sola: **entregar datos correctos, reproducibles y
netos de sorpresas a quien los pida**, sin que el consumidor tenga que saber de
qué exchange vinieron, si estaban cacheados, o cómo se rellenó un hueco.

Este documento define **qué datos** necesita CODE, **de dónde** salen, **con qué
calidad** se aceptan, y **cómo se almacenan**. No define cómo se interpretan
(eso es DNA y State).

---

## 2. PRINCIPIO RECTOR DE ESTA CAPA (P8 aplicado)

> **Pocos datos impecables antes que muchos a medias.** (DOC-00, P8)

CODE corre en hardware modesto (notebook Core 2 Duo, ~1 GB RAM). No hay lugar
para cinco años de tick data ni para almacenamiento on-chain pesado. La decisión
de diseño es deliberada y se mantiene:

- **OHLCV es el dato primario.** Velas. Nada de order book en tiempo real, nada
  de trades individuales, nada de profundidad de mercado en v2.
- **Metadata de mercado es el dato secundario.** Ranking por capitalización,
  market cap, volumen 24h, sector. Lento, barato, ya resuelto en AXIOM.
- **Todo lo demás es deuda futura.** Si un motor pide un dato que esta capa no
  provee, no se improvisa: se discute si entra al diseño (P6, el código manda).

---

## 3. TAXONOMÍA DE DATOS

CODE distingue tres clases de datos, por velocidad y por uso:

| Clase | Qué es | Velocidad | Fuente | Consumidor |
|-------|--------|-----------|--------|------------|
| **OHLCV vivo** | Últimas N velas de un par | Segundos–minutos | MEXC/CoinEx (caché) | State, Edge, ejecución |
| **OHLCV histórico** | Miles de velas hacia atrás | Bajo demanda (lento) | MEXC/CoinEx (backfill) | DNA, backtester |
| **Metadata de mercado** | Rank, market cap, volumen, sector | Horas–semana | CoinGecko (PostgreSQL) | Universe, tiers |

La distinción **vivo vs. histórico** no es cosmética: son dos rutas de código
distintas con garantías distintas. El vivo prioriza latencia y reutilización
(varias estrategias comparten una descarga). El histórico prioriza profundidad y
completitud (paginar hacia atrás sin huecos). Mezclarlos sería un error de capa.

---

## 4. OHLCV — EL DATO PRIMARIO

### 4.1 Esquema canónico de una vela

Toda vela que circula por CODE tiene esta forma, sin excepción:

```
{
  "time":   1719705600,   # epoch en SEGUNDOS (no ms), apertura de la vela
  "open":   0.12345,
  "high":   0.12500,
  "low":    0.12300,
  "close":  0.12480,
  "volume": 1532840.0
}
```

Reglas del esquema:
- `time` en **segundos**, siempre. Los exchanges devuelven milisegundos; la capa
  normaliza dividiendo por 1000 en la frontera. Adentro de CODE nunca hay ms.
- Orden **cronológico ascendente** (la más vieja primero, la más nueva al final).
- **Sin duplicados** por `time`.
- Tipos numéricos `float`, no strings (los exchanges mandan strings; se castea
  en la frontera).

### 4.2 Timeframes soportados

```
1m · 5m · 15m · 30m · 1h · 4h · 1d · 1w
```

Estos son los timeframes que ambos exchanges (MEXC y CoinEx) sirven de forma
verificada. Cualquier timeframe fuera de esta lista no existe para CODE: se
rechaza explícito, no se aproxima ni se resamplea silenciosamente.

### 4.3 Dos rutas: vivo (DataEngine) e histórico (Backfill)

**Ruta viva — `data_engine.py`.** Provee las últimas N velas (típico: 200) con
caché en memoria. Es la ruta del día a día: State Engine pidiendo el estado de
hoy, ejecución valuando una posición, Edge mirando las últimas velas.

- Clave de caché: `(símbolo, timeframe, exchange)`.
- TTL adaptado al timeframe: refresca como mucho una vez por medio timeframe,
  con piso de 15 s y techo de 5 min. No tiene sentido refrescar velas de 1h cada
  10 segundos.
- **Reutilización:** varias estrategias que piden el mismo par/timeframe
  comparten una sola descarga. Esto es crítico en la notebook —es la diferencia
  entre 1 request y 20.
- Degradación elegante: si la red falla pero hay algo cacheado, devuelve lo
  cacheado antes que nada.

**Ruta histórica — `backfill.py`.** Provee miles de velas paginando hacia atrás
desde ahora. Es la ruta de la caracterización: DNA Engine necesita historia
profunda para decidir el arquetipo de un par; el backtester necesita un período
largo para validar.

- Pagina hacia atrás en ventanas de 1000 velas (máximo por request en ambos
  exchanges).
- Tope de seguridad: 60 requests (≈60.000 velas) por llamada. Un techo, no un
  objetivo.
- Devuelve velas cronológicas, deduplicadas.
- **Independiente del caché vivo:** el histórico no contamina ni consume el caché
  de baja latencia. Son dos universos.

> **Por qué dos rutas y no una.** Un solo módulo "que traiga velas" tendría que
> elegir entre optimizar latencia (malo para histórico) u optimizar profundidad
> (malo para vivo). Separarlas deja cada uno hacer una cosa bien. (Coincide con
> la disciplina de engines de DOC-00 §5.)

---

## 5. FUENTES Y SU JERARQUÍA

### 5.1 Exchanges de OHLCV: MEXC y CoinEx

Ambas APIs son **públicas, sin KYC, sin API key**. Esto es una decisión de
diseño, no un accidente: CODE no debe depender de credenciales ni de cuentas
para obtener su dato primario.

| Exchange | Endpoint klines | Rango temporal | Notas |
|----------|-----------------|----------------|-------|
| **MEXC** | `/api/v3/klines` (estilo Binance) | `startTime`/`endTime` (ms) | Filas como arrays posicionales |
| **CoinEx** | `/v2/spot/kline` | `start_time`/`end_time` (ms) | Filas como objetos con campos nombrados; rango verificado empíricamente |

**Detalle de calidad documentado:** el soporte de rango temporal de CoinEx no
está en su documentación pública pero funciona (verificado empíricamente). Esto
queda registrado acá porque es exactamente el tipo de conocimiento frágil que se
pierde si no se escribe: si CoinEx cambia el comportamiento, este documento es
dónde mirar primero.

### 5.2 Por qué MEXC primero, CoinEx fallback

El par determina el exchange (cada par en la watchlist tiene su `exchange`
asignado). Donde hay elección, MEXC es la fuente por defecto y CoinEx el
respaldo, por cobertura de pares. Ninguna fuente es sagrada: si un par solo
existe en CoinEx, se usa CoinEx sin ceremonia.

### 5.3 Metadata de mercado: CoinGecko → PostgreSQL

El ranking, market cap, volumen y sector **no** se piden a CoinGecko en caliente.
Se sincronizan a una tabla `coins` en PostgreSQL y todos los consumidores leen
de ahí. Esto desacopla CODE de la disponibilidad y los rate limits de CoinGecko
en el camino crítico.

- **Sync de precios (horario):** top 2000 coins por market cap → actualiza
  precio, rank, cambio 24h/7d, market cap, volumen, sparkline (esta última solo
  top 500). 8 páginas × 250 coins, con respeto de rate limits (espera ante 429).
- **Sync de categorías (semanal):** scraping de las páginas de categorías de
  CoinGecko (BeautifulSoup) → asigna una **supercategoría** por coin según una
  tabla de prioridad (18-category taxonomy). Lento y caro, por eso semanal.

> **Bug de calidad documentado:** algunas coins devuelven status 200 pero
> redirigen a la homepage de CoinGecko en vez de a su página. Resultado:
> categorías vacías. La capa lo detecta comparando la URL final y asigna "otros"
> automáticamente. Registrado acá porque es una trampa silenciosa: sin la
> detección, parecería un dato válido.

---

## 6. CALIDAD DE DATOS — CONTRATO DE ACEPTACIÓN

Ningún dato entra a CODE sin cumplir este contrato. La capa es el portero; los
motores confían porque la capa ya filtró.

**Para OHLCV:**
1. **Monotonía temporal:** los `time` son estrictamente crecientes. Cualquier
   desorden se corrige (sort) o se rechaza el lote.
2. **Sin duplicados:** una vela por `time`. Los duplicados se colapsan.
3. **Sin huecos silenciosos:** un hueco temporal (vela faltante) se reporta, no
   se interpola inventando precio. CODE prefiere saber que falta a creer una
   mentira suave. *(Política a implementar; hoy el backfill deduplica y ordena,
   la detección explícita de huecos es deuda de esta capa — ver §9.)*
4. **Numéricos válidos:** sin `NaN`, sin negativos en precio/volumen, con
   `high ≥ low` y `high ≥ open,close ≥ low`. *(Validación a implementar — §9.)*

**Para metadata:**
1. **Frescura:** cada fila de `coins` lleva `updated_at`. Un consumidor puede
   exigir "datos de menos de X horas" y la capa responde si los tiene.
2. **Completitud tolerante:** sector puede ser "otros" (desconocido), pero rank y
   market cap deben existir para que una coin entre al universo (DOC-05).

**Principio transversal (P7):** ningún dato de precio se usa para una métrica de
retorno sin que en algún punto del pipeline se descuenten costos. La capa entrega
precio limpio; descontar costos es responsabilidad de quien calcula esperanza
(Edge) y P&L (ejecución), pero se enuncia acá para que no se olvide en el origen.

---

## 7. ALMACENAMIENTO

| Dato | Dónde vive | Por qué |
|------|-----------|---------|
| OHLCV vivo | Memoria (caché TTL en `DataEngine`) | Efímero, se regenera; no vale la pena persistir |
| OHLCV histórico | Se trae bajo demanda (backfill) | Persistir 60k velas × N pares no escala en la notebook |
| Metadata (`coins`) | PostgreSQL, tabla `coins` | Lento de obtener, barato de guardar, se consulta seguido |
| Snapshots de régimen | PostgreSQL | Contexto histórico de mercado (ya existente en AXIOM) |

Decisión clave: **el OHLCV no se persiste en v2.** Se cachea en vivo y se
re-trae en histórico. Persistir OHLCV en PostgreSQL para todos los pares sería
un sistema de almacenamiento de series temporales —caro en disco, caro en
mantenimiento, innecesario para el hardware actual. Si el backtesting repetido
sobre los mismos pares hace doler la re-descarga, **entonces** se evalúa un caché
en disco para histórico (deuda consciente, §9), nunca antes (P6, P8).

---

## 8. INTERFAZ QUE EL DATA LAYER EXPONE

Los motores no hablan con exchanges. Hablan con el Data Layer mediante un
contrato chico y estable:

```
# Vivo — últimas N velas, cacheadas
get_candles(símbolo, timeframe, exchange="mexc", limit=200) -> list[vela] | None

# Histórico — profundidad, paginando hacia atrás
fetch_history(símbolo, timeframe, exchange, target=10000) -> list[vela]

# Atajo sin red — último close cacheado (valuar posiciones rápido)
last_price(símbolo, timeframe="1m", exchange="mexc") -> float | None

# Metadata — lectura desde PostgreSQL (vía servicios de coins)
# rank, market_cap, volume_24h, supercategoría, frescura
```

Todo lo que un motor necesita de datos pasa por acá. Si mañana se agrega una
fuente, cambia la implementación detrás de esta interfaz, **no** los motores.
Ese es el punto de tener una capa.

---

## 9. DEUDA CONSCIENTE DE ESTA CAPA

Lo que CODE v2 **no** hace todavía, registrado para no fingir que está resuelto:

1. **Detección explícita de huecos** en series OHLCV (hoy: dedup + sort; falta
   reportar velas faltantes). — §6.3
2. **Validación numérica dura** de velas (`high≥low`, sin NaN/negativos) como
   barrera formal en la frontera. — §6.4
3. **Caché en disco para histórico**, si el backtesting repetido lo justifica
   empíricamente. — §7
4. **Contrato de frescura formal** en la lectura de metadata (hoy existe
   `updated_at`; falta la API que exija "< X horas"). — §6
5. **Funding / open interest** y otras señales de derivados: fuera de v2 por
   diseño; reevaluable si un motor demuestra que las necesita (P6).

Cada ítem es una hipótesis de necesidad. Ninguno se construye hasta que el
código (un motor real pidiéndolo, un dolor medido) lo obligue.

---

## 10. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

Esta capa **no se construye de cero**. Ya existe, funcionando, en AXIOM v2:

- `backend/strat/data_engine.py` — la ruta viva con caché (descrita en §4.3).
- `backend/strat/backfill.py` — la ruta histórica con paginación (§4.3).
- `backend/services/coins_sync.py` — los jobs de metadata (§5.3).
- Tabla `coins` en PostgreSQL — ~1750 coins con precio, rank y supercategoría.

DOC-01 no inventa una capa nueva: **formaliza el contrato** de la que ya corre,
le pone nombre a sus garantías, y deja escrita la deuda. El DNA Engine (DOC-02)
es el primer motor que se apoya enteramente sobre este contrato.

---

## ESTADO
DRAFT · v2.0 · en redacción.
Próximo: revisión y aprobación → DOC-02 (DNA Engine), primer consumidor real
de esta capa.
