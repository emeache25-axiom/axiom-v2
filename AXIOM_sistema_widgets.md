# AXIOM — Diseño del Sistema de Widgets

Documento de diseño. Define **el contrato de un widget**: cómo se declara, cómo
se adapta al espacio disponible, dónde puede montarse, y cómo Kepler lo invoca.

No es código todavía — es la decisión arquitectónica de la que dependen todas
las vistas de AXIOM y la capacidad del chat de responder con interfaz, no solo
con texto.

**Gobernado por:** `AXIOM_principios_fundacionales.md`.
**Gemelo de:** `AXIOM_registro_capacidades.md` — el registro de capacidades dice
*qué sabe hacer* AXIOM; el registro de widgets dice *cómo se muestra*. Kepler
los conecta.

---

## 0. Las tres necesidades

El sistema nace de tres requerimientos que se pidieron juntos y que resultan ser
el mismo problema:

1. **Adaptable.** AXIOM se usa en escritorio y en celular. Un componente tiene
   que funcionar bien en ambos, no "achicarse y romperse".
2. **Montable en cualquier lugar.** El mismo screener de pares podría vivir en
   su pantalla, en un panel lateral del gráfico, o en un dashboard. Se define
   una vez, se usa en cualquier lado.
3. **Invocable por Kepler.** Que el chat pueda responder *"acá va el screener
   con estos filtros"* y se renderice el widget real, no una tabla de texto.

El tercer punto es el que fuerza el diseño: si Kepler va a montar widgets, cada
widget tiene que **describirse a sí mismo** — igual que hicimos con las
capacidades.

---

## 1. El problema concreto que lo disparó

La tabla de pares tiene 11 columnas y necesita ~1.100 px. Como no entra, el
contenedor lleva `overflow-x: auto` — y eso **impide fijar el encabezado**,
porque `position: sticky` no atraviesa un ancestro con `overflow`.

Se intentó resolverlo con scroll interno y quedó feo. Se revirtió y quedó
anotado como frente propio. La conclusión fue correcta: **el problema no es esa
tabla, es que no existe un sistema de adaptación.**

Y hay algo que las media queries no resuelven: un widget en un panel lateral de
300 px debe verse compacto **aunque la ventana sea de 1920 px**. Las media
queries miran la ventana; el widget necesita mirar **su propio contenedor**.

---

## 2. La arquitectura

```
   REGISTRO DE CAPACIDADES  (backend — qué sabe hacer)
              │  datos + declaración epistémica
              ▼
   REGISTRO DE WIDGETS      (frontend — cómo se muestra)
              │
      ┌───────┼───────┬──────────┬─────────┐
      ▼       ▼       ▼          ▼         ▼
   Pantalla Panel  Dashboard  Kepler    (futuro
   completa lateral            (chat)    Flutter)
```

Un widget **no sabe dónde está montado**. Recibe un contenedor y unos datos, y
se adapta. Quien lo monta decide dónde; el widget decide cómo se ve ahí.

---

## 3. El contrato de un widget

Por analogía con `IndicatorRegistry` (que ya funciona) y con `@capacidad`.

```js
AXIOM.Widgets.register({
  // ── Identidad ──
  id:      'tabla_pares',
  label:   'Screener de pares',
  grupo:   'Mercado',              // agrupación en el selector
  icono:   'ti-arrows-exchange',

  // ── Qué datos consume ──
  capacidad: 'buscar_pares',       // del registro de capacidades
  argsDefault: { quote: 'BTC', min_volumen: 1000, limit: 20 },

  // ── Dónde puede montarse ──
  contextos: ['pantalla', 'panel', 'chat', 'dashboard'],

  // ── Cómo se adapta (ver §4) ──
  densidades: {
    compacto: { hasta: 480,  campos: ['par', 'precio', 'metrica_activa'] },
    normal:   { hasta: 900,  campos: ['par', 'exchange', 'precio', 'volumen',
                                      'metrica_activa', 'spread'] },
    amplio:   { hasta: null, campos: '*' },   // todas
  },

  // ── Render ──
  // Recibe los datos, la densidad resuelta y el contexto. Devuelve HTML.
  render(datos, ctx) { /* ctx = { densidad, contexto, ancho, epistemico } */ },

  // Opcional: se llama tras montar, para enganchar eventos
  mount(el, ctx) {},
  unmount(el) {},
});
```

