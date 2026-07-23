# AXIOM v2 — Estado, foco y frentes abiertos

Documento de orientación para retomar el proyecto con foco. Se escribió tras una
sesión larga (20-21 de julio de 2026) en la que se abrieron varios frentes a la
vez y conviene ordenar antes de seguir.

---

## 0. Qué debe ser AXIOM

> **Una plataforma de trading. Ni más ni menos.**
> Con información relevante, análisis importantes, pares operables, herramientas
> inteligentes y uso de IA.

Esta es la brújula. Ante cualquier decisión o desvío, la pregunta es una:
**¿esto ayuda a operar mejor?** Si la respuesta no es clara y directa, va a la
lista de "después" — no se construye ahora.

El aprendizaje de la v1 (y de esta sesión) es que el enemigo no es la falta de
ideas: es abrir muchos frentes a la vez, mezclar cosas y poner parches para que
funcionen. La disciplina es **una cosa por sesión**, cerrada, antes de abrir la
siguiente.

---

## 1. Regla de trabajo para las próximas sesiones

Antes de tocar código, responder una sola pregunta:

> **¿Cuál es la ÚNICA cosa que quiero que funcione al final de esta sesión?**

Todo lo que no sea eso se anota acá y no se toca. Si aparece un problema nuevo en
el camino (como pasó con el sync de OHLCV, los exchanges, los DEX), se **anota**,
no se persigue. Diagnóstico si hace falta; solución solo del frente elegido.

---

## 2. Qué está HECHO y funcionando (no tocar)

- **Capa de dominio** (`backend/domain/`): `Coin`, `Par`, `Mercado`, `Watchlist`
  con compositor `overview()`. Validada en producción.
- **Régimen de mercado**: snapshots horarios, 12 señales, 3 temporalidades.
- **Gráficos**: Lightweight Charts v5.2, indicadores, dibujos, precio en vivo
  unificado (modelo híbrido TradingView). Van al adaptador en vivo.
- **Adaptadores de exchange** (`backend/exchanges/`): MEXC, CoinEx, Binance,
  CoinGecko. Con `get_ohlcv`, `get_orderbook`, WebSockets.
- **Chat conversacional (Kepler)**: Gemini + function calling sobre la capa de
  dominio. 5 tools: régimen, analizar coin, screener, sugeridas, watchlist.
  Con reintentos y modelos de respaldo. Funcionando.
- **info_proyecto** (`coin_info`): ficha CoinGecko cacheada, TTL 7 días.
- **Catálogo de pares** (`pairs`, migración 004): 3.246 pares tradeables de
  MEXC/CoinEx, con volumen/precio/spread. Sync cada llamada. API `/api/pairs/`.
  Screener por par ya responde el caso de uso (micro-caps /BTC por volumen).

---

## 3. El frente ABIERTO más cercano a cerrarse

**Sync de velas por par** (`pair_ohlcv`, paso 4 del modelo de pares).

Es lo único que falta para que el screener de oscilación funcione de punta a
punta. La tabla `pair_ohlcv` ya está creada (migración 004). Falta:
- El servicio que trae velas diarias de los ~2.115 pares con volumen > umbral,
  usando los adaptadores ya construidos.
- El cálculo de `volatility_30d` y `range_days_pct` en `pairs`.
- El job diario.

**Esto es "una cosa".** Cerrarlo desbloquea la pregunta original de toda la saga:
*"micro-caps /BTC que oscilen >X% en el Y% de los días"*.

---

## 4. Frentes abiertos — lista de "después"

Ordenados por cercanía a la brújula (¿ayuda a operar?), no por cuándo aparecieron.

### 4.1 Datos y universo
- **Sync de velas por par** (arriba) — el más cercano, desbloquea el screener.
- **Rehacer/invertir `coins` desde los pares.** Hoy `coins` viene de CoinGecko
  (2.397, la mitad no operable) y `pairs` de los exchanges (1.889 bases, 719 sin
  coin). El orden correcto sería: los exchanges definen el universo, CoinGecko
  enriquece. **Decisión pendiente** (ver §5). Cambio grande: toca mapa de
  sectores, sugeridas, y todo lo que consume `coins`.
- **Vinculación par→coin** de los 719 sin coin. Mejoras posibles: normalizar
  símbolos con paréntesis de MEXC (`GOLD(PAXG)`→PAXG), cruzar por `fullName`,
  guardar `contractAddress`. Rendimiento esperado modesto (muchos no están en
  CoinGecko). **No urgente**: esos pares ya funcionan en el screener, solo sin
  metadata.
