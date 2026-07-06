# FINDINGS-01 — Hallazgos empíricos: el precio de un par en aislamiento

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** FINDINGS-01 (registro de resultados experimentales, no de diseño)
**Versión:** 1.0
**Estado:** REGISTRADO — hallazgos falsables, replicados con datos reales
**Relación con el corpus:** valida empíricamente P6 (el código manda) y justifica el
giro hacia lo relacional/contextual (DOC-03 State, DOC-05 Universe, DOC-06 P3).

---

## 0. PROPÓSITO

Este documento registra lo que la fase de implementación **midió**, no lo que se
diseñó. Son hallazgos negativos en su mayoría — acotan dónde *no* está el edge — y
eso los hace valiosos: son conocimiento ganado con medición honesta, que evita
que el yo-futuro (o cualquier instancia que retome el proyecto) repita el camino.

Regla metodológica que se siguió en todos: cada hipótesis se probó con un
experimento falsable, con **control de honestidad** (típicamente un random walk
sintético que debe dar resultado nulo), rechazando lo que no superó la vara.

**Contexto de los datos:** 9 pares (BTC, ETH, BNB, SOL, LINK, INJ, PEPE, WIF, XRP)
en 3 timeframes (15m, 1h, 4h), ~365 días de historia, exchanges MEXC/CoinEx.
Ventana temporal mayormente lateral-bajista. Costos asumidos ~0.2% ida+vuelta.

---

## 1. LA PREGUNTA CORRECTA (giro conceptual)

Se abandonó la pregunta "¿qué arquetipo *es* este par?" (clasificación de forma)
porque resultó vacía: todo par oscila con amplitud y frecuencia variables, y la
etiqueta no informaba sobre lo aprovechable. La pregunta correcta pasó a ser:

> **¿Cuántos movimientos aprovechables (subida ≥1% neto de costos, solo al alza)
> produce el par, y bajo qué condiciones — anticipables, no en el retrovisor?**

La unidad de análisis dejó de ser el par y pasó a ser el **movimiento aprovechable**
(cadencia, amplitud, duración medidas; punto de entrada NO impuesto).

---

## 2. LOS SEIS EXPERIMENTOS

### E1 — Jugo bruto vs jugo capturable (Opportunity Scanner)
**Qué midió:** el movimiento que *existe* (bruto, timing perfecto) vs el capturable
por entrada ciega con salida fija.
**Resultado:** el jugo bruto es abundante (2–16%/día según par/TF). La entrada ciega
con R:R 1:1 (target=stop=1×ATR) da **sesgo negativo universal**: los 27 casos
(9 pares × 3 TF) con win rate 33–49%, todos < 50%. Control random walk: sesgo ~0
(la medición es honesta).
**Lectura:** el movimiento existe pero entrar sin criterio pierde en todos lados.

### E2 — Ley del ruido por timeframe
**Qué midió:** cómo varía el win rate de la entrada ciega con el timeframe.
**Resultado:** **universal en los 9 pares** — el win rate mejora monótonamente con
el TF (15m ~24–47%, 4h ~52–69% con salida fija +1%; con target escalado el patrón
se mantiene). En TF cortos el stop ceñido se toca por ruido antes que el target.
**Lectura:** operar TF muy cortos con stops ceñidos es estructuralmente adverso.
El 4h es el menos hostil al ruido.

### E3 — Reglas de entrada (Camino 1: aislar la entrada)
**Qué midió:** ¿alguna regla de entrada (retroceso, momentum, sobreventa) supera a
la ciega, con la misma salida fija simétrica?
**Resultado:** **ninguna cruzó 50%** de win rate. Momentum mejora consistentemente
pero sólo +0.3 a +2.1 pp (insuficiente); retroceso y sobreventa empeoran. La señal
de vela simple casi no informa sobre lo que viene.
**Lectura:** la entrada sola, contra salida simétrica, no alcanza.

### E4 — Salida con trailing (Camino 2: dejar correr, P1)
**Qué midió:** ¿la asimetría de dejar correr ganadores (trailing) da profit factor
> 1? Anchos 0.5×/1×/1.5×/2× ATR, entrada ciega y momentum.
**Resultado:** **ningún par dio PF > 1** con ninguna combinación. Mejores: PEPE 0.96,
ETH 0.79, SOL 0.76 (todos con trail 0.5×, el más ceñido). Trailing más ancho = peor
(mercado lateral: las olas no son lo bastante largas). La entrada casi no cambia el
PF (ciega ≈ momentum).
**Lectura:** falta un **filtro de contexto** (cuándo operar), no mejor entrada/salida.

