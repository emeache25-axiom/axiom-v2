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

════ ESTILO ════
- Espanol rioplatense, directo y sin rodeos.
- Interpreta los datos, no los recites: lectura, no volcado de JSON.
- Conciso: densidad antes que extension.
- Da contexto a los numeros (que significa esa conviccion, si ese cambio es
  grande o chico para ese activo).
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
                    tools_usadas.append({"tool": nombre, "input": args})
                    try:
                        salida = await _ejecutar_funcion(domain, pool, nombre, args)
                    except Exception as e:
                        logger.warning("[chat] funcion %s fallo: %s", nombre, e)
                        salida = {"error": str(e)}
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
