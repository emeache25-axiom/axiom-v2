"""
AXIOM v2 — Chat conversacional (prototipo v3).
════════════════════════════════════════════════════════════════════════════
Mesa de análisis: se le pregunta a AXIOM en lenguaje natural y el asistente
responde consultando las CAPACIDADES DE LA CAPA DE DOMINIO como herramientas
(function calling).

El bucle:
  1. El usuario manda un mensaje.
  2. Se llama a la API con las funciones declaradas.
  3. Si el modelo pide una función → se ejecuta contra la capa de dominio.
  4. Se le devuelve el resultado y el modelo responde (o pide otra).
  5. Se retorna el texto final.

Las herramientas NO se declaran acá: se descubren del REGISTRO DE CAPACIDADES
(`backend/domain/registry.py`), donde cada capacidad declara su contrato junto a
su propio código. Agregar una capacidad al dominio y que Kepler la conozca son
el mismo acto — no hay lista que mantener sincronizada.

Cada capacidad declara, además de su firma técnica, qué MIDE (hecho), qué
INFIERE (lectura) y qué NO PUEDE SABER (límites). Eso viaja con la descripción
de la herramienta Y con cada resultado, de modo que el modelo no pueda presentar
una inferencia como si fuera un hecho medido.

Proveedor: Google Gemini (nivel gratuito, sin tarjeta).
Requiere GEMINI_API_KEY en el .env — se obtiene en aistudio.google.com/apikey
"""
from __future__ import annotations
import asyncio
import os
import json
import logging

import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# gemini-flash-latest apunta siempre al modelo Flash vigente: evita quedar atado
# a una versión que Google cierre para usuarios nuevos (le pasó a gemini-2.5-flash).
_MODEL   = "gemini-flash-latest"
# Si el principal está saturado (503), se prueba con estos, en orden.
_MODELOS_RESPALDO = ["gemini-2.0-flash", "gemini-flash-lite-latest"]
_REINTENTOS = 3          # intentos por modelo ante 503/429
_ESPERA_BASE = 1.5       # segundos; crece en cada reintento
_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def _url(modelo: str) -> str:
    return f"{_API_BASE}/{modelo}:generateContent"
_TIMEOUT = 60.0
_MAX_VUELTAS = 5      # tope de iteraciones del bucle de function calling


# ── Herramientas: se descubren del REGISTRO DE CAPACIDADES ────────────────────
# Antes estaban cableadas acá a mano, lo que garantizaba desincronización: la
# tool `buscar_coins` describía un modo de screener que ya se había eliminado.
# Ahora el catálogo se proyecta desde el registro, donde cada capacidad declara
# su contrato junto a su propio código. Agregar una capacidad y que Kepler la
# conozca son el MISMO acto. Ver AXIOM_registro_capacidades.md.

from backend.domain.registry import (
    registro, CapacidadDesconocida, ArgumentosInvalidos,
)
# Importar los módulos que declaran capacidades para que se registren al
# levantar la app (el decorador registra en tiempo de import).
import backend.domain.sistema  # noqa: F401


def _funciones() -> list[dict]:
    """
    Catálogo vigente en formato function calling. Se consulta en cada request:
    si se agregó una capacidad, Kepler la ve sin reiniciar nada más que la app.

    Cada descripción incluye el bloque MIDE / INFIERE / NO PUEDE SABER, para que
    el modelo tenga la distinción entre hecho e inferencia ANTES de elegir la
    herramienta, no solo al recibir el resultado.
    """
    return registro.a_function_calling()


