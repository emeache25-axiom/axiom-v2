# FINDINGS-02 — Hallazgos empíricos: contexto, régimen y naturaleza variable

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** FINDINGS-02 (registro de resultados experimentales, fase 2)
**Versión:** 1.0
**Estado:** REGISTRADO — hallazgos falsables, validados out-of-sample
**Continúa:** FINDINGS-01 (que concluyó que el precio de un par en aislamiento no
mostró edge explotable). Esta fase exploró lo relacional, el régimen y la idea del
par como sistema que evoluciona.

---

## 0. PROPÓSITO Y CONTINUIDAD

FINDINGS-01 cerró con que el precio de un par solo es cercano a impredecible en
dirección. Esta fase 2 persiguió las alternativas que ese resultado sugería: el
contexto (régimen), lo relacional, y —lo más profundo— la idea de que la naturaleza
del par es **variable en el tiempo** y quizás describible como un sistema que
evoluciona con memoria.

Se mantuvo la disciplina de FINDINGS-01, y se **endureció**: además del control de
random walk, esta fase exigió **validación out-of-sample** (train/test) en todo
hallazgo candidato, tras aprender (E8) que separaciones vistas sobre la serie
completa se derrumban en datos nuevos.

Mismos datos: 9 pares (BTC, ETH, BNB, SOL, LINK, INJ, PEPE, WIF, XRP), 15m/1h/4h,
~365d (menos en intradía por límite de velas), MEXC/CoinEx, costos ~0.2%.

---

## 1. EL RECHAZO A IMPONER RELACIONES

Se descartó de entrada imponer relaciones externas a priori (fuerza vs BTC,
rotación sectorial, cointegración) por una objeción de fondo (de Migue): un par
hace movimientos aprovechables *sin* cumplir ninguna de esas relaciones, y cada
relación es **intermitente** — se cumple hasta que deja de cumplirse, y suele
romperse justo cuando importa. Además, operar pares/BTC vuelve circular la fuerza
vs BTC. Conclusión: no imponer; **descubrir de la data de cada par** las condiciones
de sus valles/picos. Caracterización del mercado que guió la fase: *"caos ordenado"*.

---

## 2. LOS EXPERIMENTOS DE LA FASE 2

### E7 — Diagnóstico de valle por derivadas (velocidad/aceleración)
**Hipótesis (Migue):** el valle llega cuando la aceleración del precio suavizado
(la desaceleración de la caída) tiene una firma característica; el intervalo entre
valles varía pero podría parametrizarse.
**Método honesto:** comparar caídas que rebotan vs caídas que siguen (mismo grupo
de partida — evita el sesgo de "velocidad negativa en el valle" que es tautológico).
Control random walk ~0.04.
**Resultado:** aceleración Cohen d 0.008–0.124 (≈ ruido) en todos los pares/TF. La
velocidad da hasta ~0.42 en 15m, decayendo a ~0.07 en 4h (eco débil de capitulación
de corto plazo). **La derivada del precio propio no anticipa el rebote.**

### E8 — Diagnóstico multivariable (6 señales combinadas)
**Hipótesis:** si ninguna señal sola anticipa, ¿una combinación sí? Señales:
velocidad, aceleración, volumen relativo (al propio par — corrección de Migue para
no engañarse con microcaps), profundidad de la caída, duración, mecha inferior.
**Método:** score lineal, train/test 50/50, control random walk.
**Resultado clave (lección metodológica):** la profundidad brillaba (Cohen d hasta
0.65) pero **más en test que en train** — señal de que la relación cambia con el
período, no de edge estable. El score combinado casi nunca superó a la mejor señal
sola out-of-sample. **No hay característica multivariable estable**, pero emergió que
la **profundidad** de la caída tiene algún poder — condicionado al período/régimen.

