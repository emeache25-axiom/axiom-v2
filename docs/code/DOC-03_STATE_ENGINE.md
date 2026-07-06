# DOC-03 — STATE ENGINE: Qué está haciendo un par ahora

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-03 (segundo motor del nivel rápido)
**Versión:** 2.0 (destila el legacy: SES + concepto de Setup del SETUPES)
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00 (Master), DOC-01 (Data Layer), DOC-02 (DNA Engine).
**Alimenta a:** DOC-04 (Edge), DOC-06 (Portfolio).
**Absorbe del legacy:** SES (State Engine Spec), la hipótesis H5 (State
Transitions) del MPS, y el concepto de *setup* del SETUPES (ver §9).

---

## 1. PROPÓSITO

Si el DNA Engine (DOC-02) responde *¿quién es este par?*, el State Engine responde
la pregunta complementaria:

> **¿Qué está haciendo este par AHORA?**

El ADN es la naturaleza persistente (meses); el estado es la **condición temporal**
(hoy, esta semana). Un par OSCILADOR por ADN puede estar hoy en estado de
COMPRESIÓN, o saliendo en EXPANSIÓN, o dormido. El carácter no cambia; el estado
sí, todo el tiempo.

> **Principio rector (del SES):** el mercado no debe analizarse como una serie
> continua de velas, sino como una **secuencia de estados observables**. Las
> oportunidades no aparecen al azar — *emergen cuando los estados evolucionan,
> colapsan o transicionan*. Esa es la tesis central de este motor.

El State Engine es el **segundo motor a construir**: necesita OHLCV (que ya provee
el Data Layer) y se apoya en el ADN para interpretar lo que ve (§7).

---

## 2. ADN vs ESTADO — la distinción que sostiene todo

| | DNA (DOC-02) | State (DOC-03) |
|---|---|---|
| Pregunta | ¿Quién es? | ¿Qué hace ahora? |
| Naturaleza | Persistente (meses) | Temporal (horas–días) |
| Cambia | Lento (drift, semanal) | Rápido (transiciones) |
| Uso | Elige la herramienta | Dispara el momento |

La misma señal no significa lo mismo según el ADN (DOC-02 §1). Y el mismo estado
no vale lo mismo según el ADN: una COMPRESIÓN en un par EXPLOSIVO (que comprime y
suelta con fuerza) es oro; la misma COMPRESIÓN en un ERRÁTICO es ruido. **El
estado se lee siempre a través del ADN** (§7).

---

## 3. LA TESIS QUE EL MOTOR ENCARNA (H5 del MPS)

> **H5 — State Transitions:** las transiciones de estado son más informativas que
> los estados absolutos.

Esto cambia dónde se mira. No es tan importante saber que un par "está en
compresión" como detectar que **acaba de pasar** de dormancy a compresión, o que
**está por pasar** de compresión a expansión. El alfa vive en el *cambio*, no en
la *foto*. Por eso el State Engine no es un clasificador estático: es un detector
de transiciones (§6).

---

## 4. TAXONOMÍA DE ESTADOS (8, del SES)

Todo par está siempre en exactamente uno de estos estados (más el de transición):

**DORMANCY** — actividad reducida. Volumen y ATR bajos, movimientos limitados,
baja oportunidad inmediata. *El par duerme.*

**COMPRESSION** — volatilidad que se reduce progresivamente. ATR y rango
decrecientes: energía potencial acumulándose. *El resorte se carga.*

**EXPANSION** — liberación significativa de movimiento. Rango, volatilidad y
actividad en aumento. *El resorte se suelta.*

**TREND** — movimiento persistente y direccional, con eficiencia. *El par va a
algún lado y se queda yendo.*

**RECOVERY** — recuperación tras un evento extremo: reversión, absorción,
reequilibrio. *El par se acomoda después del golpe.*

**EXHAUSTION** — pérdida de fuerza de un movimiento: desaceleración, divergencia,
menos participación. *La ola se queda sin energía.*

**CHAOS** — alta incertidumbre y volatilidad sin estructura: señales
contradictorias, baja predictibilidad. *No se entiende qué pasa.*

**TRANSITION** — el estado intermedio: cambio de un estado a otro, inestabilidad
temporal, reorganización. *Es el estado más informativo (H5).*

> **Coherencia con el ADN.** Estos estados temporales riman con los arquetipos
> persistentes del DOC-02, pero no se confunden: COMPRESSION/EXPANSION son los
> estados que un par EXPLOSIVO atraviesa; TREND es el estado natural de un
> TENDENCIAL; CHAOS es lo que un ERRÁTICO muestra casi siempre. El arquetipo dice
> qué estados son *esperables* y *aprovechables* en ese par.

