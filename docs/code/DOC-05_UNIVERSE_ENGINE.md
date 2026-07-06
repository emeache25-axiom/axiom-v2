# DOC-05 — UNIVERSE ENGINE: Qué pares merecen atención

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-05 (el motor del nivel lento / contextual)
**Versión:** 2.0 (destila el legacy: Microcap Research, tiers, distribución del universo)
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00, DOC-01 (Data Layer), DOC-02 (DNA).
**Alimenta a:** DOC-02 (DNA), DOC-04 (Edge), DOC-06 (Portfolio).
**Absorbe del legacy:** Microcap Research (QRA-021..024), la lógica de tiers de
capitalización, la distribución del universo del DRF (§8), y la hipótesis H4
(Microcap Alpha). Encarna P5 (análisis por tier).

---

## 1. PROPÓSITO

Todos los motores anteriores trabajan *sobre un par*. El Universe Engine es el
único que trabaja *sobre el conjunto*, y responde la pregunta previa a todo:

> **¿Qué pares, de los cientos disponibles, merecen siquiera ser analizados hoy?**

Es el **portero del sistema**. No evalúa oportunidades (eso es Edge); decide quién
entra a la sala donde se evalúan oportunidades. Un universo mal filtrado envenena
todo lo de abajo: el DNA caracteriza basura, el Edge puntúa ruido, el Portfolio
elige entre malas opciones.

> **Frase del ORF que lo define:** *el Universe Engine decide qué activos merecen
> atención.* Es la primera de las cinco funciones del sistema, y la condición de
> sanidad de las otras cuatro.

---

## 2. EL NIVEL LENTO (la gran decisión de arquitectura de CODE)

Acá está la distinción que estructura todo el sistema (DOC-00 §5): CODE tiene dos
niveles que corren a velocidades distintas.

| | NIVEL LENTO (este motor) | NIVEL RÁPIDO (DNA/State/Edge) |
|---|---|---|
| Pregunta | ¿Quién merece atención? | ¿Hay oportunidad ahora? |
| Frecuencia | Diaria / semanal | Minutos / horas |
| Mira | El conjunto, contexto, capitalización | El par individual |
| Insumo | Coins DB (rank, mcap, flujo) | OHLCV |
| Output | El **universo elegible** (~N pares) | El cocktel del día |

**Por qué dos niveles.** Caracterizar el ADN de 500 pares cada minuto es inviable
(P8, hardware modesto) e innecesario: el carácter de un par no cambia minuto a
minuto. El nivel lento hace el trabajo pesado y contextual una vez al día,
entrega un universo recortado y sano, y el nivel rápido itera barato sobre ese
subconjunto. **El nivel lento filtra; el nivel rápido explota.**

> Esto es exactamente la intuición original del proyecto: una capa contextual
> lenta (fuerza relativa, ranking de market cap, flujo de capital) que alimenta
> una capa rápida (selección del cocktel por señales técnicas).

---

## 3. LA TESIS QUE EL MOTOR EXPLORA (H4 del MPS)

> **H4 — Microcap Alpha:** las microcaps generan oportunidades asimétricas.

El legacy apostó fuerte acá (Microcap Research, QRA-021..024):
- ¿Las microcaps generan **más** oportunidades? (QRA-021)
- ¿Las microcaps **dormidas** generan explosiones? (QRA-022 — cruza con Dormancy)
- ¿La **densidad** de oportunidades es superior abajo en el ranking? (QRA-023)
- ¿Los comportamientos extremos son **sistemáticos** (no azar)? (QRA-024)

Si H4 se confirma, el Universe Engine no debe tratar a todos los tiers igual: debe
*sobre-representar* los tiers donde el alfa es más denso. Pero —y esto es clave—
las microcaps traen el problema opuesto: liquidez frágil, spread ancho, slippage
que se come el edge (P7). El Universe Engine es justo donde se negocia esa tensión:
**más alfa potencial abajo, más costo y riesgo de ejecución abajo.**

---

## 4. LOS TIERS DE CAPITALIZACIÓN (P5)

> **P5 — Análisis por tier.** El par n°5 del ranking no se analiza igual que el
> n°800. Cada tier tiene criterio y ponderación propios.

La taxonomía de partida (del DRF §8, ajustable con datos):