### E5 — Onda de período fijo (autocorrelación)
**Qué midió:** ¿hay una onda periódica dominante (autocorrelación del precio sin
tendencia)? Umbral de fuerza 0.25.
**Resultado:** los 9 pares × 3 TF dieron **"sin onda clara"** (fuerza 0.001–0.16,
control sintético de onda real daba >0.86). **Nota metodológica:** el método asumía
período *fijo*; una onda de período variable (como se hipotetizó) es invisible a la
autocorrelación de lag fijo — el resultado no refuta la onda variable, sólo la fija.

### E6 — Zigzag y diagnóstico de valle (onda variable + derivadas)
**Qué midió:** (a) swings de período variable por zigzag; (b) ¿la velocidad o
aceleración del precio suavizado (SMA-5, causal) anticipan el rebote de un valle?
**Resultado (a):** el zigzag marca "swings hermosos" hasta en el random walk —
porque define el valle con visión perfecta del futuro. No distingue onda de ruido.
**Resultado (b):** con la medición honesta (comparar caídas que rebotan vs caídas
que siguen, mismo grupo de partida, control random walk ~0.04):
- **Aceleración (2ª derivada): Cohen d 0.008–0.124** en todos los pares/TF ≈ ruido.
  **No anticipa el rebote.**
- **Velocidad (1ª derivada): Cohen d hasta ~0.42 en 15m**, decreciendo a ~0.07 en 4h.
  Señal débil (< 0.5), eco de "capitulación rápida rebota" en corto plazo, se
  desvanece en 4h.
**Lectura:** el valle no es parametrizable por las derivadas del propio precio.

---

## 3. LA CONCLUSIÓN CONVERGENTE

Seis experimentos independientes, con código propio y datos reales, apuntan al mismo
lugar:

> **La estructura explotable NO está en la forma del precio de un par mirado en
> aislamiento.** El precio individual se comporta, para predecir su próximo
> movimiento, de forma cercana a un martingala (impredecible en dirección). El jugo
> bruto existe en abundancia, pero capturarlo requiere información **externa** al
> precio del par.

Esto es consistente con un resultado clásico de finanzas cuantitativas (eficiencia
débil sobre el activo individual), aquí **replicado internamente** en vez de asumido.

Lo que se descarta con evidencia:
- Clasificar por forma/arquetipo como base de decisión.
- Reglas de entrada sobre la vela individual (sin contexto).
- Salida con trailing como fuente de edge por sí sola.
- Onda periódica fija.
- Derivadas (velocidad/aceleración) del precio propio como anticipador de valle.

---

## 4. HACIA DÓNDE (justificado, no por intuición)

Por eliminación, el edge —si existe— vive en lo **relacional y contextual**, que es
exactamente lo que el corpus siempre sostuvo y que estos hallazgos ahora justifican
empíricamente:

- **Fuerza relativa** del par vs BTC / vs su sector (DOC-05 Universe).
- **Régimen de mercado** como filtro de cuándo operar (DOC-03 State).
- **Descorrelación del cóctel** — el poder en la agregación de edges pequeños entre
  pares poco correlacionados (DOC-06, P3).
- **Oportunidad relativa** al universo, no señal absoluta (DOC-04 Edge).

Regla para la próxima fase: cada hipótesis relacional se prueba igual que el precio
— un experimento diagnóstico honesto por vez, con su control, rechazando lo que no
supere la vara. No se impone ninguna relación a priori; se mide si aporta.

> **Advertencia registrada:** que el edge no esté en el precio individual NO garantiza
> que esté en lo relacional. Lo relacional es la próxima hipótesis a falsar, no una
> certeza. Puede requerir varios experimentos y algunos también fallarán. Eso es P6.

---

## 5. VALOR DE ESTOS HALLAZGOS

- Se descartó un espacio grande de búsqueda (forma del precio) **sin arriesgar
  capital**, sólo con backtesting honesto.
- Se validó la disciplina de medición: control de honestidad (random walk), evitar
  look-ahead bias (el sesgo del zigzag y el del "velocidad en el valle" se
  detectaron y corrigieron antes de sacar conclusiones).
- Se confirmó, retroactivamente, que la arquitectura del corpus (contextual/
  relacional) apuntaba al lugar correcto.

Los scripts que produjeron estos hallazgos (opportunity_scanner, entry_tester,
trailing_tester, wave_characterizer, swing_characterizer, valley_diagnostic) quedan
como instrumentos reutilizables: cualquier hipótesis futura sobre movimientos
aprovechables puede medirse con las mismas varas honestas.

---

## ESTADO
REGISTRADO · v1.0 · seis experimentos, nueve pares, tres timeframes.
Hallazgo central: el precio de un par en aislamiento no mostró edge explotable;
la aceleración no anticipa rebotes (Cohen d < 0.13); la rentabilidad, si existe,
requiere información externa al par.
Próximo: primer experimento relacional (fuerza relativa / régimen / descorrelación),
con la misma disciplina de medición honesta y control.
