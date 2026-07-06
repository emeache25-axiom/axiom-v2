# LEGACY-BRIDGE — Inventario del corpus v1 → mapa al corpus v2

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** Puente legacy → v2 (no es parte del corpus de 8; es índice/red de seguridad)
**Versión:** 2.0
**Estado:** REFERENCIA — **destilación COMPLETA** (los 8 documentos v2 redactados)
**Fuente:** `CRYPTO_OPPORTUNITY_DISCOVERY_ENGINE__CODE_.docx` (legacy v1, ~770k
caracteres, Phase 1: Bloques A-K, DOC-01 a DOC-27 + specs de infraestructura).
Verificado completo contra el Google Doc original (mismo contenido; las 6
hipótesis maestras y el MPS están presentes en ambos).

> **Cierre (estado actual):** el corpus v2 (DOC-00 a DOC-07) está redactado por
> completo. Todo el material "clave" del legacy fue destilado a su documento v2
> correspondiente. Este puente queda como registro histórico de la migración y
> como índice para auditar que nada importante se perdió. El .docx legacy puede
> archivarse: su contenido vive ahora, reorganizado, en los 8 documentos.

---

## PARA QUÉ EXISTE ESTE DOCUMENTO

El legacy v1 se archivó como baseline, no como basura. Tiene contenido validado
—sobre todo rigor estadístico y definiciones operativas— que no debe perderse al
escribir el corpus v2 limpio.

Este puente es la **red de seguridad**: recorre los 27 documentos legacy, extrae
lo conservable de cada uno, y lo mapea al documento v2 que lo absorberá. Mientras
este puente exista y esté completo, ningún concepto importante se evapora aunque
el .docx quede guardado sin volver a abrirse.

**Cómo se usa:** al escribir cada DOC-0x nuevo, se consulta la columna "→ v2"
de este puente, se incorpora lo que corresponde, y se marca como ABSORBIDO.

---

## TABLA MAESTRA: 27 documentos legacy → corpus v2

| Legacy | Nombre | Capa | Aporte conservable | → v2 | Estado |
|--------|--------|------|--------------------|------|--------|
| DOC-01 | Data Collection Layer (DCLS) | Data | Esquema de recolección OHLCV, fuentes, normalización por instrumento | DOC-01 | ✅ ABSORBIDO |
| DOC-02 | Data Quality Framework (DQF) | Data | Reglas de calidad, validación, trazabilidad, monitoreo de calidad | DOC-01 §6 | ✅ ABSORBIDO |
| DOC-03 | DNA Research Framework (DRF) | Data/Research | **Opportunity DNA**: H1/H0, def. triple-barrier, métricas, tests | DOC-02 §5 | ✅ ABSORBIDO |
| DOC-04 | Quantitative Research Agenda (QRA) | Research | Método de investigación: hipótesis → experimento → validación | DOC-00 §4 / transversal | ✅ ABSORBIDO |
| DOC-05 | Factor Research Framework (FaRF) | Research | Feature vs Factor; síntesis de señales; jerarquía raw→feature→factor | DOC-02/DOC-04 | ✅ ABSORBIDO |
| DOC-06 | Opportunity Research Framework (ORF) | Research | El fin del sistema: ranking por ventaja relativa, no predicción | DOC-04 Edge | ✅ ABSORBIDO |
| DOC-07 | Master Factor Library (MFL) | Research | Catálogo de factores candidatos | DOC-04 §5 | ✅ ABSORBIDO |
| DOC-08 | Research Execution Framework (REF) | Research | Cómo se ejecuta y controla un experimento | transversal | ✅ ABSORBIDO |
| DOC-09 | Experiment Catalog (EC) | Research | Catálogo de experimentos; los 5 dominios de alfa probable | DOC-04 §6 | ✅ ABSORBIDO |
| DOC-10 | Label Engine (LES) | Label | Cómo se etiquetan resultados (hit/fail/unknown) | DOC-02 §5 | ✅ ABSORBIDO |
| DOC-11 | Label Research Framework (LRF) | Label | Investigación de labels | DOC-02 | ✅ ABSORBIDO |
| DOC-12 | DNA Engine Spec (DES) | Intelligence | Signatures, perfiles, DNA Distance/Drift/Clustering | DOC-02 §6 | ✅ ABSORBIDO |
| DOC-13 | State Engine Spec (SES) | Intelligence | 8 estados + transiciones + matriz | DOC-03 | ✅ ABSORBIDO |
| DOC-14 | Setup Engine Spec (SETUPES) | Intelligence | Setup = transición leída por ADN (no motor propio) | DOC-03 §9 / DOC-04 §5 | ✅ ABSORBIDO |
| DOC-15 | Opportunity Engine Spec (OES) | Decision | Scoring (→Edge) + selección (→Portfolio) | DOC-04/DOC-06 | ✅ ABSORBIDO |
| DOC-16 | Validation Framework (VF) | Validation | Validar fuera de muestra; criterios aceptación/rechazo | DOC-04 §8 / DOC-07 §5 | ✅ ABSORBIDO |
| DOC-17 | Backtesting Framework (BTF) | Validation | Refutar no confirmar; walk-forward; modos | DOC-07 §5 | ✅ ABSORBIDO |
| DOC-18 | Ranking Framework (RF) | Decision | Ordenar por ventaja relativa | DOC-06 §5 | ✅ ABSORBIDO |
| DOC-19 | Portfolio Construction (PCF) | Execution | 5 sub-motores; correlación; rebalanceo | DOC-06 | ✅ ABSORBIDO |
| DOC-20 | Monitoring Framework (MF) | Operations | Decay, drift, anomalías en vivo | DOC-07 §5.3 | ✅ ABSORBIDO |
| DOC-21 | Deployment Framework (DF) | Operations | Ejecución reproducible/auditable/recuperable | DOC-07 §4 | ✅ ABSORBIDO |
| DOC-22 | System Integration (SIA) | Architecture | Cómo encajan los motores entre sí | DOC-00 §5 | ✅ ABSORBIDO |
| DOC-23..27 | Infra (Instrument Registry, Order State, Position, Exchange Adapters) | Infra | Specs de ejecución real multi-exchange | DOC-07 / fuera de v2 | ⊘ NO MIGRA (consciente) |