---

## 5. CÓMO SE MIDE UN ESTADO

### 5.1 De features a estado (jerarquía del SES)

```
Features  →  Factors  →  State
```

El estado no se lee de un indicador suelto, sino de **factores** que combinan
varias features para ganar robustez (igual criterio que DOC-02). Features de
estado (del SES, ya disponibles o calculables con `feature_engine.py`):

Volatility Rank · ATR Percentile · Volume Percentile · Range Ratio · Momentum
Score · Opportunity Density (corto plazo) · Expansion Frequency.

### 5.2 Las tres medidas de cada estado

Cada clasificación de estado lleva tres números (del SES), no solo la etiqueta:

- **State Score (0–100)** — *intensidad* del estado. Una compresión puede ser leve
  o extrema.
- **State Confidence (0–100)** — *confianza* de la clasificación. Cuán nítida es la
  señal vs. cuán ambigua.
- **State Persistence (baja/media/alta)** — *duración esperada* del estado. Cuánto
  probablemente dure antes de transicionar.

> Estos tres separan "está en compresión, fuerte y clara, y va a durar" de "parece
> compresión pero dudoso y a punto de romper". El Edge Engine (DOC-04) necesita esa
> diferencia para decidir si vale la pena actuar.

---

## 6. TRANSICIONES — el corazón del motor (H5)

### 6.1 El ciclo natural de estados (del SES)

El legacy define un ciclo de transiciones "permitidas" (las que tienen sentido
estructural):

```
DORMANCY → COMPRESSION → EXPANSION → TREND → EXHAUSTION → RECOVERY → DORMANCY
```

Es un ciclo, no una flecha: el par recorre la rueda una y otra vez. Y existen
**transiciones anómalas** (saltos fuera del ciclo) que son, en sí, información
valiosa: un salto directo a CHAOS, una expansión sin compresión previa.

### 6.2 La matriz de transición

El motor mantiene una **matriz de probabilidades de transición** por par:

```
P(COMPRESSION → EXPANSION)
P(TREND → EXHAUSTION)
P(RECOVERY → TREND)
...
```

Acá está el alfa de H5: si un par está en COMPRESSION y su
`P(COMPRESSION → EXPANSION)` histórica es alta, **estar en compresión es una señal
anticipatoria**, no una foto. La matriz convierte el estado actual en una
predicción probabilística del próximo — sin predecir precio, solo dinámica de
estados.

### 6.3 Historial y drift de estados

- **State History** — cada par guarda su secuencia de estados: cuáles, cuánto
  duraron, con qué frecuencia. Es lo que alimenta la matriz.
- **State Drift** — cambios en la *dinámica histórica* de estados de un par (no en
  el estado actual). Si un par que solía ciclar limpio empieza a saltar a CHAOS,
  su drift de estado avisa — y puede anticipar un drift de ADN (DOC-02 §6).

---

## 7. EL ESTADO SE LEE A TRAVÉS DEL ADN (integración DES ↔ SES)

Esta es la integración que da potencia al sistema. El State Engine no clasifica en
el vacío: usa el ADN del par (DOC-02) como contexto.

- **Qué estados esperar:** un par EXPLOSIVO pasará tiempo en COMPRESSION y
  EXPANSION; un OSCILADOR ciclará suave sin TREND fuerte; un PULSÁTIL mostrará
  EXPANSION recurrente sin COMPRESSION previa clara.
- **Cómo ponderar la confianza:** una EXPANSION en un par con alta Expansion
  Signature (DOC-02 §6) es más creíble que en uno que casi nunca expande.
- **Qué transiciones importan:** la `P(COMPRESSION → EXPANSION)` pesa distinto en
  un EXPLOSIVO (donde es su negocio) que en un ERRÁTICO (donde es azar).

> Sin el ADN, el State Engine vería ocho estados iguales para todos los pares. Con
> el ADN, ve ocho estados *interpretados según quién es el par*. Esa es la razón de
> que el DNA Engine se construya primero (DOC-00 §6).

---

## 8. FLUJO DEL MOTOR