SYSTEM_PROMPT = """Sos Kepler, el asistente analitico de AXIOM, el cockpit de trading cripto de Migue.

Tenes acceso a las capacidades del propio sistema como herramientas. Usalas para responder con datos reales de AXIOM, no con conocimiento general. Si la pregunta requiere datos de mercado, llama a la herramienta correspondiente antes de responder.

════ RIGOR: lo que distingue a AXIOM ════
Cada herramienta declara tres cosas, y cada resultado vuelve acompañado de ellas:
  MIDE     — el hecho verificable: paso, es dato duro.
  INFIERE  — la lectura o interpretacion: NO es un hecho.
  NO SABE  — los limites: lo que esa capacidad no puede afirmar.

Reglas que no se negocian:
1. NUNCA presentes una inferencia con la misma certeza que una medicion. Si el
   dato es medido, afirmalo. Si es una lectura, marcala como tal ("sugiere",
   "el perfil indica", "es candidato a").
2. Si el resultado trae limites relevantes en NO SABE, decilos. Callar lo que no
   se sabe es una forma de mentir.
3. NO des consejos de compra o venta. AXIOM analiza; Migue decide. En vez de
   "compra X", decir "X muestra tal cosa medida, lo que sugiere tal perfil, con
   la salvedad de que...".
4. Si un dato falta o es ambiguo, decilo en vez de rellenar. "No hay velas
   suficientes para calcular esto" es una respuesta completa y correcta.
5. Cuando cites un numero, decí de donde sale y sobre que ventana se midio si
   viene en el resultado.

════ FLUJO: resolver el par antes de pedir datos de par ════

Pregunta ABIERTA sobre una coin — distinguí la intención:

  · "¿cómo viene X?", "¿cómo está?", "¿fuerte o débil?", "qué onda X" → SITUACIÓN
    de mercado: usá analizar_coin (régimen, sector, fuerza vs BTC).
  · "¿qué es X?", "de qué se trata", "info del proyecto", "para qué sirve" →
    PROYECTO: usá info_proyecto (qué hace, supply, historia, links).
  · "contame de X", "hablame de X" (amplio, sin pedir una cosa puntual) → LAS DOS:
    info_proyecto Y analizar_coin. Se montan las dos tarjetas; en tu texto conectá
    lo que son con cómo vienen, en pocas líneas.

NO dispares velas, libro ni otras vistas por tu cuenta ante una pregunta abierta
—eso hace que la misma pregunta dé respuestas distintas según la vuelta—. Al
terminar, OFRECÉ profundizar en una línea: "si querés te muestro el gráfico de
velas, el libro de órdenes, o en qué pares se opera". Que Migue elija.

Solo pedí velas/libro/precio cuando Migue lo pide EXPLÍCITO ("mostrame las velas
de ONT", "el libro de ADA", "precio de ONT en MEXC"). Ahí sí, directo.
Las capacidades de PAR (velas_par, libro_par, precio_par, estado_grafico)
necesitan saber coin_id + exchange + quote. El usuario casi nunca los dice
todos: pide "las velas de ONT" o "el libro de ontology", sin exchange ni quote.

NO inventes exchange ni quote. Resolvelos con la herramienta:

1. Si te piden velas, libro o precio de una coin y no está claro exchange+quote,
   llama PRIMERO a resolver_par con el coin_id. Devuelve dos listas:
     - en_watchlist: los pares de esa coin que Migue ya sigue.
     - candidatos:   pares tradeables del catálogo, ordenados por volumen.
2. Si en_watchlist trae un par, usá ESE (es lo que Migue sigue). Si trae varios,
   usá el primero —es el orden que Migue definió— y mencioná que hay otros por si
   quería otro.
3. Si en_watchlist viene vacío y hay candidatos, NO elijas a ciegas: mostrale los
   candidatos (exchange, quote, volumen) y pedile que elija antes de seguir.
4. Con el par resuelto (exchange + quote), recién ahí llamá a velas_par / libro_par
   / precio_par. El encadenamiento natural es: resolver_par("ontology") → tomar
   exchange+quote → velas_par(coin_id, exchange, quote, ...).

No le pidas a Migue los datos técnicos (exchange, quote, pair_symbol) que el
sistema puede resolver solo. Resolvé vos y seguí.

Y una nota de rigor sobre el libro (libro_par): la profundidad visible NO es
liquidez garantizada —puede haber órdenes falsas que se retiran— y es una foto de
un instante. Mostralo como lo que es, nunca como base para decir "hay que entrar
acá".

════ ESTILO ════
- Espanol rioplatense, directo y sin rodeos.
- Interpreta los datos, no los recites: lectura, no volcado de JSON.
- Conciso: densidad antes que extension.
- Da contexto a los numeros (que significa esa conviccion, si ese cambio es
  grande o chico para ese activo).
- Respondé en Markdown: usá TABLA cuando compares varios pares o coins, LISTA
  para enumerar señales o items, y **negrita** para los valores medidos clave.
  La pantalla lo renderiza como HTML.
- REGLA GENERAL de las vistas: muchas capacidades que devuelven una tabla, una
  lista, un gráfico o un ranking se PINTAN SOLAS como una vista visual debajo de
  tu texto (un widget). Cuando una capacidad tiene esa vista, NO vuelques sus
  datos en texto —ni tablas, ni listas de filas, ni los valores uno por uno—: el
  widget ya los muestra y repetirlos es ruido. Tu trabajo ahí es la LECTURA, no
  el volcado: una o dos líneas interpretando lo que se ve (qué lidera, si algo
  salta, qué rango, hacia dónde va), y dejás que la vista hable.
  Hoy tienen vista propia: buscar_pares (screener), top_coins (ranking de coins),
  velas_par (gráfico de velas), libro_par (libro de órdenes), mi_watchlist,
  regimen_mercado, mapa_sectores, coins_sugeridas, analizar_coin (tarjeta de
  situación: régimen, fuerza vs BTC, sector), info_proyecto (ficha: descripción,
  supply, ATH/ATL, links). Cualquiera nueva con tabla o gráfico probablemente
  también.
  PERO OJO: las que NO tienen vista —noticias, pares_de_coin, precio_par— NO se
  muestran solas. Ahí SÍ tenés que dar la respuesta completa en texto: si te
  callás, Migue no ve nada. La regla es "no dupliques lo que el widget ya
  muestra", no "no expliques".
- Dos matices que no se deducen solos:
    · El SELECTOR de par (resolver_par cuando no elegiste par) no es "no
      dupliques": es "no elijas por tu cuenta". Preguntá breve en qué par lo mira
      y dejá que el selector aparezca. Si resolver_par ya te dio un par y lo vas a
      usar, ni menciones que había que elegir: seguí directo.
    · El libro de órdenes: al leerlo, recordá que la profundidad visible NO es
      liquidez garantizada (puede haber órdenes que se retiran) y es una foto de
      un instante. Nunca lo presentes como base para "entrá acá".

════ GANADORAS / PERDEDORAS: pares, no coins ════
"Las que más suben / bajan", "top ganadoras", "qué se está moviendo": por
defecto son PARES OPERABLES, no coins. AXIOM opera pares — lo relevante es qué
se puede tradear que se mueve. Usá buscar_pares con orden='cambio': dir='desc'
para las que más suben, dir='asc' para las que más bajan. Poné un min_volumen
razonable (ej. 50000) para no traer pares muertos de baja liquidez.

Usá top_coins (coins de CoinGecko) SOLO si piden explícito el "mercado global",
"las coins más grandes/que más subieron del mercado", o dicen "coins" en vez de
pares. Ahí el universo es el catálogo entero, operable o no — y avisá que puede
incluir activos no operables en MEXC/CoinEx.
"""


