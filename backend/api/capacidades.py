"""
AXIOM — API del Registro de Capacidades.
════════════════════════════════════════════════════════════════════════════
Expone el catálogo de capacidades por HTTP. Es lo que permite que CUALQUIER
consumidor —el frontend actual, un futuro cliente Flutter, una herramienta
externa— descubra qué sabe hacer AXIOM sin tenerlo cableado.

  GET  /api/capacidades/            → catálogo completo (filtrable)
  GET  /api/capacidades/categorias  → categorías disponibles
  GET  /api/capacidades/{nombre}    → contrato de una capacidad
  POST /api/capacidades/{nombre}    → ejecutarla
  GET  /api/capacidades/_/formatos/function-calling → proyección para el chat
  GET  /api/capacidades/_/formatos/mcp              → proyección para MCP

Ver AXIOM_registro_capacidades.md.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, Request, HTTPException, Query

from backend.domain.registry import (
    registro, CapacidadDesconocida, ArgumentosInvalidos,
)

router = APIRouter(prefix="/api/capacidades", tags=["capacidades"])
logger = logging.getLogger(__name__)


@router.get("/")
async def listar(
    categoria: str = Query("", description="Filtrar por categoría"),
    costo: str = Query("", description="barato | medio | caro"),
    entidad: str = Query("", description="mercado | coin | par | watchlist | sistema"),
):
    """
    Catálogo de capacidades con su contrato completo, incluida la declaración
    epistémica (qué mide, qué infiere, qué no puede saber).
    """
    caps = registro.listar(categoria=categoria, costo=costo, entidad=entidad)
    return {"total": len(caps), "capacidades": caps}


@router.get("/categorias")
async def categorias():
    return {"categorias": registro.categorias()}


@router.get("/_/formatos/function-calling")
async def formato_function_calling(categoria: str = ""):
    """
    El catálogo proyectado al formato de function calling (Gemini/OpenAI).
    Es lo que consume Kepler en vez de tener las tools cableadas.
    """
    return {"tools": registro.a_function_calling(categoria=categoria)}


@router.get("/_/formatos/mcp")
async def formato_mcp():
    """El catálogo proyectado al formato de tools de un servidor MCP."""
    return {"tools": registro.a_mcp()}


@router.get("/{nombre}")
async def describir(nombre: str):
    """Contrato completo de una capacidad."""
    try:
        return registro.describir(nombre)
    except CapacidadDesconocida as e:
        raise HTTPException(404, str(e))


@router.post("/{nombre}")
async def ejecutar(nombre: str, request: Request, args: dict | None = None):
    """
    Ejecuta una capacidad. El resultado viene SIEMPRE acompañado de su
    declaración epistémica: qué se midió, qué se infiere y qué no se sabe.
    """
    try:
        return await registro.ejecutar(
            request.app.state.domain,
            request.app.state.db_pool,
            nombre,
            args or {},
        )
    except CapacidadDesconocida as e:
        raise HTTPException(404, str(e))
    except ArgumentosInvalidos as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("[capacidades] error ejecutando %s", nombre)
        raise HTTPException(500, f"error ejecutando {nombre}: {e}")