- **Reducir `ohlcv_daily` al top 300** (hoy intenta 2.392 coins, falla). O
  eliminarla si nadie la consulta tras migrar los screeners a `pair_ohlcv`.
- **Migrar screeners de watchlist a `pair_ohlcv`** (hoy usan `ohlcv_daily`).
- **Eliminar `coin_exchanges`** (reemplazada por `pairs`) y `watchlist_old`.
- **spread de CoinEx**: su ticker no da bid/ask; queda NULL. Pedirlo aparte si
  el spread importa para el screener.

### 4.2 Arquitectura de presentación
- **Componentes adaptables / responsivos**: cómo se comporta cada componente
  según el espacio disponible. Detectado al construir la tabla de pares: con 11
  columnas necesita scroll horizontal, y eso impide fijar el encabezado
  (`position:sticky` no atraviesa ancestros con `overflow`). El problema es
  general, no de esta tabla: aplica también a watchlist, panel del gráfico y
  cualquier vista densa. Requiere decidir breakpoints, qué columnas se ocultan
  en pantallas chicas, y cómo se reorganiza cada widget. **Frente propio, con
  su propio diseño.**
- **WidgetRegistry (frontend)**: la mitad de la arquitectura de dominio que
  quedó sin construir. Gemelo de `IndicatorRegistry`. Los widgets consumen la
  capa de dominio y componen las vistas. Es lo que hace *visible* todo el
  backend que se construyó. Está emparentado con el punto anterior: un widget
  debería declarar tanto qué datos consume como cómo se adapta al espacio.

### 4.3 IA y automatización
- **Más tools del chat**: mapa_sectores, top_coins, noticias_coin, info_proyecto,
  velas_par, buscar por volatilidad. Capacidades ya existen; es declararlas.
- **MCP**: exponer AXIOM a asistentes externos (Claude Desktop) vía servidor MCP.
  Conclusión previa: tool use directo para lo propio, MCP para terceros. La capa
  de dominio ya es la precondición. **Explícitamente pospuesto** hasta cerrar v2.

### 4.4 Deuda menor
- Migración columna `grupo` en `watchlist` (listas nombradas).
- `data_engine.py`/`backfill.py` a adaptadores (prolijidad, sin bug).
- WsManager Binance viejo en `charts.py` coexiste con candle_stream.
- Regenerar API key de Gemini (se expuso en el chat).
- Filtro de noticias por coin con falsos positivos (nombre común).
- `coins` con `supercat` NULL → doble "otros" en el mapa de sectores.

---

## 5. Decisión de fondo pendiente: ¿qué es el universo?

La pregunta que quedó abierta y que conviene decidir **con la brújula**, no en
caliente:

**Si AXIOM es una plataforma de trading, el universo son los pares operables.**
Eso empuja hacia: `pairs` como fuente primaria del universo, `coins` enriquecida
o subordinada, y el mapa de sectores / sugeridas operando sobre lo operable.

Pero es un cambio grande (toca muchos consumidores de `coins`) y NO hace falta
tomarlo para cerrar el sync de velas. **Sugerencia:** cerrar primero el screener
(velas), y encarar la inversión de `coins` como su propia sesión, con su propio
diseño, midiendo qué se rompe antes de tocar.

Tres caminos ya identificados:
- **A**: rehacer `coins` desde `pairs` (limpio, invasivo).
- **B**: tabla nueva de activos operables, `coins` queda como referencia.
- **C**: agregar a `coins` una columna `operable` derivada de `pairs` (mínimo
  cambio, permite filtrar sin perder catálogo).

---

## 6. Orden sugerido (una cosa por sesión)

1. **Sync de velas por par** → screener de oscilación completo. *(cierra la saga
   que originó todo)*
2. **Limpieza de datos**: eliminar `coin_exchanges`, `watchlist_old`; migrar
   `charts.py` y screeners a las tablas nuevas; reducir `ohlcv_daily`.
3. **Decisión del universo** (§5) → rehacer/ajustar `coins`. Su propia sesión.
4. **WidgetRegistry** → hacer visible la capa de dominio en la UI.
5. **Más tools del chat** → aprovechar lo que ya existe.
6. **MCP** → cuando v2 esté cerrada.

Cada una es un frente. Se cierra antes de abrir el siguiente.

---

## 7. Recordatorio final

AXIOM no necesita ser todo. Necesita ser **una buena plataforma de trading**.
Cada línea de código debería poder justificarse con "esto ayuda a operar mejor".
Lo que no pase ese filtro, por interesante que sea, es una distracción — y las
distracciones, acumuladas, son lo que hundió a la v1.
