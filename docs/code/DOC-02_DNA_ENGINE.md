# DOC-02 — DNA ENGINE: El carácter de un par

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-02 (primer motor del nivel rápido)
**Versión:** 2.1 (destila el legacy: DRF + DES)
**Estado:** DRAFT — en redacción
**Depende de:** DOC-00 (Master), DOC-01 (Data Layer).
**Alimenta a:** DOC-03 (State), DOC-04 (Edge), DOC-05 (Universe), DOC-06 (Portfolio).
**Absorbe del legacy:** DRF (DNA Research Framework), DES (DNA Engine Spec),
y las hipótesis H1/H2/H3 del MPS.

---

## 1. PROPÓSITO

El DNA Engine responde una sola pregunta por cada par del universo:

> **¿Quién es este activo? ¿Cómo se gana plata con él?**

No "¿va a subir?" — CODE no predice dirección (DOC-00). La pregunta es de
identidad estructural: *qué tipo de movimiento produce este par de forma
persistente, qué tan buen generador de oportunidades ha sido, y por lo tanto qué
herramienta lo explota.*

El ADN es **estable**: describe la naturaleza de un par a lo largo de meses, no su
estado de hoy (eso es el State Engine, DOC-03). Un par OSCILADOR sigue siendo
OSCILADOR aunque hoy esté quieto; lo que cambia es su *estado*, no su *carácter*.

> **Principio rector (heredado del DRF/DES):** antes de analizar qué está
> ocurriendo, el sistema debe comprender con quién está interactuando. *La misma
> señal no significa lo mismo en activos con ADN diferente.* Una compresión en un
> par EXPLOSIVO es oportunidad inminente; en un ERRÁTICO es irrelevante.

El DNA Engine es el **primer motor a construir** (DOC-00 §6: solo necesita OHLCV).

---

## 2. LA TESIS QUE EL MOTOR DEBE PROBAR (del DRF)

El DNA Engine no se da por válido por elegante. Existe para probar o refutar una
hipótesis falsable:

- **H1 — Opportunity DNA:** existen criptos con capacidad *estructuralmente
  superior y persistente* de alcanzar un objetivo de beneficio antes que uno de
  pérdida.
- **H0 (nula):** las diferencias entre activos son azar y desaparecen fuera de
  muestra. Formalmente, `P(Target | A) = P(Target | B)`.

El sistema **debe refutar H0** para tener derecho a existir. Si no hay diferencia
real y persistente entre activos, el DNA Engine no aporta y se reduce a filtro
secundario (ver §9, escenarios). Esto es P6 (el código manda) aplicado al corazón
del sistema.

---

## 3. LAS DOS CAPAS DEL ADN

El ADN de un par tiene dos capas complementarias. Ninguna sirve sola:

**Capa A — ESTRUCTURAL (¿qué forma tiene?).** El vector de genes de movimiento +
el arquetipo. Responde *qué herramienta usar*. Es la "personalidad" del par.

**Capa B — DE OPORTUNIDAD (¿cuánto sirve?).** Las métricas de oportunidad medidas
empíricamente (hit rate, densidad, calidad) + el DNA Score. Responde *si vale la
pena y cuánto pesa en el cocktel*. Es el **juez**.

> **Por qué las dos.** Un par puede ser claramente OSCILADOR (capa A: forma
> linda) pero con bajo Opportunity Hit Rate neto de costos (capa B: no entrega).
> En ese caso **no entra al cocktel**, por prolija que sea su forma. La forma es
> la herramienta; el resultado es el juez. El legacy definía el ADN solo por
> resultado (capa B); nuestro v2.0 lo definía solo por forma (capa A). v2.1 los
> une: la forma elige la herramienta, el resultado decide si se usa.

---

## 4. CAPA A — GENES ESTRUCTURALES Y ARQUETIPO

### 4.1 El vector de genes (continuo) + el arquetipo (etiqueta)

La capa estructural es continua: un par no "es o no es" oscilador, sino que oscila
*en cierto grado*. El **vector de genes** son los scores numéricos; el
**arquetipo** es solo la etiqueta del gen dominante, para comunicación humana. El
Edge Engine (DOC-04) consume el vector, no la etiqueta.