### E9 — Valle condicionado a régimen
**Hipótesis:** la profundidad predice el rebote *a veces*; ese "a veces" es el
régimen de mercado. Regímenes probados: par vs SMA50, BTC vs SMA50 (ambos causales).
**Resultado sorprendente:** la profundidad discrimina el rebote en régimen
**BAJISTA**, no alcista (contrario al folclore "compra dips en bull"). Cohen d hasta
0.58–0.64 en régimen bajista vs ~0.1 en alcista, en 15m/1h; desaparece en 4h. La
tasa de rebote casi no cambia entre regímenes — el régimen afina el *orden* de la
señal, no la probabilidad base. Interpretación: en mercado bajista, una caída
extra-profunda es sobre-extensión que rebota (reversión a la media).

### E10 — Validación out-of-sample del hallazgo de régimen
**Método:** umbral de profundidad fijado en train; medido en test; regla operable
("comprar caídas con profundidad ≥ umbral en régimen bajista"). Control random walk
dio lift +4.5pp y d 0.37 **por azar** — piso de ruido que hay que superar.
**Resultado:** la señal **sobrevive out-of-sample pero es débil**. Lift en test
+8 a +12pp en los casos de muestra grande (INJ 15m, PEPE 15m), +15 a +19pp en casos
de muestra chica (SOL 1h n=63, LINK 1h n=71 — poco confiables). Real, consistente en
dirección, por encima del ruido — pero tenue.

### E11 — Prueba del dinero del régimen (filtro + trailing)
**Método:** filtro "caída profunda + régimen bajista" + salida trailing (P1),
profit factor out-of-sample, comparado con/sin filtro.
**Resultado:** **el filtro mejora el PF levemente pero NO cruza 1.** Casos de muestra
confiable: PF 0.81–0.89 con filtro vs 0.76–0.82 sin filtro (↑ consistente pero
sub-rentable). **El edge de win rate no se traduce en dinero:** los rebotes que el
filtro acierta son demasiado chicos para pagar las pérdidas. Real pero insuficiente.

### E12 — Persistencia de la naturaleza (el par como sistema que evoluciona)
**Reformulación (Migue):** el par no tiene naturaleza fija ni muta al azar; **es un
sistema que evoluciona**. ¿Sus propiedades persisten de una ventana a la siguiente?
**Método:** propiedades por ventana móvil (volatilidad, eficiencia, amplitud de
swing, nº de swings); autocorrelación lag-1 entre ventanas. Control random walk
(forma) ~0.05; serie con modos ~0.5.
**Resultado — el más robusto de todo el proyecto:** en **4h, las propiedades de
FORMA persisten en los 9 pares**: amplitud de swing y nº de swings 0.44–0.58,
eficiencia 0.31–0.42, volatilidad 0.58–0.64. Muy por encima del ruido (0.05),
consistente y universal. **La naturaleza del par evoluciona con memoria** — la
intuición de Migue se confirma. (En 15m/1h la persistencia es más débil, 0.15–0.35.)

### E13 — Prueba del dinero de la persistencia (target = amplitud persistente)
**Método:** operar caídas en modo oscilante con target = amplitud de swing reciente
(la que persiste), stop 1×ATR, out-of-sample, vs control de target fijo.
**Resultado:** **no cruzó PF 1**, ni siquiera en oscilador sintético limpio. El
target adaptativo supera al fijo (va en la dirección correcta) pero ambos pierden.
Diagnóstico: la amplitud medida por zigzag capturaba micro-giros (~2%), no el swing
real (~6%); y salvar la estrategia requería ajustar múltiples parámetros
(entrada cerca del valle, balance stop/target, medición de amplitud) — camino al
**sobreajuste**. Se detuvo la iteración por disciplina anti-sobreajuste.

---

## 3. LA CONCLUSIÓN DE LA FASE 2

> **Hay estructura estadística real en el mercado, pero es demasiado tenue para un
> edge de timing rentable neto de costos con estas herramientas.**

Lo que SÍ se confirmó (estructura real, validada):
- La **profundidad** de la caída en **régimen bajista** sesga el rebote (E9/E10) —
  real out-of-sample, pero sub-rentable (E11).
