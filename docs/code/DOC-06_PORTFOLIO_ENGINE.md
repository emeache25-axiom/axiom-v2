# DOC-06 — PORTFOLIO ENGINE: La construcción del cocktel

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-06 (el motor que arma la cartera — encarna P3)
**Versión:** 2.0 (destila el legacy: PCF + RF)
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00, DOC-02 (DNA — DNA Distance), DOC-04 (Edge — scores), DOC-05 (Universe — tiers).
**Alimenta a:** DOC-07 (Exit/Ejecución/Medición).
**Absorbe del legacy:** PCF (Portfolio Construction Framework), RF (Ranking
Framework). Encarna P3 (el poder está en el cocktel).

---

## 1. PROPÓSITO

El Edge Engine (DOC-04) puntuó cada oportunidad por separado. El Portfolio Engine
responde la pregunta que ningún motor anterior puede contestar, porque ninguno mira
el conjunto:

> **¿Qué combinación de oportunidades, y con cuánto capital en cada una, arma la
> mejor cartera posible para hoy?**

Acá vive el principio fundacional de CODE:

> **P3 — El poder está en el cocktel.** La suma de retornos de varios pares
> descorrelacionados supera a cualquier par individual. No se busca *la* mejor
> oportunidad; se busca *la mejor cartera de* oportunidades.

> **Principio del PCF que lo resume:** encontrar oportunidades no es suficiente. El
> resultado final depende de **cómo se asigna el capital** entre ellas. La gestión
> del portfolio es tan importante como la calidad de las oportunidades.

---

## 2. LA UNIDAD: "OPORTUNIDAD", NO "ACTIVO" (del PCF)

Lo que el Portfolio asigna no es un activo, es una **oportunidad**, definida como:

```
Oportunidad = Activo + Estado + Setup + Horizonte
```

El mismo par puede entrar al cocktel por dos oportunidades distintas (un breakout
de corto y una reversión de medio plazo) o no entrar pese a ser "bueno" si su
estado actual no ofrece setup. Esto importa para el rebalanceo (§7): una posición
se cierra cuando *su oportunidad* se agota, no cuando "el activo deja de gustar".

---

## 3. POR QUÉ ESTE MOTOR ES SEPARADO DEL EDGE

El corte Edge↔Portfolio (ya anunciado en DOC-04 §9) es deliberado:

- **Edge (DOC-04):** evalúa cada par **en aislamiento**. "¿Cuán buena es esta
  oportunidad?" — respuesta independiente de las demás.
- **Portfolio (DOC-06):** evalúa el **conjunto**. "¿Cuál combinación forma la mejor
  cartera?" — respuesta intrínsecamente relacional.

La razón es la correlación: la calidad de una cartera **no** es la suma de las
calidades individuales. La frase del PCF lo dice perfecto:

> *10 memecoins altamente correlacionadas no equivalen a 10 oportunidades
> independientes.*

Son, en riesgo real, casi una sola apuesta repetida 10 veces. El Edge no puede ver
esto porque mira un par a la vez; el Portfolio existe precisamente para verlo.

---

## 4. LOS CINCO SUB-MOTORES (del PCF)

El Portfolio Engine es una secuencia de cinco etapas:

```
edges puntuados (DOC-04, dentro del universo DOC-05)
   │
   ▼
[C1] SELECTION   → ¿qué oportunidades entran al pool de candidatos?
   │
   ▼
[C2] DIVERSIFICATION → ¿el pool está descorrelacionado? (P3, DNA Distance)
   │
   ▼
[C3] ALLOCATION  → ¿cuánto capital a cada una?
   │
   ▼
[C4] RISK        → ¿la cartera respeta los límites de riesgo?
   │
   ▼
[C5] REBALANCING → ¿cuándo y cómo se ajusta lo ya abierto?
   │
   ▼
cocktel del día → Ejecución (DOC-07)
```

### 4.1 SELECTION — quiénes son candidatos

Selecciona oportunidades del ranking del Edge. Métodos (del PCF): **Top N**, **Top
Percentile**, **Tier Based** (cuota por tier de capitalización — DOC-05), **Threshold
Based** (clase mínima, p.ej. C o mejor). El método se calibra; probable híbrido:
threshold de clase + cuota por tier para no llenar el cocktel de un solo tier.

### 4.2 DIVERSIFICATION — el corazón de P3

Evita la concentración redundante. Se diversifica por cinco ejes (del PCF):

