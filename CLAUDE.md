# AXIOM v2 — Contexto para Claude Code

Este archivo se lee automáticamente al inicio de cada sesión. Contiene lo que hay
que saber para trabajar en AXIOM sin preguntar de nuevo.

---

## 0. Qué es AXIOM

Cockpit personal de trading cripto de Migue. Uso propio, no producto comercial.

> **La brújula:** una plataforma de trading. Ni más ni menos. Con información
> relevante, análisis importantes, pares operables, herramientas inteligentes y
> uso de IA.

Ante cada decisión, la pregunta es: **¿esto ayuda a operar mejor?** Si la
respuesta no es clara, va a la lista de después. Lo que hundió la versión 1 fue
abrir muchos frentes a la vez y poner parches.

**Disciplina de trabajo: una cosa por sesión, cerrada antes de abrir la
siguiente.** Si aparece un problema nuevo en el camino, se anota — no se
persigue.

---

## 1. Principios que gobiernan el código

Leer `AXIOM_principios_fundacionales.md`. Resumen operativo:

**Distinguir lo MEDIDO de lo INFERIDO.** Un hecho verificable ("el rango diario
promedio fue 24,81%") no se presenta igual que una lectura ("es candidato a range
trading"). Mezclarlos es lo que hace un influencer.

**Ser explícito sobre los límites.** "No hay velas suficientes para calcular
esto" es una respuesta completa. Callar lo que no se sabe es una forma de mentir.

**Analizar, no aconsejar.** AXIOM analiza; Migue decide. Nunca "comprá X".

**AXIOM desconfía de sí mismo** tanto como de cualquier intuición. Si dos
lecturas compiten, se muestran ambas.

Esto no es filosofía: es especificación. Toda capacidad declara qué mide, qué
infiere y qué no puede saber, y el registro **rechaza** las declaraciones
incompletas al arrancar.

---

## 2. Infraestructura

| | |
|---|---|
| Server | `decentralia`, `192.168.0.88`, Debian 13 |
| Acceso | `ssh migue@192.168.0.88` (clave ya configurada) |
| Repo en el server | `~/apps/axiom-v2` |
| Servicio | `axiom-v2.service` (systemd), FastAPI en puerto 8002 |
| Base | PostgreSQL 17, base `axiom_v2`, usuario `axiom_user` |
| Público | `https://axiom.decentralia.com.ar` (Cloudflare Tunnel + Caddy) |
| Repo remoto | `git@github.com:emeache25-axiom/axiom-v2.git` (privado) |

**Stack:** Python 3.11 · FastAPI · asyncpg · APScheduler · PostgreSQL 17.
Frontend: **vanilla JS con `window.AXIOM` como namespace. Sin Node, sin npm, sin
build step.** Lightweight Charts v5.2 para gráficos.

---

## 3. Comandos del proyecto

```bash
# Desplegar cambios (el repo local se sincroniza por git)
ssh migue@192.168.0.88 "cd ~/apps/axiom-v2 && git pull && sudo systemctl restart axiom-v2.service"

# Estado y logs
ssh migue@192.168.0.88 "sudo systemctl status axiom-v2.service --no-pager | head -5"
ssh migue@192.168.0.88 "sudo journalctl -u axiom-v2.service -n 40 --no-pager"

# Migraciones (ver §4: SIEMPRE con ALTER TABLE ... OWNER TO axiom_user)
ssh migue@192.168.0.88 "cd ~/apps/axiom-v2 && sudo -u postgres psql -d axiom_v2 -f migrations/00X_nombre.sql"

# Consultar la base
ssh migue@192.168.0.88 "sudo -u postgres psql -P pager=off -d axiom_v2 -c 'SELECT ...'"
```

**`-P pager=off` es necesario**: sin eso `psql` abre un paginador que deja la
consola trabada en `(end)`.

**Verificar con una llamada real, no solo con `systemctl status`.** El servicio
puede reportar `active (running)` aunque uvicorn haya fallado al importar:

```bash
ssh migue@192.168.0.88 "curl -s http://localhost:8002/api/capacidades/ | head -c 200"
```

---

## 4. Trampas conocidas (todas costaron una sesión)

**Migraciones sin `OWNER`.** Si una migración corre con `sudo -u postgres`, las
tablas quedan de `postgres` y la app da *"permission denied for table"*. Toda
migración termina con:

```sql
ALTER TABLE nombre_tabla OWNER TO axiom_user;
ALTER SEQUENCE nombre_tabla_id_seq OWNER TO axiom_user;  -- si tiene serial
```

**Cambios de `.env` requieren reinicio.** El servicio lo carga al arrancar.

**Frontend: purgar caché de Cloudflare** (incluido `index.html`, no solo
`/static/*`) y hard refresh (Ctrl+Shift+R). Si no, se sirve la versión vieja.

**UTF-8 en operaciones de archivo:** evitar acentos en anclas o marcadores de
`cat`/`sed` (por ejemplo, no usar "último" con tilde como patrón).

**Precisión numérica:** los pares en satoshis manejan valores como
`0.00000113`. Las tablas nuevas usan `NUMERIC(30,12)`; `NUMERIC(24,8)` se queda
corta.

**Timestamps de exchanges:** CoinEx `get_ohlcv` requiere **milisegundos**, no
segundos. MEXC y CoinEx ignoran `end_ms` si no se manda también `start_ms`.

---

## 5. Arquitectura

### Backend

```
backend/
├── main.py            arranque, lifespan, routers
├── domain/            CAPA DE DOMINIO — capacidades atómicas y componibles
│   ├── registry.py    ⭐ REGISTRO DE CAPACIDADES (leer antes de tocar dominio)
│   ├── coin.py        Coin: la entidad central
│   ├── par.py         Par: proyección de una Coin en un exchange+quote
│   ├── mercado.py     Mercado: singleton, propiedades del conjunto
│   ├── watchlist.py   Watchlist: colección con CRUD
│   ├── sistema.py     capacidades sin entidad (screener, sugeridas)
│   └── base.py        mixin Composable.overview()
├── api/               endpoints HTTP/WS (~75)
├── services/          lógica de negocio y syncs
├── exchanges/         adaptadores: MEXC, CoinEx, Binance, CoinGecko
├── strat/             motor de estrategias y backtesting
├── data/              fuentes SOLO del cálculo de régimen (no confundir
│                      con exchanges/ — roles distintos, nombres parecidos)
└── scheduler/tasks.py 11 jobs periódicos
```

### Frontend

```
frontend/static/js/
├── widgets/           ⭐ SISTEMA DE WIDGETS
│   ├── registry.js    registro y contrato
│   ├── mount.js       montador: densidad por contenedor
│   ├── format.js      formatadores compartidos
│   └── tabla-pares.js primer widget real
├── charts/            módulo de gráficos (22 archivos, bien dividido)
├── screens/           pantallas
├── router.js          navegación
└── app.js             registro de pantallas
```

---

## 6. Los dos registros (lo más importante de la arquitectura)

### Registro de capacidades — backend
`backend/domain/registry.py`. Diseño en `AXIOM_registro_capacidades.md`.

Cada capacidad se declara **junto a su código** con `@capacidad`, y el registro
la cataloga y la despacha. Los consumidores (Kepler, REST, un futuro Flutter)
solo preguntan "¿qué hay?" y dicen "ejecutá esto".

**El bloque epistémico es OBLIGATORIO para todas, sin excepción** — `mide`,
`infiere`, `no_sabe`, `fuente`, `metodo`. Motivo: hoy sabemos qué tiene AXIOM,
pero no qué tendrá; un criterio del tipo "obligatorio solo para las que calculan"
exigiría clasificar cada capacidad futura contra una frontera, y esas discusiones
se terminan resolviendo por conveniencia.

**Regla de oro:** si `infiere` no es `"nada"`, `no_sabe` no puede serlo. Toda
inferencia tiene límites. El registro rechaza la declaración y **el servicio no
arranca** — un contrato incompleto es un error de programación, no una
advertencia.

Escribir estas declaraciones **encuentra bugs reales**. Ejemplos vividos: al
declarar el mapa de sectores apareció que el promedio era simple y no ponderado
por capitalización, lo que daba lecturas invertidas (privacy figuraba "fuerte
+9,5%" cuando por capital caía -6%). Al declarar la watchlist apareció que no se
revalida contra el catálogo de pares.

Agregar una capacidad la hace aparecer sola en Kepler. **No se toca `chat.py`.**

### Registro de widgets — frontend
`frontend/static/js/widgets/`. Diseño en `AXIOM_sistema_widgets.md`.

Un widget declara qué capacidad consume, en qué contextos puede montarse, y **qué
campos muestra en cada densidad**. La densidad se resuelve por el ancho del
**contenedor** (`ResizeObserver`), no de la ventana: es lo que permite el mismo
widget compacto en un panel de 300px y amplio en pantalla completa,
simultáneamente.

El montador mide el layout (por ejemplo, el alto del nav fijo) y lo pasa en el
contexto, así el widget no necesita saber nada de la app.

**Todo widget expone la declaración epistémica** de su capacidad. No es opcional.

---

## 7. Modelo de datos

**El universo son los PARES OPERABLES, no las coins.** Decisión de fondo, tomada
con datos. Ver `AXIOM_modelo_pares.md` y `AXIOM_mapa_datos.md`.

| Tabla | Contenido |
|---|---|
| `pairs` | ~3.250 pares de MEXC y CoinEx: volumen, spread, 3 métricas de volatilidad |
| `pair_ohlcv` | velas diarias por par, `NUMERIC(30,12)` |
| `coins` | catálogo y metadata de CoinGecko (~2.400) |
| `coin_info` | ficha de proyecto, caché con TTL 7 días |
| `snapshots` + `signal_readings` | régimen horario, 12 señales × 3 temporalidades |
| `watchlist` | pares en seguimiento (alta manual) |
| `chart_*` | estado de la pantalla de gráficos |
| `bot_*` / `strat_*` | paper trading |

**Exchanges:** MEXC y CoinEx son los **operables**. Binance queda como adaptador
de datos, fuera del universo. Regla: **el exchange es siempre explícito, sin
fallback silencioso.**

**CoinGecko** se usa solo para metadata (ranking, capitalización, sector, ficha):
el supply circulante es dato de investigación que ningún exchange da. Las velas
vienen de los exchanges — CoinGecko no da volumen y su rate limit hace imposible
pedir de a una coin.

**Eliminado (no reintroducir):** `ohlcv_daily`, `ohlcv_sync.py`,
`coin_exchanges`, `watchlist_old`, el WebSocket de Binance en `charts.py`.

---

## 8. Tres métricas de volatilidad

Se calculan las tres, sobre las últimas 30 velas diarias:

| Campo | Qué mide |
|---|---|
| `volatility_30d` | rango diario promedio `(high−low)/low %` — **principal** |
| `volatility_std` | desvío estándar de los retornos diarios % |
| `range_days_pct` | % de días cuyo rango superó el 3% — **repetibilidad** |

**Las tres juntas hacen falta.** WBTC/BTC tiene spread 0% pero rango 0,06%: es
Bitcoin envuelto, no oscila. RIF/BTC tiene 24% de rango con 100% de
repetibilidad y spread 0,005%, pero volumen de 5.000 USD diarios — buen perfil,
liquidez limitada para salir en tamaño. Cada métrica sola engaña.

---

## 9. Estilo de código

**Backend:** async/await, asyncpg con parámetros posicionales (`$1`), nunca
interpolación de strings en SQL con datos del usuario. Whitelist para nombres de
columna en `ORDER BY`. Docstrings en español que expliquen **por qué**, no qué.

**Frontend:** vanilla JS, patrón IIFE con `window.AXIOM`. Sin frameworks, sin
build. Estilos inline con variables CSS del tema (`--t1`, `--t2`, `--t3`, `--c1`,
`--c2`, `--w1`, `--cy`, `--re`, `--f2`). El verde se usa literal: `#56A14F`.

**Comentarios:** explicar decisiones y trampas, no lo obvio. Si algo se hizo de
una forma no evidente, decir por qué — la próxima sesión no recuerda la
discusión.

**Nombres en español** para el dominio (`regimen_global`, `pares_seguidos`,
`buscar_pares`).

---

## 10. Documentos del proyecto (leer según la tarea)

| Documento | Cuándo |
|---|---|
| `AXIOM_principios_fundacionales.md` | **siempre** — gobierna todo lo demás |
| `AXIOM_estado_y_foco.md` | al empezar: qué está hecho, qué falta, en qué orden |
| `AXIOM_registro_capacidades.md` | antes de tocar el dominio o agregar capacidades |
| `AXIOM_sistema_widgets.md` | antes de tocar el frontend |
| `AXIOM_modelo_pares.md` | antes de tocar datos de mercado |
| `AXIOM_mapa_datos.md` | las 23 tablas: qué guarda cada una y quién la consume |
| `AXIOM_mapa_codigo.md` | mapa del código y auditoría de deuda |
| `AXIOM_arquitectura_capas.md` | la capa de dominio en detalle |
| `docs/code/` | corpus CODE: diseño formal del sistema cuantitativo |

**Advertencia sobre el mapa de código:** clasificó `market.js` y `capital.js`
como "pantallas huérfanas" y estuvieron a punto de eliminarse. **No lo eran**:
son componentes que `regime.js` compone. Lección: "sin botón de navegación" no
implica "código muerto". Verificar antes de borrar.

---

## 11. Modo de trabajo con Migue

**Sesiones multi-día.** Lo que parece una conversación continua son varios días
para él. No aplicar "llevamos mucho tiempo".

**No edita código a mano.** Recibe archivos completos o cambios aplicados
directamente, más los comandos a ejecutar.

**Antes de tocar backend o base, inferir el estado desde el repo** (migraciones
numeradas, routers, servicios) en vez de pedir dumps.

**Verificar antes de eliminar.** Dos veces el diagnóstico previo estaba
equivocado y se estuvo a punto de borrar código vivo.

**Decir la verdad sobre los trade-offs.** Migue toma mejores decisiones con la
información completa, y varias veces cambió de rumbo al ver los datos —
descartó sumar exchanges cuando midió que cinco aportaban 49 monedas, y descartó
el ranking por capitalización cuando vio que el volumen del par era mejor señal.
Su frase: *"los datos demuestran; que AXIOM nos pueda decir «esto es lo real»"*.

---

## 12. Estado actual (29/07/2026)

**Funcionando:** capa de dominio · régimen (12 señales, 3 temporalidades) ·
gráficos con precio en vivo unificado · adaptadores de exchange propios (sin
CCXT) · screener de pares con las 3 métricas y spread · Kepler (Gemini) leyendo
del registro de capacidades · 11 capacidades declaradas · núcleo de widgets +
widget `tabla_pares`.

**Frentes abiertos** (detalle y orden en `AXIOM_estado_y_foco.md`):
- migrar el resto de vistas a widgets (watchlist con 1.668 líneas es la candidata)
- montaje de widgets desde Kepler (el chat responde con interfaz, no solo texto)
- 265 coins sin clasificar (job de relleno ya escrito, corriendo de noche)
- migrar al registro las capacidades restantes (velas, order book, alertas)
- servidor MCP: **descartado por ahora** — con Kepler alcanza; la proyección
  `a_mcp()` ya existe si alguna vez hace falta
