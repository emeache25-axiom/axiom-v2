# DOC-07 — EXIT, EJECUCIÓN Y MEDICIÓN: Cosechar, operar, medir

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-07 (cierre del corpus — la capa que toca el mercado real)
**Versión:** 2.0 (destila BTF + DF + MF; aporta el Exit Engine, original de v2)
**Estado:** DRAFT — en redacción
**Depende de:** todos los anteriores (DOC-00 a DOC-06).
**Alimenta a:** la realidad (ejecución y forward testing); retroalimenta a todos vía P6.
**Absorbe del legacy:** BTF (Backtesting), DF (Deployment), MF (Monitoring), VF
(Validation). **Aporta original:** el Exit Engine (el legacy no tenía salidas —
ver §2). Encarna P1 (el 1% es piso) y P6 (el código manda).

---

## 1. PROPÓSITO

Los seis motores anteriores deciden *qué operar*. Este decide tres cosas que
ninguno cubrió, y que separan un sistema de papel de uno que gana plata:

> **EXIT:** ¿cómo se cosecha una posición abierta? (cuándo y cómo salir)
> **EJECUCIÓN:** ¿cómo se opera de forma estable y reproducible? (el bot real)
> **MEDICIÓN:** ¿cómo sabemos si todo esto realmente funciona? (forward testing)

Es el motor que cierra el lazo: convierte decisiones en operaciones, operaciones en
resultados, y resultados en la evidencia que valida o refuta todo el sistema (P6).

---

## 2. POR QUÉ EL EXIT ENGINE ES APORTE ORIGINAL DE v2

Hallazgo de la destilación del legacy: **el corpus v1 no tiene salidas.** Tenía
DNA, State, Setup, Opportunity, Ranking, Portfolio, Backtesting, Deployment — pero
*nada* sobre cómo cerrar una posición. Ni stops, ni take profit, ni trailing, ni
salidas adaptativas.

Esto revela la naturaleza del legacy: era fuerte en **investigación** (¿existe
alfa? ¿qué activos son mejores?) y ciego en **cosecha** (¿cómo capturo el
movimiento una vez dentro?). Y la cosecha es justamente donde vive tu principio más
personal:

> **P1 — El 1% es piso, no techo.** Las salidas adaptativas deben capturar el
> movimiento disponible completo, no cortar en una meta fija.

El Exit Engine es, por lo tanto, contribución genuina de CODE v2. No destila nada;
construye lo que faltaba.

---

## 3. EXIT ENGINE — la cosecha adaptativa (P1)

### 3.1 El principio: el target fijo tira plata

El DNA midió oportunidad con un target fijo de +1% (DOC-02 §5.1) — pero eso era
*para medir*, una vara de laboratorio. Al **operar**, cortar en +1% cuando la ola
siguió hasta +5% viola P1: dejaste el 80% del movimiento en la mesa.

La salida no es un número fijo; es un **proceso adaptativo** que deja correr
mientras la ola tiene fuerza y corta cuando se agota.

### 3.2 La salida depende del arquetipo (DOC-02)

Acá se cierra otro círculo: el arquetipo no solo elige la entrada (vía Edge), elige
la **forma de salir**. Cada carácter cosecha distinto:

| Arquetipo | Cómo se cosecha | Por qué |
|-----------|-----------------|---------|
| **OSCILADOR** | Salida en la resistencia opuesta del rango | El movimiento tiene tope natural: el otro lado del rango |
| **TENDENCIAL** | Trailing que deja correr; salida por quiebre de estructura | P1 puro: la tendencia puede durar; no cortar temprano |
| **EXPLOSIVO** | Capturar la expansión; salir cuando la volatilidad colapsa | El movimiento es el evento; termina cuando se desinfla |
| **PULSÁTIL** | Cosechar la ola actual; no esperar la próxima | La ola no avisa cuándo vuelve; tomar lo de esta |

> El mismo +3% significa cosas distintas: en un OSCILADOR cerca de resistencia es
> "salí ya"; en un TENDENCIAL con estructura intacta es "seguí". El Exit lee el
> arquetipo (DOC-02) y el estado actual (DOC-03) para decidir.

### 3.3 El stop: protección, no predicción

El stop existe para acotar la pérdida (el −0.5% de la vara, o adaptado por
volatilidad del par vía ATR), nunca para "adivinar" reversiones. Principio de
gestión: **mover el stop solo a favor** (a breakeven cuando la posición avanza,
luego trailing), nunca aflojarlo para "darle aire" a un trade perdedor — eso es el
camino a la ruina.

