# DOC-04 — EDGE ENGINE: ¿Vale la pena operar esto?

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-04 (motor de decisión, nivel rápido)
**Versión:** 2.0 (destila el legacy: ORF + OES + EC)
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00, DOC-01, DOC-02 (DNA), DOC-03 (State).
**Alimenta a:** DOC-06 (Portfolio — ranking y selección del cocktel).
**Absorbe del legacy:** ORF (Opportunity Research Framework), OES (Opportunity
Engine Spec, parte de evaluación), EC (los dominios de alfa), y las hipótesis H6
(Alignment) y H2 (Clustering / Opportunity Momentum).

---

## 1. PROPÓSITO

El DNA dijo *quién es* el par (DOC-02). El State dijo *qué está haciendo ahora* y
detectó una transición explotable (DOC-03). El Edge Engine responde la pregunta
que convierte observación en decisión:

> **¿Esta oportunidad tiene esperanza matemática positiva, neta de costos?**

No "¿va a subir?". La pregunta es de **ventaja**: dado quién es el par, en qué
estado está, y qué evento ocurre, ¿la probabilidad de alcanzar el Target supera lo
suficiente a la de tocar el Stop como para que, después de comisiones, spread y
slippage, quede esperanza positiva?

Si la respuesta es sí, el par es un **candidato** que pasa al Portfolio Engine
(DOC-06) para competir por un lugar en el cocktel. El Edge no decide cuánto capital
ni arma la cartera: decide *si esto es una oportunidad real* y *cuán buena es*.

---

## 2. LA FILOSOFÍA: OPORTUNIDAD RELATIVA, NO ABSOLUTA (del ORF)

Acá está el giro conceptual más importante del sistema, heredado del ORF:

> La mayoría de los sistemas preguntan: **¿debo comprar este activo?**
> CODE pregunta: **¿cuál es el mejor activo del universo en este momento?**

No se buscan señales absolutas, se buscan **ventajas relativas**. Una oportunidad
existe cuando la probabilidad de alcanzar el Target *en este contexto* supera la
probabilidad *promedio del universo*:

```
Existe oportunidad  ⟺  P(Target | Contexto)  >  P(Target | Universo)
```

Esto conecta con P3 (el poder está en el cóctel): no necesito que un par sea bueno
en abstracto, necesito que sea **mejor que la alternativa** en este momento. El
Edge mide esa ventaja relativa por par; el Portfolio (DOC-06) la usa para elegir.

> **Principio rector (del ORF):** el Edge Engine no intenta predecir precios ni
> adivinar el futuro. Su misión es evaluar la **calidad relativa de las
> oportunidades observables** en cada instante.

---

## 3. EL EDGE SCORE (0–100) Y SUS COMPONENTES

El Edge de un par se sintetiza en un **Edge Score** (en el legacy, Opportunity
Score). Es la combinación ponderada de cinco componentes — cada uno responde una
sub-pregunta y se nutre de un motor anterior:

| # | Componente | Pregunta | Fuente | Variables clave |
|---|-----------|----------|--------|-----------------|
| **A** | **DNA** | ¿Quién es? | DOC-02 | DNA Score, Hit Rate, Opportunity Density, Persistence, Quality |
| **B** | **STATE** | ¿Cómo está ahora? | DOC-03 | Activity, Expansion, Compression, Momentum, **State Transition** factor |
| **C** | **SETUP** | ¿Qué evento ocurre? | DOC-03 (§9) | Wick Recovery, Liquidity Sweep, Compression Breakout, Volume Explosion, Microcap Expansion |
| **D** | **OPPORTUNITY MOMENTUM** | ¿Viene dando oportunidades? | DOC-02/03 | Density 24h / 72h / 7d, Recent Target Frequency |
| **E** | **CONTEXTO TEMPORAL** | ¿Ventana favorable? | this engine | Session, Hour, Weekday, Weekend score |

```
Edge Score = w1·DNA + w2·State + w3·Setup + w4·OppMomentum + w5·TimeContext
```

Los pesos `w1..w5` **no se decretan: se investigan** (P6). Un peso es una hipótesis
sobre cuánto aporta cada componente, y se calibra con los métodos de §6.

> **Componente B y el corazón del State:** el *State Transition factor* es donde
> entra H5 (DOC-03). No pesa solo "está en compresión", sino "está en compresión y
> su `P(compresión→expansión)` es alta". El Edge premia las transiciones probables,
> no los estados quietos.

---

## 4. LOS 5 DOMINIOS DE ALFA (del EC) — dónde buscar el edge

El legacy apostó que el edge real no está en momentum o volatilidad genéricos, sino
en cinco fenómenos concretos. Son las hipótesis operativas que el Edge Engine
evalúa, y mapean a los setups del Componente C:

**1. Dormancy Breakouts** — rupturas tras letargo. Un par en DORMANCY que activa.
Mapea al arquetipo EXPLOSIVO (DOC-02) y al estado DORMANCY→EXPANSION (DOC-03).

