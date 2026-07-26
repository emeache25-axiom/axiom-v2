# AXIOM — Diseño del Registro de Capacidades

Documento de diseño. Define **el contrato**: cómo se declara una capacidad de
AXIOM, qué metadata lleva, y cómo la consumen las distintas interfaces.

No es código todavía — es la decisión arquitectónica de la que dependen Kepler,
la API REST, un futuro cliente Flutter y un eventual servidor MCP.

**Gobernado por:** `AXIOM_principios_fundacionales.md`. Toda decisión de este
documento se justifica contra esos principios.

---

## 0. El problema que resuelve

Hoy cada capacidad de AXIOM se declara **en el consumidor**. Las herramientas de
Kepler viven cableadas en `backend/api/chat.py`: un diccionario con `name`,
`description` y `parameters`, más una rama en `_ejecutar_funcion` que la traduce
a una llamada de dominio.

Eso tiene tres consecuencias, todas visibles hoy:

1. **Desincronización garantizada.** La tool `buscar_coins` todavía describe un
   modo `volatility` sobre coins que fue eliminado en la migración a pares.
   Kepler quedó desfasado del sistema real.
2. **Cada funcionalidad nueva exige editar el chat.** Se construyó el screener de
   pares completo y Kepler no lo conoce.
3. **La lógica de despacho se duplicaría** en cada interfaz nueva (REST, Flutter,
   MCP), cada una reimplementando cómo llamar a cada capacidad.

El objetivo declarado por Migue: *"si mañana quiero cambiar todo el frontend, o
usar Flutter, quiero poder consumir todas las herramientas de AXIOM sin
modificar nada. Si mañana agrego 200 funcionalidades, quiero usarlas con el chat
sin mayores complicaciones."*

---

## 1. La arquitectura

```
          CAPA DE DOMINIO  (la lógica — ya existe)
          Coin · Par · Mercado · Watchlist · Screener…
                          │
                          │  cada capacidad se declara AQUÍ,
                          │  junto a su propio código
                          ▼
              REGISTRO DE CAPACIDADES
              · cataloga (qué hay, con qué contrato)
              · despacha (ejecuta por nombre + args)
                          │
        ┌─────────┬───────┴───────┬──────────┐
        ▼         ▼               ▼          ▼
      REST      Kepler         Servidor    Flutter
      API       (chat)         MCP         (futuro)
```

Los consumidores se vuelven **tontos y descartables**: solo saben preguntar
"¿qué hay?" y decir "ejecutá esto". Toda la inteligencia vive en el registro y
la capa de dominio. Cambiar de interfaz no toca la lógica; agregar lógica no
toca las interfaces.

---

## 2. Las tres decisiones de diseño

### 2.1 La declaración vive CON la capacidad

Cada capacidad declara su contrato **junto a su propio código**, en la capa de
dominio — no en el consumidor.

**Fundamento:** es la única forma de que "agregar una funcionalidad" y "que el
chat la conozca" sean **el mismo acto**. Si la declaración vive en el consumidor,
la desincronización es cuestión de tiempo — y ya ocurrió (`buscar_coins`).

**Costo aceptado:** acopla la capa de dominio a un formato de declaración. Es un
acoplamiento barato (un decorador) frente al beneficio.

### 2.2 Declaración epistémica OBLIGATORIA para todas, sin excepción

Toda capacidad declara `mide`, `infiere` y `no_sabe`. Sin fronteras, sin
categorías exentas, sin criterio a interpretar.

**Fundamento — el argumento decisivo (de Migue):** *"hoy sabemos lo que tenemos
en AXIOM, pero eso no define qué más vamos a tener a futuro, no lo sabemos."*

Se evaluó una alternativa: exigirla solo a las capacidades que calculan,
clasifican u ordenan datos de mercado, y hacerla opcional para las utilitarias.
Se **descartó**, porque obliga a clasificar cada capacidad nueva contra una
frontera — y las capacidades futuras no se conocen. Cada una sería una
discusión, y con el tiempo las discusiones se resuelven por conveniencia y no
por criterio. La regla universal **se aplica sola, hoy y dentro de dos años, a
capacidades que todavía no imaginamos**: escala sin degradarse.

**Beneficio secundario:** escribir `infiere: nada` **obliga a verificar** que
efectivamente no infiere nada. Es un control, no un trámite. Si al escribirlo
aparece una inferencia escondida, mejor descubrirla ahí.

### 2.3 El registro describe Y ejecuta (es un despachador)

No solo cataloga: sabe correr cada capacidad. Un consumidor pide
`ejecutar("analizar_coin", {"coin_id": "ontology"})` y el registro despacha
contra la capa de dominio.

**Fundamento:** si solo describiera, cada consumidor tendría que reimplementar
cómo llamar a cada capacidad — cuatro copias de la misma lógica de despacho, que
es exactamente lo que se quiere evitar. Con despachador central, agregar MCP es
envolverlo; migrar a Flutter no lo toca.