Todos los genes se computan sobre **OHLCV diario** (`ohlcv_daily`, ya persistido —
DOC-01), ventana larga (120–180 días) para capturar carácter, no ruido reciente.

### 4.2 Los genes

**Gen OSCILACIÓN** — reversión a la media. Proxy: autocorrelación negativa de
retornos de lag corto; fracción del tiempo dentro de banda estable. Alto →
OSCILADOR.

**Gen TENDENCIA** — persistencia direccional. Proxy: autocorrelación positiva;
`hurst > 0.5`; eficiencia direccional (movimiento neto / suma de absolutos). Alto
→ TENDENCIAL.

**Gen COMPRESIÓN** — volatilidad agrupada con carga *visible*. Proxy: clustering
de volatilidad (autocorrelación de la volatilidad), alternancia squeeze→expansión.
Alto → EXPLOSIVO.

**Gen RECURRENCIA** — consistencia de oportunidad *(gen de primera clase)*. Proxy:
fracción de días cuyo rango supera un umbral neto de costos. Captura la intuición
del oleaje: *las olas son impredecibles en forma y timing, pero confiables en que
llegan*. Alto + COMPRESIÓN baja → PULSÁTIL.

**Gen WICK** — información en los mechazos *(hipótesis H3 del MPS)*. Proxy:
`body_wick_ratio` (ya medido en el prototipo). Mechazos largos recurrentes señalan
barridos de liquidez (sweep) y rechazos; informan sobre manipulación y zonas de
reacción. No define arquetipo por sí solo, pero modula el carácter.

**Gen VITALIDAD** — liquidez y movimiento mínimo *(gen de viabilidad)*. Proxy:
volumen medio, spread estimado, ATR% medio. Por debajo del mínimo → INERTE/ILÍQUIDO
(no se analiza).

### 4.3 Los arquetipos (5 + 1 descarte)

Reconciliación con los perfiles del legacy (DES §16) entre paréntesis:

**OSCILADOR** *(legacy: Mean Reversion)*. Rebota en rango estable. La oscilación
estructurada que P2 llama "oro". Herramienta: range trading. El más valioso para
el cocktel por su independencia de la dirección del mercado.

**TENDENCIAL** *(legacy: Trending)*. Persiste en una dirección con pullbacks que no
rompen estructura. Herramienta: seguimiento de tendencia, salida que deja correr
(P1: el 1% es piso).

**EXPLOSIVO** *(legacy: Explosive + Dormant)*. Comprimido la mayor parte del
tiempo, libera en movimientos bruscos, **con compresión visible antes** (resorte
que se carga, anticipable). Herramienta: ruptura tras squeeze.

**PULSÁTIL** *(sin equivalente directo en legacy — aporte de v2)*. Volatilidad
alta, olas impredecibles en forma y timing, pero **recurrencia alta** y **sin
aviso de compresión**. Herramienta: estar posicionado para capturar la ola cuando
aparece, no predecirla. *El mar siempre tiene olas; te parás en la orilla.*

**ERRÁTICO** *(legacy: Chaotic)* — descarte por caos. Se mueve sin estructura en
ninguna dimensión: ni rango, ni tendencia, ni carga, ni recurrencia confiable.
Fuera del cocktel.

**INERTE / ILÍQUIDO** — descarte por inviabilidad (no caos: falta de vida).
VITALIDAD baja. Fuera del cocktel.

> **EXPLOSIVO vs PULSÁTIL** (distinción fina, importa para la herramienta): el
> EXPLOSIVO comprime antes de soltar (anticipable por el estrechamiento); el
> PULSÁTIL no avisa (la energía es basal). Uno esperás el resorte cargándose; el
> otro sabés que el mar siempre tiene olas.

> **Nota sobre Hybrid (legacy DNA-P06):** el legacy admitía un perfil "Híbrido".
> En v2 no es un arquetipo: es lo que el *vector de genes* expresa naturalmente
> (un par puede ser "OSCILADOR con algo de recurrencia"). El arquetipo es solo la
> etiqueta dominante; la hibridez vive en el vector.

