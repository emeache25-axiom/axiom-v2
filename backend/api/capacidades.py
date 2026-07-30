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
# Importar dispara el registro de las declaraciones de widgets, que se validan
# contra las capacidades: si un widget consume una capacidad inexistente o
# declara ordenar por una columna que ella no admite, el servicio no arranca.
import backend.domain.widgets  # noqa: F401

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


@router.get("/_/widgets")
async def listar_widgets(
    contexto: str = Query("", description="pantalla | panel | chat | dashboard"),
    capacidad: str = Query("", description="Filtrar por la capacidad que consumen"),
):
    """
    Catálogo de widgets: qué existe, qué capacidad consume cada uno y qué
    muestra en cada densidad.

    Vive en el backend porque son DATOS, no código de plataforma: la decisión
    de qué información sobrevive en pantalla chica debería ser la misma en la
    web y en cualquier otro cliente. Lo único específico de cada plataforma es
    el render.
    """
    from backend.domain.widgets import registro_widgets
    w = registro_widgets.listar(contexto=contexto, capacidad=capacidad)
    return {"total": len(w), "widgets": w}


@router.get("/_/categorias/estado")
async def estado_categorias(request: Request):
    """
    Cuántas coins están sin clasificar y cuánta capitalización representan.
    'otros' no es un sector: es ausencia de clasificación, y ensucia el mapa.
    """
    from backend.services.categorias_fill import estado
    return await estado(request.app.state.db_pool)


@router.post("/_/categorias/reclasificar")
async def reclasificar_categorias(request: Request):
    """
    Recalcula las supercategorías con el mapeo vigente, SIN llamar a ninguna
    API: usa las categorías ya guardadas.

    Es lo que hay que correr después de tocar el mapeo en coins_sync. Cambiar
    cómo se traducen las categorías no debería costar volver a descargar
    2.400 fichas.
    """
    from backend.services.categorias_fill import reclasificar
    return await reclasificar(request.app.state.db_pool)


@router.post("/_/categorias/completar")
async def completar_categorias_endpoint(
    request: Request,
    limite: int = Query(300, ge=1, le=1000,
                        description="Máximo de coins a procesar en esta corrida"),
):
    """
    Rellena las categorías que el scraping semanal no logró obtener, usando la
    API de CoinGecko. Unos 2,2 s por coin: 234 coins ≈ 8 minutos.
    """
    from backend.services.categorias_fill import completar_categorias
    return await completar_categorias(request.app.state.db_pool, limite=limite)


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
