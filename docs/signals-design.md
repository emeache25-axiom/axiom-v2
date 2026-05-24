# AXIOM v2 — Diseño de Señales y Régimen

> Documento de diseño. Define cómo AXIOM v2 detecta el régimen de mercado.
> Estado: diseño cerrado para señales. Pendiente: pesos, clasificación, evaluación.

## Concepto central

AXIOM v2 NO calcula un régimen único. Calcula **tres regímenes
independientes**, uno por temporalidad:

- **Largo plazo** — "¿en qué parte del ciclo estamos?" (escala: meses)
- **Medio plazo** — "¿cuál es la tendencia de las próximas semanas?" (escala: semanas)
- **Corto plazo** — "¿cuál es el momentum ahora?" (escala: horas/días)

Esto resuelve el problema de v1, donde señales de distinta velocidad
(MVRV de meses + funding de horas) se promediaban en un régimen confuso
que parpadeaba sin representar ninguna temporalidad real.

## Las 5 dimensiones

Cada régimen se construye midiendo hasta 5 dimensiones independientes
del mercado:

| Dimensión | Pregunta que responde |
|-----------|----------------------|
| Valuación | ¿caro o barato vs un valor "justo"? |
| Momentum | ¿hacia dónde se mueve el precio y con qué fuerza? |
| Sentimiento | ¿qué siente/hace la gente? (miedo, codicia, apalancamiento) |
| Flujo | ¿hacia dónde va el capital? (rotación, entrada/salida) |
| Participación | ¿cuánta actividad real hay? (volumen, direccionalidad) |

No todas las dimensiones aplican a todas las temporalidades.

## Relevancia de cada dimensión por temporalidad
	VALUACIÓN  MOMENTUM  SENTIMIENTO  FLUJO  PARTICIPACIÓN
LARGO      alta     media      media      media      nula
MEDIO      media    alta       alta       alta       media
CORTO      nula     alta       alta       media      alta

## La grilla de señales (núcleo, votan al régimen)
	VALUACIÓN     MOMENTUM         SENTIMIENTO   FLUJO           PARTICIPACIÓN
LARGO   MVRV Z-Score  Mayer Multiple   NUPL          lth_supply      (vacía)
MEDIO   btc_vs_ath    Precio vs MA50   fear_greed    btc_dominance   vol_mcap_ratio
CORTO   (vacía)       Precio vs EMA20  funding_btc   (vacía)         Volumen relativo

### Régimen LARGO PLAZO — 4 señales
- Valuación → **MVRV Z-Score** (v1)
- Momentum → **Mayer Multiple** (v1)
- Sentimiento → **NUPL** (v1)
- Flujo → **lth_supply** (v1)
- Participación → vacía. Candidato futuro: Active Addresses (media 90d)