---

## 5. CAPA B — OPPORTUNITY DNA (del DRF, el juez empírico)

Esta capa mide, sobre el histórico, **cuánta y qué calidad de oportunidad** ha
dado realmente cada par. Es lo que valida (o no) que su arquetipo "sirve".

### 5.1 Definición operativa de oportunidad (triple-barrier)

Acá hay que separar dos cosas que el legacy mezclaba, porque P1 ("el 1% es piso,
no techo") las distingue:

**(a) El umbral de MEDICIÓN del ADN — fijo.** Para *caracterizar* y *comparar*
pares entre sí necesitamos una vara común e idéntica para todos. Esa vara es el
triple-barrier del DRF: una oportunidad cuenta como hit cuando el precio alcanza
**+1.0%** antes que **−0.5%**.

```
Entry  = close(t)
Target_medición = Entry × 1.01      (+1.0%)   ← solo para medir el ADN
Stop            = Entry × 0.995     (−0.5%)
```

Este +1% **no es la meta de ganancia**: es el listón estandarizado que permite
decir "el par A da hits más seguido y más rápido que el par B". Es una unidad de
medida, como un metro. Reward/risk de medición = 2:1.

**(b) La CAPTURA operativa — adaptativa (P1).** Cuando CODE *opera* de verdad, el
+1% es **piso, no techo**. Alcanzar +1% confirma que la oportunidad era real;
qué tanto de la ola se cosecha por encima de ese piso es problema del Exit Engine
(DOC-07), con salidas adaptativas que dejan correr el movimiento. El DNA mide con
vara fija; la ejecución cosecha sin techo.

> **Por qué la distinción importa.** Si midiéramos el ADN con un target adaptativo,
> ningún par sería comparable con otro (cada uno con su propia meta). Y si
> operáramos con el target fijo de +1%, tiraríamos a la basura el 80% de una ola
> que siguió hasta +5% (violando P1). La vara fija es para el laboratorio; el
> techo abierto es para la cancha. **MFE** (máxima excursión favorable, §5.2) es
> justamente la métrica que captura cuánto *más allá* del +1% suele llegar un par
> — y es la que le dice al Exit Engine cuánto vale la pena dejar correr.

**Horizontes de label** (sobre base 15m): 1H (4 velas), 4H (16), 12H (48), 24H
(96). Cada horizonte produce su propia etiqueta hit/fail/unknown.

### 5.2 Variables por activo

Observations, Hits, Failures, Unknown (ambiguos), Hit Rate = Hits/(Hits+Failures),
Time-To-Target, Time-To-Failure, **MFE** (máxima excursión favorable), **MAE**
(máxima excursión adversa).

### 5.3 Métricas de oportunidad

| Métrica | Definición | Rol |
|---------|-----------|-----|
| **Opportunity Hit Rate** | Hits / (Hits + Failures) | Métrica principal |
| **Opportunity Density** | Hits por día | **= gen RECURRENCIA medido por resultado** |
| **Opportunity Velocity** | Velocidad promedio de resolución | Capital rota más rápido |
| **Opportunity Quality** | Hit Rate × Density | Combina acierto y frecuencia |
| **Opportunity Efficiency** | Reward / Risk realizado | Calidad neta del movimiento |

> Density y RECURRENCIA miden lo mismo desde dos lados: RECURRENCIA es estructural
> (¿el par tiende a dar rango?), Density es empírica (¿cuántos +1% antes de −0.5%
> dio de verdad?). Deben converger; si no convergen, hay un bug o un edge.

### 5.4 DNA Score (0–100)

Ponderación inicial (hipótesis, se calibra): Hit Rate 30% · Opportunity Density
20% · Time-To-Target 15% · Failure Rate 15% · Consistencia temporal 10% · MFE/MAE
10%. Representa la **calidad y claridad del ADN de oportunidad** de un par.

**Todos los costos se descuentan antes de calcular cualquier métrica (P7).** Un
+1% que no supera comisión + spread + slippage no es hit, es ilusión.

---

## 6. SIGNATURES Y CONCEPTOS OPERATIVOS (del DES)

El legacy descompone el ADN en **signatures** (firmas), útiles como organización
de los genes. Se adoptan como agrupación conceptual:

- **Volatility Signature** — nivel típico de vol, frecuencia de expansión/compresión.
- **Liquidity Signature** — liquidez, profundidad, fragilidad → gen VITALIDAD.
- **Opportunity Signature** — densidad/calidad/persistencia histórica → capa B.
- **Expansion Signature** — frecuencia y magnitud de movimientos explosivos.
- **Dormancy Signature** — períodos de inactividad y probabilidad de activación →
  conecta con "Dormancy Breakouts", uno de los 5 dominios de alfa.
- **Sweep Signature** — barridos de liquidez, intensidad, recuperación → gen WICK.
- **Behavioral Signature** — cómo se comporta frente a distintos entornos.

Cuatro conceptos operativos del DES que v2 adopta porque son directamente útiles:

**DNA Persistence** — cuánto tiempo permanece estable el ADN (alta/media/baja). Un
ADN persistente es confiable; uno volátil exige recálculo frecuente.

**DNA Drift** — cambio estructural del activo (minor / moderate / major). Un major
drift es señal de que el par cambió de carácter y su arquetipo debe revisarse.

**DNA Distance** — medida de similitud entre dos pares (BTC↔ETH, PEPE↔WIF). **Es
oro para el Portfolio Engine (DOC-06):** pares con ADN distante diversifican; con
ADN cercano, no. Insumo directo de P3 (descorrelación del cocktel).

**DNA Clustering** — agrupar pares de ADN similar (K-Means / jerárquico / DBSCAN).
Permite tratar familias de pares con la misma herramienta y evitar concentración.

---

## 7. CÓMO SE ASIGNA EL ADN (flujo completo)

```
ohlcv_daily (120–180 días)
   │
   ▼
[1] Capa A: vector de genes estructurales
     OSCILACIÓN · TENDENCIA · COMPRESIÓN · RECURRENCIA · WICK · VITALIDAD
   │
   ▼
[2] Capa B: Opportunity DNA (triple-barrier +1%/−0.5%, neto de costos)
     Hit Rate · Density · Velocity · Quality · Efficiency · MFE/MAE → DNA Score
   │
   ▼
[3] Filtro de viabilidad
     VITALIDAD baja  →  INERTE/ILÍQUIDO   (stop)
     DNA Score muy bajo → no operable aunque tenga forma   (stop)
   │
   ▼
[4] ¿Algún gen de carácter sobre su umbral?
     NO  →  ERRÁTICO
     SÍ  →  arquetipo = etiqueta del gen dominante
   │
   ▼
[5] Persistence + Drift + Distance + Cluster
   │
   ▼
[6] Guardar: vector + arquetipo + DNA Score + signatures + fecha
     (dna.parquet / dna_profiles / dna_history, o tablas PostgreSQL)
```

El vector y el DNA Score **se guardan siempre**, incluso para descartes: un
ERRÁTICO de hoy puede revelar recurrencia mañana con más datos (P2).

---

## 8. RE-CÁLCULO, PERSISTENCIA Y EVOLUCIÓN

- **Frecuencia oficial:** semanal (del DES). El carácter no cambia día a día.
- **Drift:** un cambio de arquetipo solo se confirma si persiste varias mediciones
  (histéresis), para no oscilar de etiqueta por ruido de borde. Un major drift se
  registra como evento.
- **Evolución:** un par puede migrar de tier (microcap → midcap → largecap) y con
  ello cambiar su ADN. El motor debe capturar esa evolución, no congelarla.
- **Historial:** cada cálculo se archiva con fecha. La evolución del ADN es, en sí,
  un dato (insumo del State y de la auditoría).

---

## 9. VALIDACIÓN Y ESCENARIOS (rigor del DRF + DOC-00 §4)

**Tests que el ADN debe pasar** (del DRF):
- **Dispersión:** ¿hay heterogeneidad real entre activos? (percentiles 10/25/50/75/90).
- **Persistencia:** rolling Hit Rate / DNA Score / Density en 30/90/180/365 días.
- **Estabilidad:** menor `Std(DNA Score)` → mayor valoración.
- **Significancia:** difference-of-proportions, bootstrap, permutation, chi-square.
- **Cortes:** por capitalización (P5), por sesión (Asia/EU/US), por día, por régimen.

**Tres escenarios posibles** (del DRF §23), que definen el peso del motor:
- **A — No existe ADN:** el comportamiento es ruido. → DNA pasa a filtro secundario.
- **B — ADN moderado:** aporta valor pero no explica todo. → DNA como filtro fuerte.
- **C — ADN fuerte:** la selección de activos es fuente primaria de alfa. → DNA
  Engine es componente central del sistema.

El escenario real lo decide el backtest, no el diseño. Hasta entonces, todo el
motor es hipótesis (P6).

---

## 10. DEUDA CONSCIENTE

1. **Fórmula final de cada proxy de gen** — las §4 dan dirección, no fórmula
   congelada. Se fija en `dna_engine_v01.py` y se valida.
2. **Umbrales numéricos** — todos provisorios (incluido el +1%/−0.5%).
3. **Análisis por tier (P5)** — los umbrales probablemente dependan del tier;
   cruce con Universe (DOC-05) pendiente del pipeline de market cap.
4. **Validación EXPLOSIVO vs PULSÁTIL** — teórica hasta que el backtest muestre
   edges separables; si no se separan, se fusionan.
5. **DNA Distance / Clustering** — definidos conceptualmente; implementación y
   métrica de distancia concreta pendientes (insumo de DOC-06).
6. **Multi-timeframe** — v2 computa carácter sobre diario (decisión DOC-01); 4h/1h
   se evalúa solo si el código lo justifica.

---

## 11. RELACIÓN CON LO YA CONSTRUIDO EN AXIOM

- `dna_engine_v01.py` — **prototipo corriendo**. Ya calcula varios genes:
  `atr_pct_d`, `daily_range_pct`, `move_freq_1/2/3pct` (≈ Opportunity Density),
  `vol_realized_7/30/90`, `vol_persistence` (≈ H2 Clustering), `autocorr_returns`,
  `hurst`, `body_wick_ratio` (≈ H3 Wick / gen WICK), `swing_cleanliness`,
  `oscillation_score`, `btc_correlation`, `independence_score`, `avg_volume_usd`,
  `cost_to_move_ratio`. Es el esqueleto de las capas A y B.
- `feature_engine.py` — EMA, RSI, ATR/ATR%, VWAP, vol_ratio, pivotes S/R: las
  primitivas sobre las que se montan los genes.
- `ohlcv_daily` + `ohlcv_sync.py` — la historia diaria persistida (DOC-01).
- `selection_service.py` — su scoring de volatilidad estructural es antecedente
  directo del gen RECURRENCIA / Opportunity Density; reconciliar al implementar.

> **Pendiente de reconciliación con el prototipo:** el `dna_engine_v01.py` usa hoy
> un set de 6 arquetipos (Oscilador, Tendencial, Resorte, Satélite_BTC,
> Independiente, Salvaje) que mezcla *forma de movimiento* con *correlación a
> BTC*. Este DOC-02 separa esos dos ejes: la forma va al arquetipo (5+1); la
> correlación a BTC (`btc_correlation`/`independence_score`) sale del arquetipo y
> se vuelve **gen para el Portfolio Engine** (DOC-06, P3). Y "Salvaje" se parte en
> PULSÁTIL (recurrente, oro) vs ERRÁTICO (caos, descarte). Próximo paso de código:
> ajustar `classify()` a este modelo de dos ejes.

---

## ESTADO
DRAFT · v2.1 · destila DRF + DES del legacy.
Decisiones acordadas: dos capas (estructural + oportunidad); 5 arquetipos + 1
descarte; RECURRENCIA y WICK como genes; triple-barrier +1%/−0.5%; eje BTC →
DOC-06. Reemplaza al DOC-02 v2.0 (respaldado).
Próximo: revisión y aprobación → DOC-03 (State Engine), que absorbe SES + H5
(State Transitions).