**Costo aceptado:** concentra responsabilidad en un punto. Preferible a N puntos
que hacen lo mismo.

---

## 3. El contrato de una capacidad

Cada capacidad declara dos bloques: **técnico** (para poder invocarla) y
**epistémico** (para cumplir los principios fundacionales).

### 3.1 Bloque técnico

| Campo | Obligatorio | Contenido |
|---|---|---|
| `nombre` | sí | Identificador único, snake_case. Ej. `analizar_coin` |
| `descripcion` | sí | Qué hace, en lenguaje natural. La lee el modelo del chat para decidir cuándo usarla |
| `parametros` | sí | Nombre, tipo, si es requerido, descripción y ejemplos de cada uno |
| `devuelve` | sí | Forma de la salida: qué campos, de qué tipo, en qué unidad |
| `categoria` | sí | Agrupación (`mercado`, `coin`, `par`, `watchlist`, `sistema`) para navegación y filtrado |
| `costo` | sí | `barato` (SQL local) · `medio` (una llamada externa) · `caro` (muchas llamadas o cómputo pesado). Permite que un consumidor decida si conviene invocarla |

### 3.2 Bloque epistémico — obligatorio

Los tres campos que codifican `AXIOM_principios_fundacionales.md` §2 y §3.

| Campo | Contenido |
|---|---|
| `mide` | **Lo real medido (nivel 1).** Qué hecho verificable entrega, con su unidad y ventana temporal. Ej: *"rango diario promedio (high−low)/low en % sobre las últimas 30 velas diarias del par"* |
| `infiere` | **Lo real proyectado (nivel 2).** Qué lectura o interpretación agrega sobre lo medido. Si no agrega ninguna: `"nada"` |
| `no_sabe` | **Los límites.** Qué NO puede afirmar esta capacidad. Ej: *"si el patrón se sostendrá; el pasado repetible sube la probabilidad, no la garantiza"* |
| `fuente` | Procedencia del dato: tabla, exchange, endpoint, y frecuencia de actualización |
| `metodo` | Cómo se calcula, de forma reproducible. Si es un dato crudo: `"lectura directa, sin cálculo"` |

**Regla de oro:** si `infiere` no es `"nada"`, entonces `no_sabe` **no puede**
ser `"nada"`. Toda inferencia tiene límites; declarar una sin el otro es una
declaración incompleta y el registro debe rechazarla.

### 3.3 Ejemplos

**Capacidad que calcula e infiere** — screener de pares:

```
nombre:      buscar_pares
descripcion: Busca pares tradeables de MEXC/CoinEx según volumen, volatilidad,
             spread y capitalización de la coin. Ordenable por cualquier métrica.
categoria:   par
costo:       barato
parametros:  quote, exchange, min_volumen, min_volatilidad, orden, dir, limit
devuelve:    lista de pares con exchange, símbolo, precio, volumen 24h,
             las tres métricas de volatilidad, spread y metadata de la coin

mide:    volumen 24h en USD (ticker del exchange, últimos 15 min);
         rango diario promedio (high−low)/low % sobre 30 velas diarias;
         desvío estándar de retornos diarios %;
         % de días con rango sobre umbral;
         spread (ask−bid)/mid % del libro actual
infiere: nada — entrega métricas, no lecturas. Ordenar por una métrica NO
         implica que los primeros sean mejores para operar.
no_sabe: si las métricas se sostendrán; si hay liquidez suficiente para salir
         en tamaño (el volumen es del mercado, no del libro); si un par sin
         velas suficientes es poco volátil o simplemente nuevo
fuente:  tabla `pairs` (tickers cada 15 min, spread CoinEx cada hora) y
         `pair_ohlcv` (velas diarias, sync 00:30 UTC)
metodo:  filtro y ORDER BY en SQL sobre métricas precalculadas por
         pair_ohlcv_sync
```

**Capacidad utilitaria** — la declaración trivial también es obligatoria:

```
nombre:      mi_watchlist
descripcion: Los pares que el usuario tiene en seguimiento.
categoria:   watchlist
costo:       barato
parametros:  (ninguno)
devuelve:    lista de pares con exchange, símbolo, quote, operable, bot activo

mide:    los pares que el usuario cargó manualmente en su watchlist,
         enriquecidos con precio y metadata de la tabla `coins`
infiere: nada
no_sabe: nada — es el contenido literal de la tabla
fuente:  tabla `watchlist` (alta manual del usuario) + `coins` (sync 6 h)
metodo:  lectura directa, sin cálculo
```

Escribir `infiere: nada` toma segundos y **verifica** que efectivamente no hay
inferencia escondida.

---

## 4. Qué expone el registro