| Tier | Rango (rank por market cap) | Carácter típico | Tensión |
|------|------------------------------|-----------------|---------|
| **LARGE** | Top ~10 (BTC, ETH, BNB, SOL…) | Líquido, tendencial, correlacionado | Poco alfa relativo, mucha seguridad |
| **MID** | ~10–150 | Equilibrio liquidez/movimiento | El "punto dulce" probable |
| **SMALL** | ~150–300 | Más volátil, menos eficiente | Más oportunidad, más ruido |
| **MICRO** | >300, con liquidez mínima operable | Asimétrico, explosivo (H4) | Máximo alfa potencial, máximo costo/riesgo |

**Por qué los tiers importan al filtrar.** Un mismo umbral de volatilidad significa
cosas distintas según el tier: 5% diario es normal en un micro y excepcional en un
large. Los umbrales del DNA (DOC-02) y del Edge (DOC-04) **deben parametrizarse por
tier**, y es el Universe Engine quien etiqueta a cada par con su tier para que los
motores de abajo lo usen.

> **Decisión abierta (a resolver con datos):** ¿el universo elegible se arma con
> cuota fija por tier (p.ej. N large + N mid + N small + N micro) o por mérito puro
> (los mejores N sin importar tier)? La cuota protege diversificación y controla
> riesgo de iliquidez; el mérito maximiza alfa crudo. Probable punto medio: cuota
> con techos de riesgo por tier. Se calibra (P6).

---

## 5. LAS TRES SEÑALES DEL FILTRO (fuerza, salud, flujo)

El Universe Engine evalúa cada par del universo amplio con tres familias de
señales contextuales (DOC-00 §5: "señales de fuerza/salud/flujo"). Todas salen de
datos lentos que AXIOM ya tiene en la Coins DB.

### 5.1 SALUD (gate de viabilidad — primero, es eliminatorio)

¿El par es operable? Filtros duros, netos de costos (P7):
- **Liquidez mínima:** `volume_24h` por encima de un piso por tier. Sin esto, el
  spread y el slippage matan cualquier edge.
- **Market cap mínimo** por tier (evita el polvo sin piso).
- **Datos suficientes:** historia OHLCV mínima para que el DNA sea calculable.
- **No-stablecoin, no-wrapped:** un par anclado a $1 no oscila ni tiende; se excluye
  por naturaleza (la supercategoría de la Coins DB ya lo identifica).

Lo que no pasa el gate de SALUD ni se analiza. Es el filtro INERTE/ILÍQUIDO del
DOC-02, aplicado a nivel de universo.

### 5.2 FUERZA (relativa — quién lidera)

¿El par está fuerte respecto al mercado y a su sector?
- **Fuerza relativa vs BTC** y vs el universo (¿sube más/cae menos?).
- **Momentum de ranking:** ¿el par está *escalando* posiciones de market cap? Subir
  en el ranking es señal de capital entrando (usa el `rank` histórico de la Coins
  DB).
- **Fuerza sectorial:** ¿su supercategoría está en rotación favorable? (la Coins DB
  ya agrega `change_24h`/`change_7d` por supercat).

### 5.3 FLUJO (capital — hacia dónde va el dinero)

¿Hay capital entrando al par o a su sector?
- **Tendencia de volumen:** volumen creciente sostenido (no un pico aislado).
- **Flujo sectorial:** capital rotando hacia su supercategoría.
- **Expansión de market cap** independiente del precio (más unidades de valor, no
  solo revaluación).

> Las tres en orden: **SALUD** decide si puede entrar (gate duro), **FUERZA** y
> **FLUJO** deciden si conviene priorizarlo hoy. Un par sano pero sin fuerza ni
> flujo queda en el banco; uno sano con ambas, al frente de la fila.

---

## 6. EL UNIVERSE SCORE Y EL OUTPUT

Cada par sano recibe un **Universe Score** que combina FUERZA + FLUJO (ponderadas,
pesos a calibrar — P6), parametrizado por tier. El output del motor:

```
Universo amplio (Coins DB, ~500–2000 pares)
   │
   ▼
[1] Gate de SALUD (eliminatorio, neto de costos)      → descarta ilíquidos/stables
   │
   ▼
[2] Etiquetar tier (LARGE/MID/SMALL/MICRO)            → para los motores de abajo
   │
   ▼
[3] Universe Score = f(FUERZA, FLUJO | tier)
   │
   ▼
[4] Seleccionar el universo elegible (cuota/mérito por tier — §4)
   │
   ▼
[5] Emitir lista {par, tier, Universe Score, señales}  → DNA/State/Edge
   │
   ▼
[6] Persistir (universe_snapshot en PostgreSQL, con fecha)
```