### Régimen MEDIO PLAZO — 5 señales (completo)
- Valuación → **btc_vs_ath** (v1)
- Momentum → **Precio vs MA50** (NUEVA #1, velas diarias)
- Sentimiento → **fear_greed** (v1)
- Flujo → **btc_dominance** (v1)
- Participación → **vol_mcap_ratio** (v1, leído con ventana de semanas)

### Régimen CORTO PLAZO — 3 señales
- Valuación → vacía por diseño (no aplica conceptualmente)
- Momentum → **Precio vs EMA20** (NUEVA #2, velas 4h)
- Sentimiento → **funding_btc** (v1)
- Flujo → vacía. Candidato futuro: CVD / Spot Delta
- Participación → **Volumen relativo** (NUEVA #3, velas 4h)

## Señales nuevas a implementar

| # | Señal | Celda | Fuente de datos |
|---|-------|-------|-----------------|
| 1 | Precio vs MA50 | Momentum × Medio | Velas diarias BTC |
| 2 | Precio vs EMA20 | Momentum × Corto | Velas 4h BTC |
| 3 | Volumen relativo | Participación × Corto | Velas 4h BTC |

Las tres se calculan con velas (OHLCV) de Binance — datos gratuitos.
Las señales #2 y #3 comparten fuente (velas 4h BTC): una sola
integración las alimenta a ambas.

## Vacantes con candidato identificado

| Celda | Candidato | Razón de aplazamiento |
|-------|-----------|----------------------|
| Participación × Largo | Active Addresses (90d) | Requiere nueva integración on-chain |
| Flujo × Corto | CVD / Spot Delta | Integración compleja (procesar trades, no velas) |

## Señales de contexto (se muestran, NO votan)

Heredadas de v1, no entran a ningún régimen por correlación o por no
representar una dimensión pura. Se muestran en pantalla como información
complementaria.

| Señal | Motivo |
|-------|--------|
| funding_eth | Correlacionada con funding_btc |
| funding_sol | Correlacionada con funding_btc |
| altcoin_season | Correlacionada con btc_dominance |
| mvrv_ratio | Correlacionada con MVRV Z-Score |
| rhodl | Correlacionada con lth_supply |
| cbbi | Métrica compuesta, no representa dimensión pura |
| reserve_risk | No representa una dimensión como mejor candidato |
| pi_cycle | Binaria — mejor como alerta/contexto que como voto |
| sth_supply | No encontró celda como mejor candidato |

## Correlaciones marcadas para vigilar

Parejas de señales votantes que comparten algo de ADN. No bloquean el
diseño, pero se revisan cuando haya datos de evaluación:

- **MVRV Z-Score ↔ NUPL** (largo): ambas derivan del valor realizado.
- **fear_greed ↔ Precio vs MA50** (medio): el F&G incluye momentum
  entre sus componentes internos.

## Pendientes de diseño

Este documento cierra el diseño de SEÑALES. Falta diseñar:

1. **Pesos** — ¿las dimensiones pesan igual dentro de cada régimen?
2. **Clasificación** — umbrales de cada señal nueva (qué valor = qué régimen).
3. **Cálculo del régimen** — cómo combinar señales en régimen + conviction + consensus.
4. **Evaluación** — tablas para medir si cada régimen "acierta".
5. **Modelo de datos** — tablas PostgreSQL.

## Principio rector

AXIOM v2 no adivina, mide. La asignación de señales de este documento
es una **hipótesis de trabajo informada**, no una verdad final. El
sistema registra datos para evaluar, en el futuro, qué señales
realmente predicen y cuáles son ruido.

---

## Arquitectura conceptual — módulos

AXIOM v2 separa en módulos independientes lo que v1 mezclaba. Cada
módulo hace una sola cosa:

- **Régimen** → describe el presente. "Esto ES." (3 temporalidades)
- **Estadísticas del Régimen** → audita la calidad del Régimen.
- **Perspectivas** → predice el futuro. "Esto PODRÍA pasar."

Nunca se le pide al mismo componente describir y predecir a la vez.

### Módulo Régimen (en diseño/construcción)

El módulo actual. Describe el estado del mercado en 3 temporalidades
mediante la grilla de señales de este documento. Es una descripción
del instante presente, no una predicción.

### Módulo Estadísticas del Régimen (diseño diferido)

Evalúa retrospectivamente la calidad del módulo Régimen: coherencia,
estabilidad y correspondencia descriptiva. Responde preguntas como
"cuando AXIOM dijo corto=ALCISTA, ¿el mercado realmente lo era?".

Requiere un histórico de snapshots para existir. Se diseña en detalle
cuando haya datos acumulados. NO se diseña ahora.

Implicación para el presente: el modelo de datos del módulo Régimen
debe archivar desde el día 1 todo lo que este módulo necesitará
(precio de BTC en cada snapshot, votos individuales, timestamps).

### Módulo Perspectivas (diseño diferido)

Motor predictivo independiente. Genera expectativas hacia adelante
para corto, medio y largo plazo. Se basa en indicadores y señales
PROPIOS, distintos de los que alimentan el módulo Régimen.

No depende del módulo Estadísticas. Es un proyecto de diseño aparte,
de envergadura similar a la grilla del Régimen. Se diseña después de
terminar el módulo Régimen. NO se diseña ahora.

### Principio de orden

Un módulo a la vez. El módulo Régimen se termina y construye antes
de diseñar cualquier otro. Esto evita el error de v1 de agregar
funcionalidades sobre la marcha sin planificación.

---

## Clasificación de señales

Cada señal convierte su valor crudo en un voto de régimen. Los umbrales
son una hipótesis inicial — se calibrarán con el módulo Estadísticas.

### Señales de LARGO y MEDIO → votan 5 regímenes de ciclo
(ACUMULACION / ALCISTA_A / ALCISTA_B / DISTRIBUCION / BAJISTA)

**MVRV Z-Score** (largo, valuación) — heredada de v1, confirmada
- < 0 → ACUMULACION (suelo)
- 0–1 → ACUMULACION (neutro bajo)
- 1–2 → ALCISTA_A
- 2–3.5 → ALCISTA_B
- > 3.5 → DISTRIBUCION (techo)

**Mayer Multiple** (largo, momentum) — clasificación nueva (en v1 no votaba)
- Valor: ratio precio / MA200
- < 0.8 → ACUMULACION
- 0.8–1.0 → ACUMULACION
- 1.0–1.5 → ALCISTA_A
- 1.5–2.4 → ALCISTA_B
- > 2.4 → DISTRIBUCION (2.4 = nivel histórico de techo)

**NUPL** (largo, sentimiento) — heredada de v1, confirmada
- Dato de CMC viene en %, se divide por 100
- < 0 → BAJISTA (capitulación)
- 0–0.25 → ACUMULACION
- 0.25–0.5 → ALCISTA_A
- 0.5–0.75 → ALCISTA_B
- > 0.75 → DISTRIBUCION (euforia)

**lth_supply** (largo, flujo) — heredada de v1, confirmada
- Valor en millones de BTC
- > 15 → ACUMULACION
- 14–15 → ACUMULACION
- 13.5–14 → ALCISTA_A
- 12.5–13.5 → ALCISTA_B
- < 12.5 → DISTRIBUCION

**btc_vs_ath** (medio, valuación) — heredada de v1, confirmada
- Valor: % desde el ATH
- < -60 → BAJISTA
- -60 a -40 → ACUMULACION
- -40 a -20 → ALCISTA_A
- -20 a -5 → ALCISTA_B
- > -5 → DISTRIBUCION

**Precio vs MA50** (medio, momentum) — clasificación nueva
- Valor: ratio precio / MA50, velas diarias
- < 0.90 → BAJISTA
- 0.90–0.97 → ACUMULACION
- 0.97–1.05 → ALCISTA_A
- 1.05–1.15 → ALCISTA_B
- > 1.15 → DISTRIBUCION

**fear_greed** (medio, sentimiento) — heredada de v1, confirmada
- < 20 → ACUMULACION
- 20–40 → ACUMULACION
- 40–60 → ALCISTA_A
- 60–80 → ALCISTA_B
- > 80 → DISTRIBUCION

**btc_dominance** (medio, flujo) — heredada de v1, confirmada
- > 60 → BAJISTA
- 57–60 → ACUMULACION
- 53–57 → ALCISTA_A
- 48–53 → ALCISTA_B
- < 48 → DISTRIBUCION

**vol_mcap_ratio** (medio, participación) — heredada de v1, confirmada
- IMPORTANTE: input = promedio del ratio en ventana de semanas, no el valor instantáneo
- < 2 → ACUMULACION
- 2–4 → ACUMULACION
- 4–7 → ALCISTA_A
- 7–12 → ALCISTA_B
- > 12 → DISTRIBUCION

### Señales de CORTO → votan 3 estados direccionales
(ALCISTA / LATERAL / BAJISTA)

**Precio vs EMA20** (corto, momentum) — clasificación nueva
- Valor: ratio precio / EMA20, velas 4h
- < 0.98 → BAJISTA
- 0.98–1.02 → LATERAL
- > 1.02 → ALCISTA

**funding_btc** (corto, sentimiento) — adaptada de v1 a 3 estados
- Valor: funding rate de BTC perpetuos
- < -0.01 → BAJISTA
- -0.01 a 0.01 → LATERAL
- > 0.01 → ALCISTA

**Volumen relativo** (corto, participación) — clasificación nueva
- Valor: ratio volumen_actual / promedio_20_velas, velas 4h
- Direccionada por el color de la vela:
- ratio < 0.80 → LATERAL (volumen bajo, sin convicción)
- ratio ≥ 0.80 + vela verde → ALCISTA
- ratio ≥ 0.80 + vela roja → BAJISTA