### 4.1 Catálogo — `listar()`
Devuelve todas las capacidades con su contrato completo. Filtrable por categoría
o costo. Es lo que permite que un consumidor **descubra** qué hay sin saberlo de
antemano — el requisito central: agregar 200 funcionalidades y que el chat las
use sin tocarlo.

### 4.2 Detalle — `describir(nombre)`
El contrato completo de una capacidad.

### 4.3 Ejecución — `ejecutar(nombre, args)`
Valida los argumentos contra `parametros`, despacha contra la capa de dominio,
y devuelve el resultado **acompañado de su declaración epistémica**.

Esto último es clave: la respuesta no es solo el dato, es el dato *con su
contrato*. Así Kepler recibe siempre, junto a los números, qué se midió, qué se
infiere y qué no se sabe — y no puede presentar una inferencia como hecho aunque
el modelo tienda a hacerlo.

### 4.4 Traducción a formatos de consumidor
El registro ofrece proyecciones de su catálogo:
- **formato function-calling** (Gemini/OpenAI) → lo que hoy es `FUNCIONES` en
  `chat.py`, generado automáticamente
- **formato MCP** → la lista de tools de un servidor MCP
- **formato OpenAPI** → para documentar el REST

Una sola fuente de verdad, varias proyecciones. Agregar un formato nuevo no toca
ninguna capacidad.

---

## 5. Cómo se declara — forma propuesta

Un decorador sobre el método de dominio, para que la declaración quede
físicamente pegada al código que implementa:

```python
@capacidad(
    nombre="analizar_coin",
    descripcion="...",
    categoria="coin",
    costo="medio",
    parametros=[
        Param("coin_id", str, requerido=True,
              descripcion="id de CoinGecko en minúsculas y con guiones",
              ejemplos=["bitcoin", "ontology"]),
    ],
    devuelve="metadata de mercado, régimen global, posición sectorial y fuerza relativa vs BTC",
    mide="...",
    infiere="...",
    no_sabe="...",
    fuente="...",
    metodo="...",
)
async def regimen_relativo(self): ...
```

El decorador registra la capacidad al importarse el módulo. Si falta un campo
obligatorio, o si `infiere != "nada"` y `no_sabe == "nada"`, **falla al arrancar**
— no en runtime. Un contrato incompleto es un error de programación, no una
advertencia.

---

## 6. Plan de implementación (una cosa por tramo)

| # | Tramo | Entregable | Riesgo |
|---|---|---|---|
| 1 | Núcleo del registro | Decorador `@capacidad`, validación de contrato, `listar/describir/ejecutar` | bajo (código nuevo, nada se rompe) |
| 2 | Migrar 2-3 capacidades piloto | Valida el patrón contra casos reales antes de masificar | bajo |
| 3 | Proyección a function-calling | El registro genera `FUNCIONES` automáticamente | medio (toca Kepler) |
| 4 | Reconectar Kepler al registro | Kepler descubre capacidades solo; se elimina el cableado de `chat.py` | medio |
| 5 | Migrar el resto de capacidades | Todo el dominio declarado | bajo, tedioso |
| 6 | *(opcional)* Servidor MCP | Envoltura sobre el registro | bajo si 1-5 están hechos |

Los tramos 1 y 2 son el núcleo: si el patrón no funciona bien con casos reales,
mejor descubrirlo con tres capacidades que con treinta.

---

## 7. Qué resuelve

| Problema | Cómo queda |
|---|---|
| Kepler desactualizado (no conoce el screener de pares) | Descubre capacidades del registro; imposible desincronizar |
| Tool `buscar_coins` describe un modo eliminado | La declaración vive con el código: si se elimina la capacidad, se elimina su declaración |
| Agregar funcionalidad exige editar el chat | Se declara una vez, aparece en todas las interfaces |
| Cambiar de JS a Flutter | Flutter consume el mismo registro; la lógica no se toca |
| Exponer AXIOM por MCP | Envoltura fina sobre el registro |
| Rigor depende de quién programe la respuesta | Garantizado por contrato: cada dato viaja con su declaración epistémica |

---

## 8. Lo que este diseño NO resuelve

Honestidad sobre los límites, aplicando el mismo criterio que le exigimos a las
capacidades:

- **No mejora la calidad de los datos.** Un registro riguroso sobre datos malos
  sigue dando resultados malos.
- **No garantiza que las declaraciones sean buenas.** Obliga a escribirlas, no a
  que sean honestas o precisas. Eso depende de quien las escriba.
- **No evita que un modelo de lenguaje malinterprete.** Recibir la declaración
  epistémica hace mucho más probable que Kepler distinga dato de inferencia, pero
  no lo hace imposible de romper.
- **No es gratis.** Cada capacidad nueva cuesta unos minutos más de declaración.
  Es el precio del desacoplamiento y del rigor verificable.