> **Disciplina de costos (P7):** la salida se evalúa neta de costos. Un trailing
> demasiado ajustado genera salidas y re-entradas que el spread + comisión se
> comen. El Exit optimiza retorno *neto*, no bruto.

### 3.4 Salida por degradación

Más allá del precio, una posición se cierra si **su oportunidad se degrada**
(coordinado con el Rebalancing de DOC-06): si el setup que la justificó se
resolvió, o el estado transicionó adversamente (DOC-03), o el edge de ese setup
perdió Lift, se sale aunque el precio no haya tocado ni target ni stop. La tesis de
entrada dejó de ser válida; no hay razón para seguir dentro.

---

## 4. EJECUCIÓN — operar de forma estable (del DF)

### 4.1 Filosofía (del Deployment Framework)

> Un sistema no genera valor por existir. Genera valor cuando puede ejecutarse de
> forma **estable y consistente.**

Toda ejecución de CODE debe ser (del DF): **reproducible** (mismos inputs → mismos
outputs), **auditable** (toda decisión queda registrada con su porqué), **observable**
(se ve qué está haciendo en vivo), **recuperable** (se repone tras una caída sin
perder estado).

### 4.2 La frontera paper → real

CODE v2 opera primero en **paper trading** (el bot v2 ya lo hace). El paso a capital
real es una decisión de gobernanza, no técnica, y solo ocurre cuando la medición
(§5) muestra edge persistente neto de costos en forward testing. **El backtest no
autoriza capital real; el forward testing sí** (§5.2).

### 4.3 El modelo de costos es parte de la ejecución (P7)

Cada operación descuenta comisión + spread + slippage estimado. El slippage real se
mide contra el esperado y alimenta el modelo de costos — que a su vez retroalimenta
al Edge (DOC-04) y al Exit (§3.3). Un edge que existía en backtest sin costos y
desaparece con costos reales **no era un edge**: era un artefacto.

---

## 5. MEDICIÓN — ¿esto funciona de verdad? (del BTF + MF)

### 5.1 Backtesting: refutar, no confirmar (del BTF)

> **Principio del BTF:** un backtest no demuestra que algo funcionará. Solo
> demuestra que una hipótesis **sobrevivió** a una prueba histórica.

Por eso la filosofía es **popperiana**: todo backtest intenta *refutar* la
hipótesis, no confirmarla. El objetivo es encontrar las debilidades antes de
producción, no acumular evidencia a favor. Modos de backtest (del BTF):

- **Historical Replay** — reproducir el pasado tal cual.
- **Walk Forward** — entrenar → avanzar → evaluar → repetir (simula tiempo real).
- **Rolling Window** — ventanas móviles para ver estabilidad.
- **Cross-Asset** — ¿el edge sobrevive en otros pares?
- **Cross-Regime** — ¿sobrevive en bull / bear / sideways?

Trampas que el backtest debe evitar a toda costa: **look-ahead bias** (usar datos
del futuro), **survivorship bias** (solo pares que existen hoy), **overfitting**
(ajustar a ruido). El backtester de AXIOM (sliding window, ya optimizado) es la base.

### 5.2 Forward testing: el único juez real

El backtest sobre datos pasados es necesario pero **no suficiente** (DOC-00 §4: hay
que sobrevivir fuera de muestra). El juez final es el **forward testing**: el
sistema operando en paper sobre datos que *no existían* cuando se diseñó. Si el
edge persiste hacia adelante, es real; si solo existía hacia atrás, era overfitting.

> Esta es la jerarquía de evidencia de CODE: hipótesis < backtest < out-of-sample <
> **forward testing en vivo**. Cada nivel puede matar lo que el anterior aprobó.

### 5.3 Monitoreo en vivo (del MF) — detectar la muerte del edge

Un edge no es eterno: se arbitra, el mercado cambia, el par muta de carácter. El
monitoreo (del Monitoring Framework) vigila en producción:

- **Opportunity Decay:** rolling Lift / Hit Rate / Profit Factor. Si caen
  sostenidamente, el edge se está muriendo → reducir o retirar (coordina con
  Rebalancing, DOC-06).
- **DNA / State Drift:** si un par cambió de carácter (DOC-02 §6, DOC-03), sus
  estrategias asociadas pueden haber dejado de aplicar.
- **Anomalías de ejecución:** slippage real >> esperado, fills raros, latencia →
  señal de que algo en la frontera con el exchange se rompió.