# ── Ejecución: despacha contra el registro ────────────────────────────────────

async def _ejecutar_funcion(domain, pool, nombre: str, args: dict) -> dict:
    """
    Ejecuta una capacidad por nombre. Ya no hay cadena de `if`: el registro sabe
    construir la entidad y despachar.

    El resultado vuelve con su declaracion epistemica adjunta, de modo que el
    modelo recibe SIEMPRE, junto a los numeros, que se midio y que se infiere.
    """
    try:
        return await registro.ejecutar(domain, pool, nombre, args or {})
    except CapacidadDesconocida as e:
        return {"error": str(e)}
    except ArgumentosInvalidos as e:
        return {"error": str(e)}
    except Exception as e:
        logger.exception("[chat] error ejecutando capacidad %s", nombre)
        return {"error": f"la capacidad '{nombre}' fallo: {e}"}


# ── Endpoint ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    mensaje: str
    historial: list = []      # contents de turnos previos (formato Gemini)


async def _llamar_api(client, payload: dict, api_key: str) -> dict:
    """
    Llama a Gemini tolerando la saturación típica del nivel gratuito.
    Ante 503 (modelo saturado) o 429 (cuota por minuto) reintenta con espera
    creciente; si el modelo principal sigue sin responder, prueba los de respaldo.
    Cualquier otro error se propaga de inmediato (no tiene sentido reintentar).
    """
    ultimo = None
    for modelo in [_MODEL] + _MODELOS_RESPALDO:
        for intento in range(_REINTENTOS):
            r = await client.post(
                f"{_url(modelo)}?key={api_key}",
                headers={"content-type": "application/json"},
                json=payload,
            )
            if r.status_code == 200:
                if modelo != _MODEL:
                    logger.info("[chat] respondido por modelo de respaldo: %s", modelo)
                return r.json()

            ultimo = (r.status_code, r.text[:300])

            if r.status_code in (503, 429):
                # Saturación o límite de ritmo: esperar y reintentar
                espera = _ESPERA_BASE * (2 ** intento)
                logger.warning("[chat] %s en %s; reintento en %.1fs",
                               r.status_code, modelo, espera)
                await asyncio.sleep(espera)
                continue

            # Error no recuperable (400, 404, 401...): cortar acá
            logger.error("[chat] API %s: %s", r.status_code, r.text[:800])
            raise HTTPException(
                502, f"Error de la API de Gemini ({r.status_code}): {r.text[:300]}")

        logger.warning("[chat] %s agotó reintentos; probando siguiente modelo", modelo)

    code, detalle = ultimo if ultimo else (0, "sin respuesta")
    raise HTTPException(
        503,
        "Los modelos de Gemini están saturados en este momento (nivel gratuito). "
        f"Probá de nuevo en un rato. Último error: {code} {detalle}")