**Por qué el widget declara la capacidad que consume:** así el sistema sabe qué
pedir sin que el widget haga sus propios `fetch`. Un widget que llama a la API
por su cuenta se acopla al backend y no se puede montar con datos ya obtenidos
(que es lo que necesita Kepler, §5).

---

## 4. Adaptación al espacio — la decisión central

### 4.1 Se mide el CONTENEDOR, no la ventana

Un `ResizeObserver` sobre el contenedor del widget resuelve la densidad. Es lo
único que permite que el mismo widget se vea compacto en un panel de 300 px y
amplio en una pantalla de 1400 px, **en la misma sesión y al mismo tiempo**.

Las media queries no sirven acá: miran el viewport. Container queries de CSS
serían una alternativa, pero `ResizeObserver` da el ancho al JavaScript, que es
lo que necesitamos para decidir **qué campos renderizar** (no solo cómo
estilarlos).

### 4.2 Densidad declarada, no improvisada

Cada widget declara tres niveles con sus umbrales y **qué muestra en cada uno**.
No es "achicar la fuente": es decidir qué información sobrevive cuando hay menos
espacio.

Para la tabla de pares:

| Densidad | Ancho | Columnas |
|---|---|---|
| compacto | < 480 px | par, precio, la métrica por la que se ordena |
| normal | < 900 px | + exchange, volumen, spread |
| amplio | ≥ 900 px | las 11 |

**Esto resuelve el encabezado fijo de arranque:** en compacto y normal las
columnas entran sin scroll horizontal, así que `position: sticky` funciona sin
trucos. Solo en amplio —donde hay pantalla de sobra— podría hacer falta scroll.

### 4.3 La métrica activa

Un detalle que hace usable la densidad compacta: la tabla muestra **la columna
por la que se está ordenando**. Si ordenás por spread, en el celular ves par,
precio y spread. Si cambiás a volatilidad, esa columna reemplaza a la anterior.
La información relevante es la que estás mirando.

### 4.4 Regla: degradar, no romper

Si un widget no puede mostrarse útilmente en cierta densidad, lo declara
(`densidades.compacto: false`) y el contenedor muestra un resumen con acceso a
abrirlo en grande. Es preferible a renderizar algo ilegible.

---

## 5. Kepler monta widgets

### 5.1 Qué devuelve el chat

Hoy el endpoint devuelve `{respuesta, tools_usadas}`. Se agrega:

```json
{
  "respuesta": "Estos pares contra BTC muestran oscilación repetible...",
  "tools_usadas": [...],
  "montajes": [
    {
      "widget": "tabla_pares",
      "args":   { "quote": "BTC", "orden": "spread", "dir": "asc" },
      "datos":  { ...resultado de la capacidad... },
      "epistemico": { "mide": "...", "infiere": "...", "no_sabe": "..." }
    }
  ]
}
```

### 5.2 Kepler devuelve los DATOS, no solo la instrucción

Decisión: el montaje viaja **con los datos ya obtenidos**, no con una orden de
ir a buscarlos.

Dos razones. Evita una segunda llamada (el chat ya ejecutó la capacidad). Y más
importante: **garantiza que el widget muestre exactamente lo que Kepler
analizó**. Si el widget volviera a pedir los datos, podría recibir otros —los
tickers se refrescan cada 15 minutos— y el texto diría una cosa mientras la
tabla muestra otra.

### 5.3 Cómo decide Kepler qué widget montar

El registro de widgets expone su catálogo al backend (igual que el de
capacidades expone las tools). Cada widget declara qué capacidad consume, así
que el mapeo es directo: si Kepler ejecutó `buscar_pares`, el widget candidato
es el que declara esa capacidad.

Cuando hay más de un widget para la misma capacidad (una tabla y un gráfico de
dispersión, por ejemplo), el modelo elige según lo que le convenga a la
respuesta, con la descripción del widget como guía.

**Kepler no está obligado a montar nada.** Para una pregunta simple, texto
alcanza. El montaje es para cuando hay una lista, una serie o una comparación
que se lee mejor visualmente.

---

## 6. El rigor también aplica a los widgets

Un widget puede mentir tan fácil como un texto: mostrar números sin sus límites
es presentar inferencia como hecho.

**Regla:** todo widget recibe el bloque epistémico junto con los datos, y debe
exponerlo. Cómo, según la densidad:

- **amplio** — nota visible al pie con qué mide y qué no puede saber
- **normal** — ícono de información que despliega la declaración
- **compacto** — ícono, siempre presente