Leyenda: ✅ ABSORBIDO = su material conservable ya vive en el documento v2 indicado ·
⊘ NO MIGRA = excluido por decisión consciente (ver sección correspondiente).

---

## LAS 6 HIPÓTESIS MAESTRAS (del MPS / DOC-01 legacy) — núcleo conceptual

El documento raíz del legacy (Master Project Specification) define seis hipótesis
centrales. Son el ADN intelectual del proyecto: cada una es falsable y mapea a un
motor del v2. **Ninguna debe perderse.**

| # | Hipótesis | Enunciado | → v2 | Conexión con el código actual |
|---|-----------|-----------|------|-------------------------------|
| **H1** | **Opportunity DNA** | Existen activos estructuralmente más propensos a generar oportunidades. | DOC-02 | Es la tesis central del DNA Engine. |
| **H2** | **Opportunity Clustering** | Las oportunidades se agrupan temporalmente (no son uniformes en el tiempo). | DOC-03 State / DOC-04 Edge | Conecta con `vol_persistence` (clustering de volatilidad) del prototipo. |
| **H3** | **Wick Intelligence** | Los mechazos (wicks) contienen información predictiva. | DOC-02 / DOC-03 | **Ya medido:** `body_wick_ratio` en `dna_engine_v01.py`. |
| **H4** | **Microcap Alpha** | Las microcaps generan oportunidades asimétricas. | DOC-05 Universe (tiers, P5) | El tier D Micro del Universe Engine. |
| **H5** | **State Transitions** | Las transiciones de estado son más informativas que los estados absolutos. | DOC-03 State | El State Engine debe medir *cambios*, no solo estados. |
| **H6** | **Alignment Effect** | La alineación entre múltiples capas aumenta la calidad de la oportunidad. | DOC-04 Edge / DOC-06 Portfolio | Confluencia de señales = mayor convicción. |

> **Por qué importan más que los arquetipos:** los arquetipos (oscilador,
> tendencial…) son *cómo* se mueve un par. Estas hipótesis son *qué creemos que
> genera alfa* y son falsables una por una. H3 y H2 ya tienen proxy en el código
> (`body_wick_ratio`, `vol_persistence`); H4 y H5 son guías para Universe y State.
> Cada hipótesis que el backtest confirme o refute (P6) es un avance real.