| Eje | Pregunta | Insumo |
|-----|----------|--------|
| **Por ADN** | ¿Son caracteres distintos? | **DNA Distance (DOC-02 §6)** |
| **Por sector** | ¿Supercategorías distintas? | Coins DB supercat |
| **Por activo** | ¿No demasiado en un par? | trivial |
| **Por estado** | ¿No todo en el mismo estado? | DOC-03 |
| **Por setup** | ¿No todo el mismo evento? | DOC-04 |

El eje estrella es **por ADN, vía DNA Distance**. Dos pares con ADN cercano
(BTC↔ETH, PEPE↔WIF) aportan poca diversificación aunque sean activos distintos;
dos con ADN distante diversifican de verdad. **El DNA Distance es la forma
cuantitativa de P3** — convierte "no pongas todo en lo mismo" en un número.

### 4.3 ALLOCATION — cuánto a cada una

Determina el peso de cada oportunidad. Métodos (del PCF), de simple a sofisticado:
- **Equal Weight** — uniforme. Simple, robusta, auditable. *Buen punto de partida.*
- **Score Weight** — proporcional al Opportunity Score / Quality (DOC-04).
- **Risk Weight** — inversa al riesgo estimado: más riesgo, menos capital.
- **Hybrid Weight** — combina calidad + convicción + riesgo + diversificación.

> Recomendación de arranque (P8, P6): empezar con **Equal Weight** —es imbatible en
> robustez y deja medir el valor del resto del sistema sin que la asignación
> confunda los resultados— y solo pasar a Hybrid si el backtest demuestra que mejora
> el retorno ajustado por riesgo neto de costos.

### 4.4 RISK — los límites que no se cruzan

El Risk Engine controla exposición, concentración, correlación, volatilidad y
drawdown. Vía **límites de concentración** (del PCF), con valores a calibrar:
- Máximo por activo.
- Máximo por sector.
- Máximo por ADN (no más de X% en un mismo arquetipo).
- Máximo por setup.
- **Máximo por tier** (DOC-05): techo a la exposición en MICRO por iliquidez, por
  más alfa que prometa H4.

> El Risk Engine puede **vetar** una asignación que Allocation propuso. La calidad
> nunca justifica romper un límite de riesgo (filosofía del PCF: no se maximiza
> exposición, se maximiza oportunidad *ajustada por riesgo*).

### 4.5 REBALANCING — mantener el cocktel vivo

El cocktel no es estático. Se ajusta por tres tipos de disparador (del PCF):
- **Periódico** — revisión regular.
- **Por evento** — cambio de ranking, de estado, de setup, de riesgo.
- **Por degradación** — **opportunity decay**: si una oportunidad pierde su edge
  (el Lift de su setup se desploma, DOC-04), se reduce o se cierra.

Cada posición se revisa contra *su* oportunidad original (§2): si el setup que la
justificó ya se resolvió o se degradó, sale — liberando capital para una mejor.

---

## 5. EL RANKING (del RF) — ordenar antes de asignar

Entre el Edge y la Selection hay un paso de **ranking** (Ranking Framework legacy).
El Edge da scores absolutos por par; el RF los ordena en una lista priorizada del
universo elegible, que es lo que Selection consume. La diferencia con el Edge:

- El **Edge Score** es "cuán buena es esta oportunidad" (absoluto, por par).
- El **Ranking** es "en qué orden de preferencia están hoy" (relativo, del conjunto).

En la práctica v2, ranking y selección viven juntos en este motor (no justifican
documento aparte — economía de motores, DOC-00). El RF se absorbe como el paso de
ordenamiento previo a §4.1.

---

## 6. LAS TRES MÉTRICAS DE LA CARTERA (del PCF)

Igual que un par tiene su DNA Score, una **cartera** tiene tres números (0–100):

- **Portfolio Score (PFS)** — calidad agregada. ¿Qué tan buenas son, en conjunto,
  las oportunidades elegidas?
- **Portfolio Quality (PFQ)** — robustez estructural. ¿Qué tan bien diversificada y
  sólida es la construcción? (acá pesa el DNA Distance).
- **Portfolio Risk (PFR)** — riesgo agregado. Exposición, correlación, drawdown
  potencial.

El objetivo no es maximizar PFS solo, sino la relación **PFS ajustado por PFR** con
PFQ alta. Una cartera de score altísimo pero toda correlacionada (PFQ baja, PFR
alto) es peor que una de score algo menor pero robusta.