- Las **propiedades de forma persisten** en 4h en los 9 pares (E12) — el hallazgo
  más robusto: el par evoluciona con memoria. Pero persistir ≠ ser operable
  rentablemente (E13).

Lo que NO se logró:
- Convertir ninguna de esas estructuras en profit factor > 1 out-of-sample neto de
  costos. El edge existe estadísticamente pero no supera la línea de flotación de
  costos + pérdidas.

**Distinción clave aprendida:** *persistencia de una propiedad* (sé el tamaño del
swing de mañana) **no es** *edge de timing* (sé cuándo y dónde entrar). Conocer la
amplitud no dice cuándo comprar; el timing de entrada —lo que 7 experimentos
mostraron inalcanzable— sigue siendo el eslabón faltante.

---

## 4. LECCIONES METODOLÓGICAS (transferibles)

1. **Out-of-sample obligatorio.** E8 mostró señales que brillaban in-sample y se
   derrumbaban en test. Sin train/test, todo hallazgo es sospechoso.
2. **El random walk da el piso de ruido cuantitativo.** E10: el azar produce lift
   +4.5pp y Cohen d 0.37 al partir muestras. Cualquier "señal" debe superar
   *claramente* ese piso, no apenas ser positiva.
3. **Sesgos de retrovisor recurrentes**, detectados y corregidos: zigzag con visión
   perfecta (todo tiene swings), "velocidad en el valle" (tautológica), volumen
   absoluto en microcaps (corregido a relativo).
4. **La trampa del sobreajuste por perillas** (E13): si salvar una hipótesis exige
   ajustar múltiples parámetros hasta en datos sintéticos perfectos, el edge no es
   robusto. Detenerse es disciplina, no derrota.
5. **Persistir ≠ predecir ≠ ser rentable.** Tres cosas distintas; una propiedad puede
   cumplir la primera sin las otras dos.

---

## 5. IMPLICANCIA PARA EL RUMBO

Dos fases, ~13 experimentos, misma respuesta acumulada: **el edge predictivo propio
de timing no apareció por la vía del precio, ni del contexto/régimen, ni de la
dinámica de la naturaleza del par — al menos no lo bastante fuerte para ser rentable
neto de costos con estas herramientas.**

Esto reorienta el valor de AXIOM: probablemente esté más en el **sistema** (el
cockpit que corre, la caracterización honesta de pares, la disciplina de medición,
el corpus, los instrumentos de backtesting sin autoengaño) que en un edge predictivo
mágico. Muchos sistemas valiosos no predicen: informan, gestionan riesgo, imponen
disciplina. AXIOM ya es eso.

La veta más viva, si se retoma la investigación: la **persistencia de forma** (E12)
es estructura real y robusta. No rindió como estrategia de timing (E13), pero podría
tener valor **descriptivo/informativo** (decirle al operador en qué modo está el par
y que ese modo tiende a durar) aunque no como señal de entrada automática. Eso es
cockpit, no predicción.

---

## 6. INSTRUMENTOS PRODUCIDOS (reutilizables)

Todos con control de honestidad incorporado, listos para cualquier hipótesis futura:
`opportunity_scanner`, `entry_tester`, `trailing_tester`, `wave_characterizer`,
`swing_characterizer`, `valley_diagnostic`, `mv_valley_diagnostic`,
`regime_valley`, `regime_oos`, `regime_money`, `regime_persistence`,
`adaptive_amplitude`. Miden jugo, entradas, salidas, ondas, regímenes, persistencia
y rentabilidad — siempre out-of-sample y con random walk de control.

---

## ESTADO
REGISTRADO · v1.0 · fase relacional/dinámica, ~7 experimentos (E7–E13).
Hallazgo central: hay estructura real (profundidad en régimen bajista; persistencia
de forma en 4h) pero ninguna cruzó profit factor > 1 out-of-sample neto de costos.
Persistir no es predecir el timing. El valor de AXIOM se reorienta del edge
predictivo hacia el sistema. La persistencia de forma queda como veta viva, con
valor probablemente descriptivo más que predictivo.
