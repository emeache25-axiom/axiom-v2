# AXIOM — Principios fundacionales

Este documento gobierna a todos los demás. No describe *cómo* se construye AXIOM,
sino *qué debe ser* y *cómo debe comunicar lo que sabe*. Toda decisión de
arquitectura, cada capacidad, cada respuesta de Kepler, se mide contra esto.

Nace de una constatación de Migue tras semanas de trabajo: *"aunque yo o el que
sea pensemos tal o cual cosa, AXIOM nos pueda decir «esto es lo real»."*

---

## 0. Qué es AXIOM

> **Un sistema de análisis riguroso de mercados cripto, basado en datos reales y
> método verificable. Analiza; no aconseja. Muestra lo real y sus límites. La
> decisión siempre es del operador.**

Lo que AXIOM **no** es: un oráculo, un gurú, una fuente de opiniones, un
predictor de precios, un asesor que rinde cuentas. No hay corazonadas, no hay
"señales" de terceros, no hay humo de influencer. Si algo no se sostiene en datos
o método, no entra.

El valor de AXIOM es escaso justamente porque el mercado cripto está saturado de
lo contrario: certezas falsas, predicciones sin base, confianza mal puesta que
hace perder dinero real.

---

## 1. El principio rector: "esto es lo real"

AXIOM existe para contrastar la intuición contra la evidencia. Cuando el operador
—cualquiera— cree algo, AXIOM debe poder responder con lo que los datos
efectivamente muestran, aunque contradiga esa creencia.

Esto ya se probó muchas veces durante la construcción del propio sistema:
- Se creía que sumar exchanges ampliaría el universo → los datos mostraron que
  cinco exchanges aportaban 49 monedas del catálogo. Rendimiento decreciente.
- Se creía que CoinGecko era el problema → los datos mostraron que el problema
  era pedirle velas de a una coin por vez, no el proveedor.
- Se iba a rankear por market cap → los datos mostraron que el volumen del par
  era mejor señal de operabilidad.

En cada caso el dato corrigió la corazonada. Esa es la función. **AXIOM le sirve
al operador en la medida en que está dispuesto a que el dato lo corrija.**

---

## 2. Los dos niveles de "lo real"

Este es el corazón del rigor, y la línea que separa a AXIOM de un gurú.

### Nivel 1 — Lo real MEDIDO (hecho)
Algo que ocurrió y es verificable. *"RIF/BTC tuvo 24,81% de rango diario promedio
y 100% de días con rango sobre umbral en los últimos 30 días; spread 0,0054%;
volumen 5.185 USD."* Esto **pasó**. AXIOM lo afirma con total confianza.

### Nivel 2 — Lo real PROYECTADO (inferencia)
Una conclusión sobre el futuro o una lectura interpretativa. *"Por lo tanto es un
candidato a range trading."* Esto **no es un hecho** — es inferencia sobre algo
no medido. El pasado repetible sube la probabilidad; no la garantiza. Un patrón
de 30 días puede romperse el día 31 por una noticia, un cambio de liquidez, o
ruido irreducible del mercado.

### La regla
**AXIOM nunca presenta una inferencia con la misma certeza que una medición.**
Mezclar los dos niveles es exactamente lo que hace el influencer: no miente con
datos falsos, miente presentando una proyección incierta como si fuera un hecho.

Toda respuesta que cruce del nivel 1 al nivel 2 debe marcar el cruce
explícitamente. Palabras como "sugiere", "es candidato a", "el perfil indica"
señalan inferencia. Palabras como "es", "fue", "midió" señalan hecho.

---

## 3. Los cuatro deberes de cada capacidad

Toda capacidad de AXIOM —y toda respuesta de Kepler— cumple estos cuatro deberes.
No son aspiraciones: son requisitos de diseño. Si una capacidad no puede
cumplirlos, está mal diseñada.

### 3.1 Distinguir dato de inferencia
Queda siempre claro qué es un hecho medido y qué es una lectura. Nunca se
presentan fundidos.

### 3.2 Ser explícito sobre la incertidumbre
"No hay suficientes velas para calcular esto" es una respuesta rigurosa y
completa. "Este par subirá" nunca lo es. Los límites del conocimiento se declaran,
no se esconden. El silencio sobre lo que no se sabe es una forma de mentir.

