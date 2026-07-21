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
    {
        "name": "buscar_coins",
        "description": (
            "Busca criptomonedas en el universo de AXIOM (~1750 coins) segun filtros. "
            "Tiene tres modos: "
            "'basic' filtra por categoria, variacion de precio y capitalizacion (sirve "
            "para 'coins de DeFi que subieron esta semana'). "
            "'volatility' encuentra pares con VOLATILIDAD ESTRUCTURAL: coins cuyo rango "
            "diario (high-low) supera un umbral en un alto porcentaje de las velas de los "
            "ultimos 30 dias. Es el modo indicado para buscar pares que OSCILAN de forma "
            "repetible, ideales para range trading o compra-venta en rangos chicos. "
            "'open_high' encuentra coins con impulso repetido desde la apertura al maximo. "
            "Devuelve la lista de coins que cumplen, con sus metricas."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "modo": {
                    "type": "string",
                    "enum": ["basic", "volatility", "open_high"],
                    "description": "Modo de busqueda. Por defecto 'basic'.",
                },
                "supercat": {
                    "type": "string",
                    "description": (
                        "Categoria a filtrar (opcional). Valores: bitcoin, "
                        "smart_platforms, layer2, stablecoins, defi, rwa, exchange, ai, "
                        "memes, gaming, privacy, infrastructure, desoc, staking, "
                        "payments, political. Vacio = todas."
                    ),
                },
                "min_mcap": {
                    "type": "number",
                    "description": "Capitalizacion minima en USD (opcional).",
                },
                "max_mcap": {
                    "type": "number",
                    "description": (
                        "Capitalizacion maxima en USD (opcional). Para baja capitalizacion "
                        "usar por ejemplo 100000000 (100 millones)."
                    ),
                },
                "min_change": {
                    "type": "number",
                    "description": "Variacion minima en 24h, en % (opcional).",
                },
                "max_change": {
                    "type": "number",
                    "description": "Variacion maxima en 24h, en % (opcional).",
                },
                "min_range": {
                    "type": "number",
                    "description": (
                        "Solo modos volatility/open_high: rango minimo por vela en % "
                        "(ej. 3 = velas que se mueven al menos 3%). Por defecto 3."
                    ),
                },
                "min_pct_ok": {
                    "type": "number",
                    "description": (
                        "Solo modos volatility/open_high: porcentaje minimo de velas que "
                        "deben cumplir el rango (ej. 80 = el 80% de los dias). Por defecto 80."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Cantidad maxima de resultados (por defecto 20, maximo 50).",
                },
            },
        },
    },
    {
        "name": "coins_sugeridas",
        "description": (
            "Devuelve las coins que AXIOM sugiere HOY segun el regimen de mercado "
            "vigente, en tres canastas: largo plazo (12-36 meses, DCA en BTC/ETH/SOL), "
            "medio plazo (2-12 semanas, altcoins con catalizador) y corto plazo (horas a "
            "dias, alta volatilidad estructural para range trading). Incluye el contexto "
            "del regimen, nivel de riesgo y notas operativas por temporalidad. Usar cuando "
            "se pregunte que comprar, que mirar, o que sugiere el sistema."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "mi_watchlist",
        "description": (
            "Devuelve los pares que Migue tiene en su lista de seguimiento, con su "
            "exchange, simbolo del par, si es operable y si tiene bot activo. Usar cuando "
            "pregunte por 'mis pares', 'mi watchlist', 'lo que sigo'."
        ),
        "parameters": {"type": "object", "properties": {}},
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

class _Req:
    """Shim mínimo: el endpoint del screener espera un Request de FastAPI y solo
    usa `request.app.state.db_pool`. Se lo damos sin montar un request real."""
    def __init__(self, pool):
        self.app = type("A", (), {"state": type("S", (), {"db_pool": pool})()})()


async def _ejecutar_funcion(domain, pool, nombre: str, args: dict) -> dict:
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

    if nombre == "buscar_coins":
        from backend.api.watchlist import screener as _screener
        a = args or {}
        modo = a.get("modo") or "basic"
        limit = min(int(a.get("limit") or 20), 50)
        # sort_by por defecto según el modo
        sort_by = {"volatility": "avg_range_pct",
                   "open_high":  "avg_oh_pct"}.get(modo, "rank")
        sort_dir = "asc" if modo == "basic" else "desc"
        return await _screener(
            request=_Req(pool),
            type=modo,
            supercat=a.get("supercat") or "",
            min_change=float(a.get("min_change", -999)),
            max_change=float(a.get("max_change", 999)),
            min_mcap=float(a.get("min_mcap", 0)),
            max_mcap=float(a.get("max_mcap", 1e15)),
            sort_by=sort_by,
            sort_dir=sort_dir,
            min_range=float(a.get("min_range", 3.0)),
            min_pct_ok=float(a.get("min_pct_ok", 80.0)),
            min_candles=20,
            limit=limit,
        )

    if nombre == "coins_sugeridas":
        from backend.services.selection_service import get_asset_selection
        return await get_asset_selection(pool)

    if nombre == "mi_watchlist":
        # Usa la capacidad de dominio (maneja la columna `grupo` opcional y
        # devuelve operable/bot_enabled). Se enriquece con datos de mercado.
        pares = await domain.watchlist().pares_seguidos()
        if not pares:
            return {"total": 0, "pares": []}
        ids = [p["coin_id"] for p in pares if p.get("coin_id")]
        mercado = {}
        if ids:
            async with pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT id, symbol, name, price, change_24h, change_7d,
                           market_cap, rank, supercat
                    FROM coins WHERE id = ANY($1::text[])
                """, ids)
            mercado = {r["id"]: r for r in rows}

        def _f(v):
            return float(v) if v is not None else None

        salida = []
        for p in pares:
            m = mercado.get(p.get("coin_id"))
            salida.append({
                "coin_id":     p.get("coin_id"),
                "symbol":      (m["symbol"].upper() if m and m["symbol"]
                                else (p.get("symbol") or "").upper()),
                "name":        m["name"] if m else None,
                "par":         p.get("pair_symbol"),
                "exchange":    p.get("exchange"),
                "quote":       p.get("quote"),
                "operable":    p.get("operable"),
                "bot_activo":  p.get("bot_enabled"),
                "grupo":       p.get("grupo"),
                "precio_usd":  _f(m["price"]) if m else None,
                "change_24h":  _f(m["change_24h"]) if m else None,
                "change_7d":   _f(m["change_7d"]) if m else None,
                "market_cap":  _f(m["market_cap"]) if m else None,
                "rank":        m["rank"] if m else None,
                "sector":      m["supercat"] if m else None,
            })
        return {"total": len(salida), "pares": salida}

    return {"error": f"herramienta desconocida: {nombre}"}


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
        "tools": [{"functionDeclarations": FUNCIONES}],
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
    return {
        "modelo": _MODEL,
        "modelos_respaldo": _MODELOS_RESPALDO,
        "tools": [{"name": f["name"], "description": f["description"]} for f in FUNCIONES],
    }