- **Salud del sistema:** los jobs (APScheduler), la frescura de datos (DOC-01), la
  persistencia (PostgreSQL) — que el músculo siga vivo.

### 5.4 Las métricas que importan (consolidado)

Por **estrategia/edge:** Hit Rate, Lift, Profit Factor, Expectancy, MFE/MAE.
Por **cartera (DOC-06):** PFS / PFQ / PFR, retorno agregado, Sharpe, Sortino, Max
Drawdown. Por **sistema:** retorno diario agregado neto de costos (la vara del 1%),
y —crítico— **cuántas veces el sistema se abstuvo** (DOC-06 §7): abstenerse bien es
tan valioso como acertar.

---

## 6. EL LAZO COMPLETO (cómo se cierra el corpus)

```
DOC-05 Universe → DOC-02 DNA → DOC-03 State → DOC-04 Edge → DOC-06 Portfolio
                                                                     │
                                                          cocktel    ▼
                                                              ┌─ DOC-07 ─┐
                                                              │ EJECUCIÓN│  (bot v2)
                                                              │    ↓     │
                                                              │   EXIT   │  (cosecha P1)
                                                              │    ↓     │
                                                              │ MEDICIÓN │  (forward test)
                                                              └────┬─────┘
                                                                   │
                                          evidencia (P6) ──────────┘
                                                   │
              retroalimenta y refina ▼ (DOC-00 §7: el código obliga al cambio)
        umbrales de DNA · pesos de Edge · límites de Portfolio · tiers de Universe
```

La medición no es el final de una línea: es el **inicio del lazo de mejora**. Cada
resultado de forward testing es la evidencia que P6 exige para refinar cualquier
motor. El corpus no es estático; respira con lo que el código demuestra.

---

## 7. DEUDA CONSCIENTE

1. **Reglas operativas de salida por arquetipo** (§3.2) — la tabla da dirección; el
   trailing concreto, el criterio de "quiebre de estructura", el "colapso de
   volatilidad" necesitan definición y backtest por arquetipo.
2. **Modelo de costos por par/tier** (§4.3) — construir y calibrar contra fills
   reales; es lo que decide qué edges sobreviven.
3. **Umbral de paso paper→real** (§4.2) — cuánto forward testing, qué métricas
   mínimas: decisión de gobernanza pendiente.
4. **Detección de decay** (§5.3) — qué caída de rolling Lift dispara el retiro de un
   edge: a calibrar.
5. **Gestión de capital absoluta** — el % del capital total en riesgo (heredado como
   pendiente de DOC-06 §9.6) se concreta acá, en la ejecución.

---

## 8. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

Este es el motor con ejecución y medición **más maduras** en AXIOM:

- **Bot v2** (Activas / Estadísticas / Backtesting) — ya ejecuta estrategias en
  paper, con stats. Es el sustrato de Ejecución (§4) y donde el Exit Engine (§3) se
  implementa como lógica de cierre por estrategia.
- **Backtester independiente** (fix O(n²)→O(n)) — ya mide sobre 17k+ velas en ~10s.
  Es la infraestructura del BTF (§5.1); soporta walk-forward y rolling window.
- **Stats engine** — la base de la medición (§5.4): Hit Rate, Profit Factor, etc.
- **APScheduler + PostgreSQL** — los jobs y la persistencia que el Monitoring (§5.3)
  vigila, ya en producción para el régimen de mercado.
- **Forward testing** — el paper trading del bot v2 ES el forward testing (§5.2); ya
  corre. Falta formalizar la jerarquía de evidencia y el umbral paper→real.

El DOC-07 no pide construir ejecución de cero: pide ponerle al bot v2 que ya tenés
una **lógica de salida adaptativa por arquetipo** (lo nuevo) y una **disciplina de
medición** que trate el forward testing como el juez final (la formalización).

---

## ESTADO
DRAFT · v2.0 · destila BTF + DF + MF; **aporta el Exit Engine (original de v2)**.
Decisiones tomadas: el Exit es adaptativo y depende del arquetipo (P1); el stop
protege, no predice; backtest refuta (no confirma); forward testing es el único juez
real; la medición cierra el lazo de mejora (P6).
Cierre del corpus: con DOC-07, los 8 documentos (DOC-00 a DOC-07) están redactados.
Próximo: revisión y aprobación de los DRAFT pendientes, y arranque de implementación
guiado por orden de construcción (DNA primero, DOC-00 §6).