---

## EXTRACTO DE LO IMPRESCINDIBLE (lo que no se puede perder)

### A. Opportunity DNA — del DRF (DOC-03 legacy) → DOC-02 v2

El concepto que más enriquece nuestro DOC-02 actual. El ADN no se define solo por
*forma* (oscilador/tendencial/etc.) sino por *resultado medible*:

- **Hipótesis fundacional H1:** existen criptos con capacidad estructuralmente
  superior y **persistente** de alcanzar un beneficio antes que una pérdida.
- **Hipótesis nula H0:** las diferencias son azar y desaparecen fuera de muestra.
  `P(Target|A) = P(Target|B)`. El sistema debe refutar H0 para tener derecho a existir.
- **Definición operativa de oportunidad (triple-barrier):** éxito = se alcanza
  **+1.0%** antes que **−0.5%**. Entry = close(t); Target = entry×1.01; Stop =
  entry×0.995. (Conecta directo con P1: el 1% es piso.)
- **Horizontes de label:** 1H/4H/12H/24H sobre base 15m (4/16/48/96 velas).
- **Métricas de oportunidad:**
  - *Opportunity Hit Rate* — métrica principal.
  - *Opportunity Density* — hits por día. **Es el gen RECURRENCIA del DOC-02.**
  - *Opportunity Velocity* — qué tan rápido resuelve.
  - *Opportunity Quality* — Hit Rate × Density.
  - *Opportunity Efficiency* — reward/risk realizado.
  - *MFE / MAE* — máxima excursión favorable / adversa.
- **DNA Score (0-100):** Hit Rate 30% · Density 20% · Time-to-Target 15% ·
  Failure Rate 15% · Consistencia temporal 10% · MFE/MAE 10%. (Pesos = hipótesis.)
- **Tests de validez:** dispersión (¿heterogeneidad real entre activos?),
  persistencia (rolling en 30/90/180/365 d), estabilidad (std del score),
  significancia (bootstrap, permutation, chi-square).
- **Cortes de análisis:** por capitalización (¡P5!), por sesión (Asia/EU/US),
  por día de semana, por régimen (bull/bear/sideways).

> **Decisión de diseño pendiente (acordar en próxima sesión):** el DOC-02 v2
> tendrá DOS capas — la **estructural** (arquetipos + genes de forma, ya escrita)
> y la **de oportunidad** (este Opportunity DNA). La forma dice *qué herramienta*;
> el resultado dice *si vale la pena y cuánto pesa*. El resultado es el juez.

### B. Los 5 dominios donde probablemente está el alfa — del EC (DOC-09 legacy)

El legacy apostó que el primer alfa real no aparece en momentum ni volatilidad
genéricos, sino en la interacción de cinco dominios. Conservar como guía de
investigación (→ DOC-04 Edge / DOC-05 Universe):

1. **Dormancy Breakouts** — rupturas tras letargo (≈ arquetipo EXPLOSIVO/Resorte).
2. **Liquidity Sweeps** — barridos de liquidez.
3. **Opportunity Momentum** — persistencia de la propia capacidad de dar oportunidad.
4. **Microcap Opportunity Density** — densidad de oportunidad en micro caps (P5).
5. **State Transitions** — el cambio de estado como señal (→ DOC-03 State).

### C. Separación de motores — del ORF (DOC-06 legacy) → confirma DOC-00 §5

Frase casi idéntica a nuestro mapa, conservar como validación cruzada:
- Universe Engine: decide **qué activos merecen atención**.
- DNA Engine: mide **quiénes son**.
- State Engine: mide **cómo están**.
- Setup Engine: mide **qué está ocurriendo**.
- Opportunity/Ranking Engine: integra todo en un **ranking operativo**.
- Tesis central: *las mejores oportunidades no se encuentran prediciendo el
  mercado, sino identificando la mayor ventaja relativa en cada momento.*

### D. Jerarquía Feature → Factor — del FaRF (DOC-05 legacy) → DOC-02/DOC-04

