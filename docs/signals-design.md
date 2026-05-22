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