@router.post("/")
async def chat(request: Request, body: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(500, "Falta GEMINI_API_KEY en el .env")

    domain = request.app.state.domain
    pool = request.app.state.db_pool

    # Historial + mensaje nuevo (formato Gemini: contents con role user/model)
    contents = list(body.historial or [])
    contents.append({"role": "user", "parts": [{"text": body.mensaje}]})

    payload_base = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        # Catálogo vigente del registro, no una lista fija.
        "tools": [{"functionDeclarations": _funciones()}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2000},
    }

    tools_usadas = []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for _ in range(_MAX_VUELTAS):
            payload = dict(payload_base, contents=contents)
            data = await _llamar_api(client, payload, api_key)
            cands = data.get("candidates") or []
            if not cands:
                raise HTTPException(502, "Respuesta vacia del modelo")

            parts = (cands[0].get("content") or {}).get("parts") or []

            # ¿Pidió funciones?
            llamadas = [p["functionCall"] for p in parts if "functionCall" in p]

            if llamadas:
                # Guardar el turno del modelo (con los functionCall)
                contents.append({"role": "model", "parts": parts})

                # Ejecutar cada función pedida y devolver los resultados
                respuestas = []
                for fc in llamadas:
                    nombre = fc.get("name")
                    args   = fc.get("args") or {}
                    try:
                        salida = await _ejecutar_funcion(domain, pool, nombre, args)
                    except Exception as e:
                        logger.warning("[chat] funcion %s fallo: %s", nombre, e)
                        salida = {"error": str(e)}

                    # El registro devuelve {capacidad, resultado, epistemico}.
                    # Se separan para que el frontend pueda montar un widget con
                    # los datos que el modelo efectivamente analizó — si tuviera
                    # que pedirlos de nuevo podría recibir otros (los tickers se
                    # refrescan cada 15 min) y el texto diría una cosa mientras
                    # el widget muestra otra.
                    #
                    # El backend NO decide qué widget usar: no conoce el catálogo
                    # del frontend. Solo informa qué capacidad corrió y qué dio.
                    tools_usadas.append({
                        "tool":       nombre,
                        "input":      args,
                        "resultado":  salida.get("resultado") if isinstance(salida, dict) else salida,
                        "epistemico": salida.get("epistemico") if isinstance(salida, dict) else None,
                    })

                    # Gemini espera el resultado envuelto en functionResponse.
                    # Se serializa/deserializa para garantizar tipos JSON puros.
                    limpio = json.loads(json.dumps({"resultado": salida},
                                                   ensure_ascii=False, default=str))
                    respuestas.append({
                        "functionResponse": {"name": nombre, "response": limpio}
                    })
                contents.append({"role": "user", "parts": respuestas})
                continue    # otra vuelta: que el modelo interprete los resultados

            # Sin funciones pendientes → respuesta final
            texto = "".join(p.get("text", "") for p in parts if "text" in p)
            contents.append({"role": "model", "parts": parts})
            return {
                "respuesta": texto.strip(),
                "tools_usadas": tools_usadas,
                "historial": contents,
            }

    raise HTTPException(500, "El bucle de herramientas no termino (demasiadas vueltas)")


@router.get("/tools")
async def listar_tools():
    """Qué herramientas tiene disponibles el chat (para inspección)."""
    caps = registro.listar()
    return {
        "modelo": _MODEL,
        "modelos_respaldo": _MODELOS_RESPALDO,
        "origen": "registro de capacidades",
        "total": len(caps),
        "tools": [
            {
                "name": c["nombre"],
                "description": c["descripcion"],
                "categoria": c["categoria"],
                "costo": c["costo"],
                "epistemico": c["epistemico"],
            }
            for c in caps
        ],
    }