- Una **feature** mide algo ("¿hay más volumen de lo normal?").
- Un **factor** explica algo ("¿el activo está experimentando una activación
  relevante?"). Reduce ruido y dimensionalidad, agrega robustez.
- Cadena oficial: `Raw → Features → Factors → DNA → State → Setup → Opportunity`.

### E. Validación y Backtesting — del VF/BTF (DOC-16/17 legacy) → DOC-07

- Todo componente (feature, factor, label, estado, setup, oportunidad) se valida
  con la misma vara: utilidad **real y reproducible**, fuera del período de ajuste.
- El BTF determina si una hipótesis mantiene utilidad fuera de muestra. Es el
  juez empírico de P6 ("el código manda").

### F. Setup Engine — del SETUPES (DOC-14 legacy): ¿concepto nuevo para v2?

El legacy tiene un motor que el corpus v2 **no contempla explícitamente**: el
**Setup Engine**, entre State y Opportunity. Responde "¿hay una configuración
observable que justifique investigar una oportunidad?". En v2 esa función está
implícitamente repartida entre State (DOC-03) y Edge (DOC-04). **Decisión a
tomar:** ¿se mantiene fusionado en v2, o el legacy nos convence de que Setup
merece ser un concepto propio dentro del DOC-04? Anotado, no resuelto.

---

## CONCEPTOS LEGACY QUE *NO* SE MIGRAN (decisión consciente)

Para que "no perder nada importante" no se confunda con "arrastrar todo":

- **Infraestructura de ejecución multi-exchange** (DOC-23..27: Instrument
  Registry, Order State Machine, Position Manager, Exchange Adapters). Valioso
  pero pertenece a la capa de ejecución real; AXIOM ya tiene su propia versión
  (bot v2). Fuera del corpus de diseño v2; se referenciará en DOC-07 si hace falta.
- **Escala de research pesada** (5 dominios × análisis por sesión × día × régimen
  para 300 activos): es la ambición v1 que P8 (escala realista) explícitamente
  redujo. Se conserva como *norte aspiracional*, no como plan de v2.
- **Numeración y bloques A-K:** estructura organizativa de v1, reemplazada por los
  8 documentos. No se migra la forma, solo el contenido.

---

## ESTADO Y PRÓXIMOS PASOS

REFERENCIA · v2.0 · **destilación COMPLETA**.

**Lo hecho (orden real de absorción):**
1. ✅ **DOC-02 v2.1** — Opportunity DNA integrado (triple-barrier como vara de
   medición + captura adaptativa P1; métricas; DNA Score; signatures; DNA Distance).
   DRF y DES absorbidos.
2. ✅ **DOC-01** — Data Quality Framework pendiente de un repaso fino en §6, pero el
   esquema y las fuentes (DCLS) ya formalizados.
3. ✅ **DOC-03** (State) — SES absorbido: 8 estados, matriz de transición (H5),
   Setup resuelto como transición×ADN (no motor propio).
4. ✅ **DOC-04** (Edge) — ORF + OES + 5 dominios de alfa; Opportunity Score, Lift,
   Setup Assessment. Corte Edge↔Portfolio definido.
5. ✅ **DOC-05** (Universe) — tiers (P5), Microcap Research (H4), gate de SALUD +
   FUERZA/FLUJO. Nivel lento separado del rápido.
6. ✅ **DOC-06** (Portfolio) — PCF + RF: 5 sub-motores, DNA Distance como corazón de
   P3, regla de abstención.
7. ✅ **DOC-07** (Exit/Ejecución/Medición) — BTF + DF + MF; **Exit Engine original
   de v2** (el legacy no tenía salidas).

**Resultado:** los 27 documentos legacy quedaron destilados en los 8 del corpus v2.
Todo el material "clave" está absorbido; lo "NO MIGRA" (infra DOC-23..27, escala de
research pesada, numeración v1) quedó excluido por decisión consciente y registrada.

**Próximos pasos (ya fuera del alcance de este puente):**
- Revisar y aprobar los DRAFT (DOC-01 a DOC-07) → pasar a APPROVED con calma.
- Repaso fino del Data Quality Framework en DOC-01 §6 (único pendiente menor de
  absorción).
- Arrancar implementación por orden de construcción (DOC-00 §6): DNA Engine primero
  (el prototipo `dna_engine_v01.py` ya corre; ajustar `classify()` al modelo de dos
  ejes definido en DOC-02 §11).

El legacy puede archivarse: su contenido vive ahora, reorganizado y anclado al
código real de AXIOM, en los 8 documentos del corpus v2.
