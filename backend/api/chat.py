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

Las herramientas son capacidades que YA existen — no se reimplementa nada:
  - regimen_mercado  → Mercado.regimen_global()
  - analizar_coin    → Coin.overview(metadata + regimen_relativo)

Proveedor: Google Gemini (nivel gratuito, sin tarjeta).
Requiere GEMINI_API_KEY en el .env — se obtiene en aistudio.google.com/apikey
"""
from __future__ import annotations
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
_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"
_TIMEOUT = 60.0
_MAX_VUELTAS = 5      # tope de iteraciones del bucle de function calling


# ── Declaración de las herramientas (lo que el modelo puede pedir) ────────────

FUNCIONES = [
    {
        "name": "regimen_mercado",
        "description": (
            "Devuelve el régimen actual del mercado cripto calculado por AXIOM, "
            "en tres temporalidades (largo, medio, corto plazo). Cada una trae el "
            "régimen (ACUMULACION, ALCISTA, DISTRIBUCION, BAJISTA, LATERAL) y su "
            "nivel de convicción (0-100). Es el clima general del mercado, medido "
            "sobre Bitcoin como proxy. Usar cuando se pregunte por el estado del "
            "mercado, el ciclo, o el contexto general."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "analizar_coin",
        "description": (
            "Analiza cómo se sitúa una criptomoneda concreta en el mercado actual. "
            "Devuelve: metadata (precio, market cap, ranking, categoría), el contexto "
            "global (régimen del mercado), la posición sectorial (cómo viene el sector "
            "de esa coin y su ranking de fuerza entre todos los sectores) y la fuerza "
            "relativa vs Bitcoin (si le gana o pierde a BTC, con lectura "
            "lider/neutral/rezagada). Usar cuando se pregunte por una coin puntual."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "coin_id": {
                    "type": "string",
                    "description": (
                        "El id de CoinGecko de la coin, en minusculas y con guiones. "
                        "Ejemplos: 'bitcoin', 'ethereum', 'ontology', 'solana', "
                        "'oasis-network', 'decentraland', 'dogecoin'. "
                        "NO usar el simbolo (ONT, ETH) sino el id completo."
                    ),
                }
            },
            "required": ["coin_id"],
        },
    },
]

SYSTEM_PROMPT = """Sos Kepler, el asistente analitico de AXIOM, el cockpit de trading cripto de Migue.

Tenes acceso a las herramientas del propio sistema: el regimen de mercado que AXIOM calcula y el analisis situacional de cualquier coin. Usalas para responder con datos reales del sistema, no con conocimiento general. Si la pregunta requiere datos del mercado, llama a la herramienta correspondiente antes de responder.

Pautas:
- Responde en espanol rioplatense, directo y sin rodeos.
- Interpreta los datos, no los recites. Migue quiere lectura, no un volcado de JSON.
- Si un dato falta o es ambiguo, decilo en vez de rellenar.
- Se conciso: densidad antes que extension.
- Cuando menciones numeros, dales contexto (que significa esa conviccion, si ese cambio es grande o chico).
"""


# ── Ejecución de las funciones contra la capa de dominio ──────────────────────

async def _ejecutar_funcion(domain, nombre: str, args: dict) -> dict:
    """Traduce un pedido del modelo a una llamada a la capa de dominio."""
    if nombre == "regimen_mercado":
        return await domain.mercado().regimen_global()

    if nombre == "analizar_coin":
        coin_id = (args or {}).get("coin_id", "").strip().lower()
        if not coin_id:
            return {"error": "falta coin_id"}
        coin = domain.coin(coin_id)
        data = await coin.overview(["metadata_mercado", "regimen_relativo"])
        if not data.get("metadata_mercado"):
            return {"error": f"no encuentro la coin '{coin_id}' en la base de AXIOM"}
        return data

    return {"error": f"herramienta desconocida: {nombre}"}


# ── Endpoint ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    mensaje: str
    historial: list = []      # contents de turnos previos (formato Gemini)


@router.post("/")
async def chat(request: Request, body: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(500, "Falta GEMINI_API_KEY en el .env")

    domain = request.app.state.domain

    # Historial + mensaje nuevo (formato Gemini: contents con role user/model)
    contents = list(body.historial or [])
    contents.append({"role": "user", "parts": [{"text": body.mensaje}]})

    payload_base = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "tools": [{"functionDeclarations": FUNCIONES}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2000},
    }

    tools_usadas = []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for _ in range(_MAX_VUELTAS):
            payload = dict(payload_base, contents=contents)
            r = await client.post(
                f"{_API_URL}?key={api_key}",
                headers={"content-type": "application/json"},
                json=payload,
            )
            if r.status_code != 200:
                detalle = r.text[:300]
                logger.error("[chat] API %s: %s", r.status_code, r.text[:800])
                raise HTTPException(
                    502, f"Error de la API de Gemini ({r.status_code}): {detalle}")

            data = r.json()
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
                        salida = await _ejecutar_funcion(domain, nombre, args)
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
    return {
        "modelo": _MODEL,
        "tools": [{"name": f["name"], "description": f["description"]} for f in FUNCIONES],
    }