```
ohlcv (multi-timeframe corto: 1h/4h)  +  DNA Profile (DOC-02)
   │
   ▼
[1] Calcular features de estado
     Vol Rank · ATR %ile · Volume %ile · Range Ratio · Momentum · ...
   │
   ▼
[2] Combinar en factores → clasificar estado actual (1 de 8)
   │
   ▼
[3] Medir State Score + State Confidence + State Persistence
   │
   ▼
[4] Actualizar State History + matriz de transición del par
   │
   ▼
[5] Evaluar transición: ¿en qué estado está y hacia cuál tiende?
     (leído a través del ADN — §7)
   │
   ▼
[6] Emitir: Current State + Scores + P(transiciones) → Edge Engine (DOC-04)
   │
   ▼
[7] Persistir (states / state_history / state_transitions en PostgreSQL)
```

A diferencia del ADN (recálculo semanal), el estado se recalcula **seguido** —
cada vela de corto plazo o cada pocos minutos— porque es justamente lo que cambia
rápido. Acá es donde encaja un job de APScheduler frecuente, como el que AXIOM ya
usa para el régimen de mercado.

---

## 9. SOBRE EL "SETUP": por qué NO es un motor propio en v2

El legacy tenía un motor aparte, el **Setup Engine (SETUPES)**, entre State y
Opportunity. Definía un *setup* como "una configuración observable que justifica
investigar una oportunidad" — por ejemplo *Dormancy Activation* (requiere estado
DORMANCY) o *Compression Release* (requiere estado COMPRESSION).

**Decisión de diseño v2: el setup no necesita motor propio.** Un setup es,
literalmente, **una transición de estado relevante leída a través del ADN**:

- *Compression Release* = transición `COMPRESSION → EXPANSION` en un par cuyo ADN
  la hace explotable. Eso el State Engine ya lo detecta (§6).
- *Dormancy Activation* = transición `DORMANCY → COMPRESSION/EXPANSION`. Ídem.

Entonces la **detección** del setup vive en el State Engine (es una transición), y
la **decisión de explotarlo** vive en el Edge Engine (DOC-04, ¿hay esperanza
positiva neta de costos?). Partir esto en un tercer motor agregaría una capa sin
agregar capacidad — viola la economía de motores de DOC-00 (§6) y P6. Si en algún
momento el código demuestra que los setups necesitan lógica propia que no cabe ni
en State ni en Edge, se reabre la discusión. Hoy no.

> Esto resuelve la pregunta que quedó abierta en el LEGACY_BRIDGE (§F): **Setup se
> funde en State (detección) + Edge (explotación). No hay DOC de Setup en v2.**

---

## 10. DEUDA CONSCIENTE

1. **Definición operativa de cada estado** — el SES da características cualitativas
   (ATR decreciente, rango creciente…); falta congelar el umbral cuantitativo de
   cada uno. Se calibra con datos (P6).
2. **Factores de estado** — §5 lista features; la combinación features→factores→
   estado está por definir y validar.
3. **Matriz de transición** — requiere historial suficiente por par; los pares
   nuevos o de poca data tendrán matrices pobres hasta acumular State History.
4. **Timeframe del estado** — propuesta 1h/4h; pendiente validar si el estado se
   mide mejor en uno, otro, o ambos.
5. **Clasificación dura vs blanda** — hoy el diseño asume un estado dominante por
   par; podría convenir un vector de pertenencia (40% compresión, 30% dormancy…).
   A decidir con el código.

---

## 11. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

- **Módulo Mercado (régimen):** AXIOM ya clasifica *régimen de mercado* global con
  12 señales en 3 timeframes, snapshots horarios por APScheduler y persistencia en
  PostgreSQL. El State Engine es **el mismo patrón aplicado por par** en vez de al
  mercado entero. La infraestructura (scheduler, persistencia, indicador de
  convicción) ya existe y se reaprovecha.
- `feature_engine.py` — ATR/ATR%, RSI, momentum, vol_ratio: insumos directos de las
  features de estado (§5).
- `dna_engine_v01.py` — ya calcula `vol_persistence` y `vol_realized_7/30/90`, que
  alimentan la detección de COMPRESSION/EXPANSION.
- **Persistencia:** las tablas `states` / `state_history` / `state_transitions`
  siguen el mismo modelo que los snapshots de régimen ya en producción.

El State Engine no es infraestructura nueva: es la lógica de régimen que AXIOM ya
corre, bajada al nivel del par individual e interpretada a través del ADN.

---

## ESTADO
DRAFT · v2.0 · destila SES + H5 + concepto de Setup del SETUPES.
Decisiones tomadas: 8 estados con Score/Confidence/Persistence; transiciones como
fuente de alfa (H5); el estado se lee a través del ADN; **Setup se funde en State +
Edge, no es motor propio**.
Próximo: revisión y aprobación → DOC-04 (Edge Engine), que decide cuáles de estas
transiciones tienen esperanza matemática positiva neta de costos.