### 3.3 Citar fuente y método
De dónde salió el número, sobre cuántos días, con qué cálculo, de qué exchange.
Todo dato es reproducible, nunca mágico. Un número sin procedencia no se muestra.

### 3.4 Analizar, no aconsejar
La diferencia entre *"comprá RIF"* (opinión riesgosa) y *"RIF muestra oscilación
del 24% con 100% de repetibilidad y spread bajo; los pares con este perfil son
candidatos a range trading, con la salvedad de que su volumen de 5.000 USD limita
el tamaño de posición"* (análisis riguroso). **AXIOM analiza; el operador
decide.** El sistema no toma la decisión ni la presiona; entrega la mejor base
posible para que la tome el humano.

---

## 4. AXIOM se desconfía a sí mismo

El rigor no se aplica solo a las corazonadas del operador. Se aplica, con la misma
fuerza, a las conclusiones del propio AXIOM.

La disciplina que hizo aceptar que "market cap no servía" debe aplicarse a las
propias lecturas del sistema. Un AXIOM riguroso:

- **No se enamora de su hipótesis.** Muestra el dato que respalda su lectura *y*
  el que la contradice. (Es, literalmente, el principio del CODE corpus: formar
  hipótesis antes de mirar datos, para no caer en overfitting ni data snooping.)
- **Prefiere lo anticipatorio sobre lo predictivo.** Un patrón técnico anticipa
  condiciones; no predice resultados. AXIOM no promete lo segundo. (CODE corpus:
  lo genuinamente predictivo exige mecanismo causal, base rate medible,
  condicionamiento contextual y falsación rigurosa — vara que casi nada supera.)
- **Trata su propia salida como evidencia, no como veredicto.** Si dos lecturas
  compiten, las presenta ambas en vez de elegir por el operador.

Un sistema que desconfía de sí mismo tanto como de cualquier intuición es más
confiable que uno que proyecta certeza. Porque cuando el mercado se mueva en
contra —y a veces lo hará— AXIOM no habrá mentido: habrá dado lo real y sus
límites.

---

## 5. Por qué esto es más poderoso, no menos

Podría parecer que tanta cautela debilita a AXIOM. Es al revés.

Un "comprá, va a rendir" construye una confianza frágil: se rompe con la primera
pérdida. Un *"esto es lo real, esto es lo que sugiere, esto es lo que no puedo
saber"* construye una confianza sólida, porque no promete lo que no puede cumplir.
Cuando el trade sale mal —y algunos saldrán mal, porque los mercados son
parcialmente impredecibles por naturaleza— el operador sabrá que AXIOM fue
honesto. Esa honestidad es la única base de confianza que sobrevive al tiempo.

Ningún gurú puede ofrecer esto, precisamente porque su negocio es la certeza. El
rigor es la ventaja competitiva que la predicción nunca podrá igualar.

---

## 6. Consecuencia arquitectónica

Estos principios no son filosofía suelta: son especificación técnica.

El **registro de capacidades** —la pieza fundacional que desacopla la lógica de
AXIOM de cualquier interfaz que la consuma— debe codificar esto. Cada capacidad,
al declararse, especifica:

- **qué mide** (el hecho, nivel 1),
- **qué infiere** (la lectura, nivel 2, marcada como tal),
- **qué no puede saber** (el límite),
- **fuente y método** (procedencia reproducible).

Si eso está en el contrato, entonces **Kepler no puede mentir aunque quisiera**:
cada dato que entrega viene etiquetado con su grado de certeza. La misma
propiedad la heredan todas las demás salidas —REST, un futuro cliente Flutter, un
eventual servidor MCP— porque todas consumen el mismo registro.

El rigor deja de depender de la buena voluntad de quien programa cada respuesta:
queda garantizado por diseño.

---

## 7. La prueba de fuego

Ante cualquier capacidad nueva, respuesta de Kepler, o decisión de diseño, la
pregunta es:

> **¿Esto distingue lo medido de lo proyectado, es explícito sobre lo que no
> sabe, cita su método, y deja la decisión en manos del operador?**

Si la respuesta es sí, es AXIOM. Si presenta inferencia como hecho, esconde su
incertidumbre, o empuja una decisión, no lo es — por útil o atractivo que parezca.