---

## 7. LA REGLA DE ORO: ABSTENERSE ES VÁLIDO (DOC-00 §8)

El Portfolio Engine **puede decidir no armar cocktel hoy**, o armarlo con menos
posiciones de las posibles, sin penalización. Si el universo no ofrece suficientes
oportunidades descorrelacionadas con EV+ neto de costos, la respuesta correcta es
*"hoy el cocktel viable es pequeño"* o *"hoy no hay cocktel"*.

> No se fuerzan posiciones para alcanzar el 1% diario. El 1% es vara de medición,
> no cuota obligatoria (DOC-00). Forzar trades para llegar al número es el camino
> más rápido a destruir el edge. La capacidad de abstención es una **feature**, no
> una falla.

---

## 8. FLUJO DEL MOTOR

```
edges puntuados (DOC-04) ∩ universo elegible (DOC-05)
   │
   ▼
[1] RANKING (RF): ordenar por preferencia relativa
   │
   ▼
[2] SELECTION: candidatos (threshold de clase + cuota por tier)
   │
   ▼
[3] DIVERSIFICATION: filtrar redundancia por DNA Distance + sector + estado + setup
   │
   ▼
[4] ALLOCATION: pesos (Equal Weight de arranque → Hybrid si el backtest lo gana)
   │
   ▼
[5] RISK: aplicar límites de concentración; vetar lo que los cruce
   │
   ▼
[6] Calcular PFS / PFQ / PFR del cocktel resultante
   │
   ▼
[7] ¿Cartera viable? → emitir cocktel a Ejecución (DOC-07)
                     → si no: abstenerse o cocktel reducido (§7)
   │
   ▼
[8] REBALANCING continuo de lo abierto (eventos / decay)
```

Frecuencia: el cocktel se arma según el horizonte de las oportunidades (típico:
diario), y el rebalanceo corre de forma continua sobre lo ya abierto.

---

## 9. DEUDA CONSCIENTE

1. **Límites de concentración** — todos los "máximo por X" son a calibrar; el PCF
   los dejó explícitamente para implementación.
2. **Método de Allocation** — arranca Equal Weight; el salto a Hybrid debe ganárselo
   en backtest (retorno ajustado por riesgo neto de costos).
3. **DNA Distance operativo** — depende de que DOC-02 §6 implemente la métrica de
   distancia concreta. Sin ella, la diversificación por ADN es cualitativa.
4. **Función de riesgo (PFR)** — cómo se agrega exposición/correlación/drawdown en
   un número 0–100 está por definir.
5. **Umbral de "cartera viable"** (§7) — cuántas oportunidades mínimas, qué PFQ
   mínima para no abstenerse: a calibrar.
6. **Tamaño de posición absoluto** — el % de capital total en riesgo por cocktel
   (no solo el reparto relativo) es decisión de gestión de capital, pendiente.

---

## 10. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

- **Bot v2 multi-estrategia:** ya ejecuta varias estrategias en paralelo — es el
  sustrato natural del cocktel (varias oportunidades activas a la vez). El Portfolio
  Engine es la capa que decide *cuáles* y *con cuánto*, que hoy se define a mano.
- **DNA Distance (DOC-02):** el `independence_score` y `btc_correlation` que el
  `dna_engine_v01.py` ya calcula son el germen de la diversificación por correlación
  (§4.2). Recordá: el eje BTC salió del arquetipo justamente para vivir acá (P3).
- **Coins DB supercat:** la diversificación por sector (§4.2) usa la taxonomía de
  supercategorías ya existente.
- **Stats engine / backtester:** PFS/PFQ/PFR y la validación del método de
  allocation se miden con la infraestructura de medición que AXIOM ya tiene.

El Portfolio Engine convierte la ejecución multi-estrategia manual de AXIOM en una
construcción de cartera sistemática, descorrelacionada y controlada por riesgo.

---

## ESTADO
DRAFT · v2.0 · destila PCF + RF.
Decisiones tomadas: la unidad es la *oportunidad* (no el activo); diversificación
por DNA Distance como corazón de P3; Equal Weight de arranque; el Risk Engine puede
vetar; abstenerse es válido; ranking+selección viven en este motor (RF absorbido).
Próximo: revisión y aprobación → DOC-07 (Exit, Ejecución y Medición), el último: las
salidas adaptativas (P1, el 1% es piso), la integración con el bot v2, y la medición
del forward testing real.