**2. Liquidity Sweeps** — barridos de liquidez: el precio caza stops y revierte.
Mapea al gen WICK (H3) y a la Sweep Signature.

**3. Opportunity Momentum** — la propia capacidad de dar oportunidad persiste
(H2 Clustering). Un par que dio hits recientes tiende a seguir dándolos. Es el
Componente D del Edge Score.

**4. Microcap Opportunity Density** — las microcaps generan oportunidades
asimétricas (H4). El edge es más denso abajo en el ranking de capitalización
(cruza con DOC-05 Universe, tiers, P5).

**5. State Transitions** — el cambio de estado como señal (H5). Ya es el núcleo del
State Engine (DOC-03) y del Componente B.

> Cada dominio es una **hipótesis falsable**, no una certeza. El Edge Engine las
> evalúa con datos; las que no producen Lift neto de costos (§5) se descartan (P6).

**Setup Assessment (del OES).** Cada setup detectado no entra crudo al Score: se
evalúa por su track record. El OES define cinco medidas por setup — calidad
histórica, frecuencia, success rate, estabilidad y persistencia. Un *Compression
Breakout* con success rate alto y estable pesa en el Componente C; el mismo setup
con historial errático, no. El nombre del setup no vale nada; su track record neto
de costos, todo.

---

## 5. LA MÉTRICA MAESTRA: LIFT (del ORF)

¿Cómo se sabe si el Edge Score sirve? Con **Lift**: cuánto mejor es la tasa de
acierto de los pares bien rankeados respecto al universo entero.

```
Lift = Hit Rate (pares con Edge alto) / Hit Rate (universo)
```

Ejemplo del ORF: universo 42%, top decil 63% → Lift = 1.50. El ranking produce
oportunidades 50% mejores que elegir al azar. **Si Lift ≤ 1, el Edge Engine no
aporta nada** y se rechaza — da igual lo elegante que sea la fórmula (P6).

**Test de deciles:** se ordena el universo por Edge Score, se parte en deciles, y
se compara el decil top (10%) contra el bottom y contra la media en Hit Rate,
Opportunity Density y Profit Factor. Un Edge Score válido muestra **monotonía**:
más score → más hit rate, de forma consistente.

---

## 6. VALIDACIÓN (del ORF — rigor de DOC-00 §4)

El Edge Engine es puro P6: no se cree, se prueba. Batería heredada del ORF:

- **Validación temporal:** Lift y Hit Rate en ventanas de 30/90/180/365 días. ¿Persiste?
- **Out-of-sample:** 70% investigación / 30% reservado. ¿Sobrevive fuera de muestra?
- **Walk-forward:** entrenar → avanzar → evaluar → repetir. Simula condiciones reales.
- **Importancia de factores:** Information Gain, Mutual Information, SHAP,
  Permutation Importance. ¿Qué componentes explican de verdad el ranking?
- **Opportunity Decay:** rolling Lift / Hit Rate / Profit Factor. ¿La efectividad
  decae con el tiempo? (un edge conocido se arbitra y muere).
- **Opportunity Stability:** `Std(Lift)`, `Std(Hit Rate)`. ¿Es consistente o errático?
- **Por régimen:** ¿funciona igual en bull / bear / sideways?

**Criterios de aceptación (ORF):** Lift > 1 persistente · supera al universo ·
supera al azar · robusto fuera de muestra · replicable.
**Criterios de rechazo:** no supera al universo o al azar · desaparece fuera de
muestra · sobreajustado · no mejora métricas operativas.

> Costos primero (P7): todas las métricas se calculan **netas de comisión + spread
> + slippage**. Un Lift que solo existe antes de costos es un Lift que no existe.

---

## 7. EL EFECTO ALINEACIÓN (H6 del MPS)

> **H6 — Alignment Effect:** la alineación entre capas aumenta la calidad de la
> oportunidad.

Un par donde **DNA + State + Setup + Momentum + Contexto apuntan todos en la misma
dirección** es mejor candidato que uno donde solo brilla un componente. El Edge
Score lo captura naturalmente al sumar componentes, pero H6 sugiere algo más
fuerte: la alineación puede ser **multiplicativa, no solo aditiva**. Un EXPLOSIVO
(DNA) en COMPRESSION con alta P(→expansión) (State) que además dispara un
Compression Breakout (Setup) y viene con Opportunity Momentum reciente (D) en
sesión favorable (E) — esa confluencia vale más que la suma de sus partes.

Si el backtest confirma H6, los pesos de §3 dejan de ser solo lineales y se
introduce un término de confluencia. Es hipótesis hasta que el código lo muestre.

---

## 8. OPPORTUNITY CLASSES — el output legible (del ORF)

El Edge Score se traduce en clases para comunicación y para filtros del Portfolio:

| Clase | Score | Significado |
|-------|-------|-------------|
| **S** | 90–100 | Oportunidad excepcional |
| **A** | 80–89 | Muy alta calidad |
| **B** | 70–79 | Calidad elevada |
| **C** | 60–69 | Aceptable |
| **D** | 50–59 | Neutral |
| **E** | <50 | Sin interés operativo |

El Portfolio Engine (DOC-06) típicamente solo considera candidatos de clase C o
superior, pero ese corte es un parámetro a calibrar, no un dogma.

---

## 9. DÓNDE TERMINA EL EDGE Y EMPIEZA EL PORTFOLIO (corte de alcance)

El OES legacy mezclaba **evaluar** y **rankear/seleccionar** en un solo motor. En
v2 se separan, y el corte es deliberado:

- **Edge Engine (este doc):** evalúa **cada par por separado**. Produce un Edge
  Score y una clase por candidato. Responde *¿esto es una buena oportunidad?* — una
  pregunta que se contesta mirando el par solo.
- **Portfolio Engine (DOC-06):** mira **todos los candidatos juntos** y arma el
  cóctel. Rankea, selecciona, descorrelaciona (DNA Distance, DOC-02 §6), asigna
  capital. Responde *¿cuál combinación de oportunidades forma la mejor cartera?* —
  una pregunta que solo se contesta mirando el conjunto.

> Por qué el corte: evaluar un par es independiente de los demás; armar el cóctel
> es intrínsecamente relacional (P3 — la descorrelación solo existe entre pares).
> Mezclarlos haría que el Edge Score de un par dependiera de qué otros pares
> existen hoy, lo que rompe la comparabilidad. El ranking final, por tanto, vive en
> DOC-06.

---

## 10. FLUJO DEL MOTOR

```
Para cada candidato que el State marcó con transición explotable:
   │
   ▼
[1] Componente A — leer DNA Profile (DOC-02): Score, Hit Rate, Density, Quality
   │
   ▼
[2] Componente B — leer State (DOC-03): factores + P(transición)
   │
   ▼
[3] Componente C — identificar Setup activo (dominio de alfa, §4)
   │
   ▼
[4] Componente D — Opportunity Momentum: density 24h/72h/7d
   │
   ▼
[5] Componente E — Contexto temporal: sesión/hora/día
   │
   ▼
[6] Edge Score = Σ wi·componente   (+ término de alineación si H6 se valida)
   │
   ▼
[7] Asignar Opportunity Class (S..E)  ·  todo neto de costos (P7)
   │
   ▼
[8] Emitir candidato {par, Edge Score, clase, componentes} → Portfolio (DOC-06)
```

---

## 11. DEUDA CONSCIENTE

1. **Los pesos w1..w5** — hipótesis pura hasta calibrar con importancia de factores
   (§6). Punto de partida razonable: DNA y State con más peso, Contexto con menos.
2. **Forma de la combinación** — aditiva (§3) vs. con término multiplicativo de
   alineación (§7, H6). A decidir con el backtest.
3. **Definición operativa de cada Setup** (§4) — Liquidity Sweep, Compression
   Breakout, etc. necesitan reglas concretas. Varios se apoyan en features que el
   `feature_engine.py` ya tiene (pivotes, ATR, vol_ratio).
4. **Umbral de clase mínima** para pasar a Portfolio — provisorio en C.
5. **Opportunity Decay** — un edge publicado/conocido se arbitra. Monitoreo
   permanente del Lift rolling para detectar muerte de edge (→ DOC-07 Monitoring).

---

## 12. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

- **Backtester independiente del bot** (`bot.js`, pestaña Backtesting): es la
  infraestructura natural para medir Lift, deciles y validación temporal sin tocar
  instancias vivas. Ya resuelto el problema de performance (sliding window).
- **Screener** (`selection_service.py`): su screening de volatilidad estructural y
  open-to-high impulse es un **proto-Edge** — ya rankea candidatos por una noción
  de oportunidad. El Edge Engine lo generaliza y le agrega el rigor del Lift.
- **Watchlist + Coins Sugeridas:** la UI donde los candidatos de clase alta
  naturalmente se mostrarían.
- `feature_engine.py`: provee las features de los Componentes B y C.

El Edge Engine no es una UI nueva: es el **cerebro de scoring** detrás del screener
que AXIOM ya tiene, formalizado con la métrica Lift y la validación del ORF.

---

## ESTADO
DRAFT · v2.0 · destila ORF + OES (evaluación) + EC.
Decisiones tomadas: oportunidad **relativa** (no absoluta); Edge Score de 5
componentes; métrica maestra **Lift**; clases S–E; **el ranking/selección del
cóctel se separa hacia DOC-06** (el Edge evalúa por par, el Portfolio combina).
Próximo: revisión y aprobación → DOC-05 (Universe Engine), el nivel lento que
filtra qué pares merecen entrar a todo este pipeline (P5, tiers, H4 Microcap).
