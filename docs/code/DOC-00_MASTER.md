# DOC-00 — MASTER: Visión, Principios y Gobernanza

**Proyecto:** CODE — Crypto Opportunity Discovery Engine (AXIOM Quant)
**Documento:** DOC-00 (raíz del corpus)
**Versión:** 2.0 (reinicio informado)
**Estado:** APPROVED — baseline activa
**Reemplaza:** corpus legacy CODE v1 (27 documentos), archivado como referencia.

---

## 1. QUÉ ES CODE

CODE es el sistema cuantitativo de AXIOM que, partiendo de un universo amplio de
pares de criptomonedas (~500), construye cada día una **cartera (cocktel) de N
pares**, cada uno operado según su naturaleza, cuya **suma de retornos netos de
costos** apunta a ≥1% diario con riesgo controlado.

CODE **no predice la dirección del precio**. Selecciona, combina y opera
oportunidades de esperanza matemática positiva, distribuidas para maximizar el
retorno agregado y minimizar la correlación.

---

## 2. POR QUÉ ESTE REINICIO (v2)

El corpus v1 (27 documentos) cumplió su función: forzar el pensamiento riguroso
del problema. Pero como artefacto tenía tres problemas:
- Numeración inconsistente y secciones desordenadas.
- Escala pensada para un equipo con infraestructura grande (5 años de tick data,
  on-chain, clustering pesado), no para desarrollo solo en hardware modesto.
- Fue escrito ANTES de las ideas superadoras: cocktel, 1% como piso, oscilación
  como oro, dos velocidades, tiers.

v2 es un **reinicio informado**: corpus nuevo, limpio, de 8 documentos, que
destila lo mejor de v1 (rigor, separación de engines, gobernanza) y la visión
actual, a escala construible. v1 se conserva archivado, no se borra.

---

## 3. PRINCIPIOS RECTORES

**P1 — El 1% es piso, no techo.** El sistema captura todo el movimiento
aprovechable. El 1% valida la entrada; la magnitud la decide el mercado vía
salidas adaptativas.

**P2 — Nada es ruido hasta probar que no se puede aprovechar.** La oscilación
estructurada es oro, no ruido. La herramienta se adapta al par. Solo se descarta
el caos sin asimetría positiva neta de costos.

**P3 — El poder está en el cocktel.** El objetivo es el retorno AGREGADO de la
cartera. Muchas fuentes chicas, positivas y descorrelacionadas son más estables
que una grande.

**P4 — Dos velocidades.** Lo contextual/relativo filtra el universo (lento). Lo
técnico/inmediato elige el cocktel (rápido). Cada señal en su escala de tiempo.

**P5 — El par n°500 no se analiza como el n°1.** Cada tier de capitalización
tiene criterio y ponderación propios.

**P6 — El código manda.** Todo gen, arquetipo, umbral y estrategia es hipótesis
hasta que el backtester y el forward testing lo validan, netos de costos. El
diseño se actualiza cuando el código lo obliga, nunca antes.

**P7 — Los costos son ciudadanos de primera clase.** Comisión + spread +
slippage se descuentan SIEMPRE. Una métrica que no descuenta costos es inválida.

**P8 — Escala realista.** Se construye para el hardware real (notebook modesta).
Se prefiere lo simple y medido sobre lo sofisticado y pesado. Empezar con pocos
datos impecables antes que muchos a medias.

---

## 4. RIGOR EPISTEMOLÓGICO (heredado de v1, es una joya)

Toda hipótesis del sistema debe ser:
- **Medible:** se puede cuantificar.
- **Reproducible:** otro (o vos en el futuro) puede recalcularla igual.
- **Falsable:** existe un resultado que la refutaría.

Criterios de aceptación de cualquier componente:
- Supera un benchmark definido de antemano.
- Se mantiene fuera de muestra (out-of-sample), no solo en el período de ajuste.
- Sobrevive a los costos reales.

Lo que no cumple esto no entra al sistema, por elegante que parezca.

---

## 5. ARQUITECTURA DEL SISTEMA (mapa de los engines)

Dos niveles (P4), seis motores, más ejecución y medición:

```
Universo (~500 pares)
  │  NIVEL LENTO (contextual/relativo)
  ▼
[UE] Universe Engine    → conjunto elegible (~N pares sanos, con flujo y fuerza)
  │  NIVEL RÁPIDO (técnico/inmediato)
  ▼
[DE] DNA Engine         → carácter del par (arquetipo + genes)
[SE] State Engine       → estado de hoy
[EE] Edge Engine        → esperanza condicional + herramienta adaptada
[PE] Portfolio Engine   → construcción del cocktel (combinación + riesgo)
[XE] Exit Engine        → salidas adaptativas por arquetipo
  │
  ▼
Ejecución (bot v2 actual) + Medición (forward testing real)
```

---

## 6. ESTRUCTURA DEL CORPUS (8 documentos)

| Doc | Nombre | Contenido |
|-----|--------|-----------|
| **DOC-00** | Master | Este documento: visión, principios, gobernanza, mapa. |
| **DOC-01** | Data Layer | Qué datos, de dónde, calidad. Escala realista (OHLCV + metadata). |
| **DOC-02** | DNA Engine | Caracterización de pares: genes, arquetipos, validación. |
| **DOC-03** | State Engine | Estado actual de cada par (compresión/expansión, rango/ruptura...). |
| **DOC-04** | Edge Engine | Esperanza condicional al estado; asimetría; selección de herramienta. |
| **DOC-05** | Universe Engine | Filtro contextual/relativo; tiers; señales de fuerza/salud/flujo. |
| **DOC-06** | Portfolio Engine | Construcción del cocktel; correlación; exposición; tamaño. |
| **DOC-07** | Exit, Ejecución y Medición | Salidas adaptativas; integración con bot v2; métricas reales. |

Orden de construcción (no de numeración): DOC-02 (DNA) primero, porque solo
necesita OHLCV. Luego SE, EE. El UE (DOC-05) se construye después porque depende
de un pipeline de market cap/ranking. Ver cada doc para detalle.

---

## 7. GOBERNANZA

**Regla de congelamiento (heredada de v1, refinada):**
- Un documento APPROVED no se modifica por el solo hecho de crear otro nuevo.
- Las modificaciones a un documento APPROVED solo ocurren cuando el CÓDIGO lo
  obliga (un hallazgo empírico que contradice o refina el diseño).
- Todo cambio post-código se registra con fecha y motivo.

**Estados documentales:**
- `DRAFT` — en redacción, no es baseline.
- `APPROVED` — baseline activa, se construye sobre él.
- `SUPERSEDED` — reemplazado por una versión nueva (se archiva, no se borra).

**Versionado:** MAJOR.MINOR. MINOR para refinamientos; MAJOR para cambios
estructurales.

---

## 8. OBJETIVO Y HONESTIDAD

- **Meta:** ≥1% diario de retorno agregado de cartera, neto de costos.
- **Naturaleza:** vara de medición, no supuesto de cálculo. El sistema maximiza
  esperanza agregada ajustada por riesgo; cuánto se logra lo dice la medición real.
- **Viabilidad:** un retorno sostenido menor (0.3-0.5%/día) ya es extraordinario
  (>100% anual) y valida el sistema.
- **Regla de oro:** el sistema debe poder abstenerse ("hoy no hay cocktel viable")
  sin penalización. No se fuerzan trades para alcanzar el número.

---

## 9. RELACIÓN CON AXIOM (lo ya construido)

CODE no se construye en el vacío. Reutiliza infraestructura existente de AXIOM v2:
- **Backfill MEXC/CoinEx** (paginación profunda) → alimenta el Data Layer.
- **Backtester** (motor O(n), independiente) → valida arquetipos y estrategias.
- **Bot v2** (ejecución paper-trading, multi-estrategia) → ejecuta el cocktel.
- **Stats engine** → medición de forward testing real.
- **Coins DB** (~1750 coins + taxonomía) → universo y sectores.
- **Motor de régimen** (sección Mercado) → contexto de estado.

CODE es el cerebro que orquesta este músculo ya existente.

---

## ESTADO
APPROVED · v2.0 · baseline activa del corpus CODE.
Documentos siguientes: DOC-01 a DOC-07, en redacción incremental.