El universo elegible es **estable día a día** (no cambia cada minuto): es el
recorte sobre el que el nivel rápido trabaja esa jornada. Se recalcula una vez al
día (o intradía suave si el flujo cambia fuerte).

---

## 7. INTEGRACIÓN CON LOS DEMÁS MOTORES

- **→ DNA (DOC-02):** el Universe Engine entrega el tier de cada par, y el DNA
  parametriza sus umbrales de gen por tier (P5). Solo se calcula ADN de pares que
  pasaron el gate de SALUD — no se malgasta cómputo en basura (P8).
- **→ Edge (DOC-04):** el componente de contexto del Edge Score puede incorporar el
  Universe Score (un par con fuerza/flujo a favor parte con ventaja).
- **→ Portfolio (DOC-06):** el tier informa los límites de exposición — no querés el
  cocktel entero en micros ilíquidos por más alfa que prometan. El Universe Engine
  da la materia prima diversificable.

---

## 8. DEUDA CONSCIENTE

1. **Cortes de tier** — los rangos de §4 (top 10 / 150 / 300) son del legacy y
   provisorios; se calibran viendo dónde cambia de verdad el comportamiento.
2. **Cuota vs mérito** (§4) — decisión de construcción del universo pendiente de
   backtest.
3. **Definición operativa de FUERZA y FLUJO** — §5 da dirección; las fórmulas
   concretas (qué ventana de fuerza relativa, qué umbral de flujo) se fijan y
   validan.
4. **H4 sin confirmar** — que las microcaps tengan más alfa es hipótesis; si el
   backtest muestra que el alfa neto de costos *no* sobrevive abajo, el tier MICRO
   se reduce o se descarta (P6).
5. **Frecuencia de recálculo** — diaria como base; pendiente ver si el flujo exige
   refresco intradía.
6. **Universe Score sin State** — el nivel lento deliberadamente *no* mira estado
   técnico de corto plazo (eso es el nivel rápido). Si se demuestra que un poco de
   estado mejora el filtro, se evalúa — pero el default es mantener los niveles
   separados.

---

## 9. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

Este motor es el que **más infraestructura tiene ya lista**, porque el módulo
Mercado de AXIOM es prácticamente su esqueleto:

- **Coins DB** (tabla `coins`, ~1750 coins) — ya tiene `rank`, `market_cap`,
  `volume_24h`, `change_24h`, `change_7d`, `supercat`, con sync horario desde
  PostgreSQL. Es **exactamente** el insumo del nivel lento. FUERZA y FLUJO se
  calculan sobre estos campos.
- **Supercategorías** (18-category taxonomy) — ya resuelven la fuerza/flujo
  sectorial (§5.2, §5.3): `/api/market/categories` ya agrega mcap y cambio por
  supercat.
- **Momentum de ranking** — requiere guardar `rank` histórico; hoy la Coins DB
  guarda el rank actual. Pequeña extensión: una tabla `rank_history` para detectar
  quién escala (insumo de FUERZA, §5.2).
- **Screener** (`selection_service.py`) — opera dentro de un universo; el Universe
  Engine es quien *define* ese universo aguas arriba.

El Universe Engine no se construye de cero: es la lógica de mercado/Coins DB que
AXIOM ya corre, formalizada como gate de SALUD + scoring de FUERZA/FLUJO por tier.
Por eso el DOC-00 lo ubica como construible *después* del DNA: no por difícil, sino
porque el nivel rápido (DNA) es el corazón a validar primero, y el Universe afina
el qué-entra una vez que el cómo-se-caracteriza funciona.

---

## ESTADO
DRAFT · v2.0 · destila Microcap Research + tiers + distribución del universo.
Decisiones tomadas: nivel lento separado del rápido; gate de SALUD eliminatorio +
scoring FUERZA/FLUJO; 4 tiers (P5) con umbrales propios; H4 como hipótesis a
confirmar (microcaps no se asumen, se prueban).
Próximo: revisión y aprobación → DOC-06 (Portfolio Engine), que toma los edges
puntuados (DOC-04) dentro del universo elegible y construye el cocktel con
descorrelación (DNA Distance) y asignación de capital.