No es opcional. Un widget que no expone la declaración de la capacidad que
consume está incompleto, del mismo modo que una capacidad sin `no_sabe` no se
registra.

Caso concreto: la tabla de pares ordenada por volatilidad debe dejar accesible
que *"ordenar por una métrica no significa que los primeros sean mejores para
operar"* y que *"los pares con mejor spread suelen ser los de menor volumen"*.
Sin eso, la tabla sugiere una conclusión que los datos no respaldan.

---

## 7. Qué se extrae de lo que ya existe

Buena parte del trabajo es **generalizar código que ya está escrito**, atrapado
dentro de pantallas:

| Qué | Dónde está hoy | Se convierte en |
|---|---|---|
| Sparkline SVG | `bot_orderbook.js`, `watchlist-panel.js` (duplicado) | utilidad compartida |
| Formatadores (`fmtSat`, `fmtVol`, `fmtPct`, `fmtPrice`) | duplicados en varios archivos | módulo `format.js` |
| Tabla ordenable con paginación | `pairs.js` | widget `tabla_pares` |
| Lista de watchlist | `watchlist.js` (1.668 líneas) | widget `lista_watchlist` |
| Cards de régimen | `regime.js` | widget `regimen_cards` |
| Mapa de sectores | `market.js` | widget `mapa_sectores` |

`watchlist.js` con 1.668 líneas es el candidato más claro: extraer su tabla como
widget la vuelve reutilizable y parte el archivo más grande del frontend.

---

## 8. Plan de implementación (una cosa por tramo)

| # | Tramo | Entregable | Riesgo |
|---|---|---|---|
| 1 | Núcleo: `WidgetRegistry` + resolución de densidad por `ResizeObserver` + montador | infraestructura, sin widgets aún | bajo (código nuevo) |
| 2 | Utilidades compartidas: formatadores y sparkline | deja de haber duplicados | bajo |
| 3 | Primer widget: `tabla_pares` | la tabla actual convertida, con densidades y encabezado fijo | medio (toca una pantalla en uso) |
| 4 | Montaje desde Kepler | el chat responde con widgets | medio |
| 5 | Migrar el resto de vistas a widgets | watchlist, régimen, mapa | alto, incremental |

Los tramos 1 y 3 son el núcleo: si el contrato no funciona bien con la tabla de
pares —el caso más complejo, 11 columnas y ordenamiento— mejor descubrirlo ahí
que después de migrar cinco vistas.

---

## 9. Decisiones registradas

1. **La densidad se resuelve por el ancho del CONTENEDOR** (`ResizeObserver`),
   no de la ventana. Es lo único que permite el mismo widget compacto en un
   panel y amplio en una pantalla, simultáneamente.
2. **Cada widget declara qué muestra en cada densidad.** Adaptarse no es achicar
   la fuente: es decidir qué información sobrevive.
3. **El widget declara qué capacidad consume; no hace fetch propio.** Así se
   puede montar con datos ya obtenidos (requisito de Kepler) y no se acopla al
   backend.
4. **Kepler devuelve los datos junto al montaje**, no una orden de buscarlos:
   garantiza que el texto y el widget muestren lo mismo.
5. **Todo widget expone la declaración epistémica** de su capacidad. No es
   opcional: un widget sin ella presenta inferencias como hechos.
6. **Se reusa el patrón de `IndicatorRegistry`**, que ya funciona en charts:
   contrato autocontenido, registro al cargar el script, el core no se modifica
   para agregar uno nuevo.

---

## 10. Lo que este diseño NO resuelve

Aplicando el mismo criterio que le exigimos a las capacidades:

- **No mejora ninguna vista por sí solo.** Es infraestructura; el valor aparece
  cuando las vistas se migran, y esa migración es incremental y trabajosa.
- **No define la estética.** Resuelve *qué* mostrar en cada tamaño, no *cómo* se
  ve. El diseño visual sigue siendo decisión caso por caso.
- **No garantiza que Kepler elija bien el widget.** Hace probable que acierte
  (declaraciones claras, mapeo por capacidad), no imposible que se equivoque.
- **No resuelve widgets con estado complejo** (el gráfico con sus indicadores y
  dibujos). Ese es un caso aparte, con su propio ciclo de vida; el sistema debe
  poder montarlo pero no gestionarlo internamente.
- **Costo real:** cada vista migrada cuesta más trabajo que dejarla como está.
  Se justifica por reutilización y por el montaje desde el chat, no por
  prolijidad.
