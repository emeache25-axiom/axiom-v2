"""
AXIOM — Registro de Capacidades.
════════════════════════════════════════════════════════════════════════════
Fuente única de verdad sobre QUÉ sabe hacer AXIOM y CÓMO se invoca.

Cada capacidad de la capa de dominio declara su contrato junto a su propio
código, con el decorador `@capacidad`. El registro las cataloga y las despacha.
Los consumidores (Kepler, REST, un futuro Flutter, un eventual servidor MCP)
solo preguntan "¿qué hay?" y dicen "ejecutá esto" — no saben nada más.

Ver AXIOM_registro_capacidades.md (diseño) y AXIOM_principios_fundacionales.md
(los principios que este módulo hace cumplir por contrato).

REGLA CENTRAL — el bloque epistémico es OBLIGATORIO para TODAS las capacidades,
sin excepción. Motivo (decisión de Migue): hoy sabemos qué tiene AXIOM, pero no
qué tendrá. Un criterio del tipo "obligatorio solo para las que calculan" exige
clasificar cada capacidad futura contra una frontera, y con el tiempo esas
discusiones se resuelven por conveniencia, no por criterio. La regla universal
se aplica sola, hoy y dentro de dos años.

Una declaración incompleta hace fallar el ARRANQUE, no el runtime: un contrato
mal declarado es un error de programación, no una advertencia que se ignora.
"""
from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)


# ══ Errores ═══════════════════════════════════════════════════════════════════

class ContratoInvalido(Exception):
    """Una capacidad se declaró con el contrato incompleto o incoherente."""


class CapacidadDesconocida(Exception):
    """Se pidió ejecutar o describir una capacidad que no está registrada."""


class ArgumentosInvalidos(Exception):
    """Los argumentos no cumplen lo declarado en el contrato."""


# ══ Tipos del contrato ════════════════════════════════════════════════════════

# Tipos admitidos para los parámetros. Se mapean a JSON Schema para las
# proyecciones (function calling, MCP, OpenAPI).
_TIPOS_JSON = {
    str:   "string",
    int:   "integer",
    float: "number",
    bool:  "boolean",
    list:  "array",
    dict:  "object",
}

# Entidades de dominio sobre las que puede colgar una capacidad, y qué
# parámetros necesita cada una para construirse.
ENTIDADES = {
    "mercado":   (),                                  # domain.mercado()
    "coin":      ("coin_id",),                        # domain.coin(coin_id)
    "par":       ("coin_id", "exchange", "quote"),    # domain.coin().par()
    "watchlist": (),                                  # domain.watchlist()
    "sistema":   (),                                  # función libre (recibe pool)
}

COSTOS = ("barato", "medio", "caro")


@dataclass(frozen=True)
class Param:
    """Un parámetro de una capacidad."""
    nombre: str
    tipo: type
    descripcion: str
    requerido: bool = False
    opciones: tuple = ()            # valores admitidos (enum), si aplica
    default: Any = None
    ejemplos: tuple = ()

    def a_json_schema(self) -> dict:
        esquema: dict = {
            "type": _TIPOS_JSON.get(self.tipo, "string"),
            "description": self.descripcion,
        }
        if self.opciones:
            esquema["enum"] = list(self.opciones)
        if self.ejemplos:
            # Ayuda al modelo a inferir el formato esperado
            esquema["description"] += f" Ejemplos: {', '.join(map(str, self.ejemplos))}."
        return esquema


@dataclass(frozen=True)
class Capacidad:
    """
    El contrato completo de una capacidad: qué hace, cómo se invoca, y —lo que
    distingue a AXIOM— qué mide, qué infiere y qué NO puede saber.
    """
    # ── Bloque técnico ──
    nombre: str
    descripcion: str
    entidad: str
    categoria: str
    costo: str
    devuelve: str
    parametros: tuple[Param, ...] = ()

    # ── Bloque epistémico (obligatorio; ver AXIOM_principios_fundacionales.md) ──
    mide: str = ""
    infiere: str = ""
    no_sabe: str = ""
    fuente: str = ""
    metodo: str = ""

    # ── Interno ──
    funcion: Callable | None = field(default=None, repr=False, compare=False)

    # ---- Serialización ----

    def a_dict(self) -> dict:
        """Contrato completo, serializable. Lo que ve un consumidor."""
        return {
            "nombre": self.nombre,
            "descripcion": self.descripcion,
            "entidad": self.entidad,
            "categoria": self.categoria,
            "costo": self.costo,
            "devuelve": self.devuelve,
            "parametros": [
                {
                    "nombre": p.nombre,
                    "tipo": _TIPOS_JSON.get(p.tipo, "string"),
                    "descripcion": p.descripcion,
                    "requerido": p.requerido,
                    "opciones": list(p.opciones) or None,
                    "default": p.default,
                    "ejemplos": list(p.ejemplos) or None,
                }
                for p in self.parametros
            ],
            "epistemico": self.epistemico(),
        }

    def epistemico(self) -> dict:
        """
        La declaración epistémica. Viaja SIEMPRE junto al resultado, para que
        ningún consumidor pueda presentar una inferencia como si fuera un hecho.
        """
        return {
            "mide": self.mide,
            "infiere": self.infiere,
            "no_sabe": self.no_sabe,
            "fuente": self.fuente,
            "metodo": self.metodo,
        }


# ══ Validación del contrato ═══════════════════════════════════════════════════

_OBLIGATORIOS_TEXTO = ("descripcion", "devuelve", "mide", "infiere",
                       "no_sabe", "fuente", "metodo")


def _validar(cap: Capacidad) -> None:
    """
    Verifica el contrato. Cualquier incumplimiento lanza ContratoInvalido, que
    al ocurrir en tiempo de import hace fallar el arranque de la app.
    """
    if not cap.nombre or not cap.nombre.replace("_", "").isalnum():
        raise ContratoInvalido(
            f"nombre inválido: {cap.nombre!r} (usar snake_case alfanumérico)")

    if cap.entidad not in ENTIDADES:
        raise ContratoInvalido(
            f"[{cap.nombre}] entidad {cap.entidad!r} desconocida. "
            f"Opciones: {', '.join(ENTIDADES)}")

    if cap.costo not in COSTOS:
        raise ContratoInvalido(
            f"[{cap.nombre}] costo {cap.costo!r} inválido. Opciones: {', '.join(COSTOS)}")

    if not cap.categoria:
        raise ContratoInvalido(f"[{cap.nombre}] falta 'categoria'")

    # Bloque epistémico: obligatorio para TODAS, sin excepción.
    for campo in _OBLIGATORIOS_TEXTO:
        valor = getattr(cap, campo)
        if not valor or not str(valor).strip():
            raise ContratoInvalido(
                f"[{cap.nombre}] falta '{campo}'. El bloque epistémico es "
                f"obligatorio para todas las capacidades: si no aplica, "
                f"declararlo explícitamente (ej. infiere='nada')."
            )

    # REGLA DE ORO: toda inferencia tiene límites. Declarar que se infiere algo
    # sin declarar qué no se sabe es una declaración incompleta.
    infiere_algo = cap.infiere.strip().lower() not in ("nada", "ninguna", "-")
    no_sabe_nada = cap.no_sabe.strip().lower() in ("nada", "ninguno", "-")
    if infiere_algo and no_sabe_nada:
        raise ContratoInvalido(
            f"[{cap.nombre}] declara que infiere ({cap.infiere!r}) pero afirma "
            f"que no_sabe='nada'. Toda inferencia tiene límites: declararlos. "
            f"Ver AXIOM_principios_fundacionales.md §2."
        )

    # Los parámetros de construcción de la entidad deben estar declarados.
    requeridos_entidad = ENTIDADES[cap.entidad]
    declarados = {p.nombre for p in cap.parametros}
    faltan = [p for p in requeridos_entidad if p not in declarados]
    if faltan:
        raise ContratoInvalido(
            f"[{cap.nombre}] entidad '{cap.entidad}' necesita {faltan} para "
            f"construirse; hay que declararlos como parámetros."
        )


# ══ El registro ═══════════════════════════════════════════════════════════════

class RegistroCapacidades:
    """
    Cataloga y despacha. Instancia única: `registro` (abajo).
    """

    def __init__(self):
        self._caps: dict[str, Capacidad] = {}

    # ---- Registro ----

    def registrar(self, cap: Capacidad) -> None:
        _validar(cap)
        if cap.nombre in self._caps:
            raise ContratoInvalido(f"capacidad duplicada: {cap.nombre!r}")
        self._caps[cap.nombre] = cap
        logger.debug("[registro] capacidad registrada: %s", cap.nombre)

    # ---- Consulta ----

    def listar(self, categoria: str = "", costo: str = "",
               entidad: str = "") -> list[dict]:
        """
        Catálogo completo. Es lo que permite que un consumidor DESCUBRA qué hay
        sin saberlo de antemano: agregar capacidades nuevas y que el chat las
        use sin tocarlo.
        """
        out = []
        for cap in sorted(self._caps.values(), key=lambda c: (c.categoria, c.nombre)):
            if categoria and cap.categoria != categoria:
                continue
            if costo and cap.costo != costo:
                continue
            if entidad and cap.entidad != entidad:
                continue
            out.append(cap.a_dict())
        return out

    def describir(self, nombre: str) -> dict:
        return self._obtener(nombre).a_dict()

    def existe(self, nombre: str) -> bool:
        return nombre in self._caps

    def categorias(self) -> list[str]:
        return sorted({c.categoria for c in self._caps.values()})

    def _obtener(self, nombre: str) -> Capacidad:
        cap = self._caps.get(nombre)
        if cap is None:
            raise CapacidadDesconocida(
                f"capacidad {nombre!r} no registrada. "
                f"Disponibles: {', '.join(sorted(self._caps)) or '(ninguna)'}")
        return cap

    # ---- Ejecución ----

    async def ejecutar(self, domain, pool, nombre: str,
                       args: dict | None = None) -> dict:
        """
        Valida argumentos, construye la entidad, invoca la capacidad y devuelve
        el resultado ACOMPAÑADO de su declaración epistémica.

        Que el contrato viaje con el dato es lo que impide que un consumidor
        presente una inferencia como si fuera un hecho: recibe siempre, junto a
        los números, qué se midió, qué se infiere y qué no se sabe.
        """
        cap = self._obtener(nombre)
        args = dict(args or {})
        limpios = self._validar_args(cap, args)

        receptor_args = {k: limpios.pop(k) for k in ENTIDADES[cap.entidad]
                         if k in limpios}
        receptor = self._construir_receptor(domain, pool, cap, receptor_args)

        if receptor is None:      # entidad 'sistema': función libre
            resultado = await cap.funcion(pool, **limpios)
        else:
            resultado = await cap.funcion(receptor, **limpios)

        return {
            "capacidad": cap.nombre,
            "resultado": resultado,
            "epistemico": cap.epistemico(),
        }

    def _validar_args(self, cap: Capacidad, args: dict) -> dict:
        """Verifica requeridos, opciones y tipos; aplica defaults."""
        declarados = {p.nombre: p for p in cap.parametros}

        desconocidos = [k for k in args if k not in declarados]
        if desconocidos:
            raise ArgumentosInvalidos(
                f"[{cap.nombre}] argumentos no declarados: {desconocidos}. "
                f"Admitidos: {list(declarados) or '(ninguno)'}")

        limpios: dict = {}
        for nombre_p, p in declarados.items():
            if nombre_p in args and args[nombre_p] is not None:
                valor = args[nombre_p]
                if p.opciones and valor not in p.opciones:
                    raise ArgumentosInvalidos(
                        f"[{cap.nombre}] {nombre_p}={valor!r} no admitido. "
                        f"Opciones: {list(p.opciones)}")
                # Coerción suave: los modelos suelen mandar números como texto
                if p.tipo in (int, float) and isinstance(valor, str):
                    try:
                        valor = p.tipo(valor)
                    except ValueError:
                        raise ArgumentosInvalidos(
                            f"[{cap.nombre}] {nombre_p}={valor!r} no es {p.tipo.__name__}")
                limpios[nombre_p] = valor
            elif p.requerido:
                raise ArgumentosInvalidos(
                    f"[{cap.nombre}] falta el parámetro requerido {nombre_p!r}")
            elif p.default is not None:
                limpios[nombre_p] = p.default
        return limpios

    def _construir_receptor(self, domain, pool, cap: Capacidad, args: dict):
        """Instancia la entidad de dominio sobre la que corre la capacidad."""
        e = cap.entidad
        if e == "mercado":
            return domain.mercado()
        if e == "watchlist":
            return domain.watchlist()
        if e == "coin":
            return domain.coin(args["coin_id"])
        if e == "par":
            return domain.coin(args["coin_id"]).par(args["exchange"], args["quote"])
        if e == "sistema":
            return None
        raise ContratoInvalido(f"entidad no soportada: {e}")

    # ---- Proyecciones a formatos de consumidor ----
    # Una sola fuente de verdad, varias salidas. Agregar un formato no toca
    # ninguna capacidad.

    def a_function_calling(self, categoria: str = "") -> list[dict]:
        """
        Formato de function calling (Gemini / OpenAI). Reemplaza la lista
        FUNCIONES que hoy está cableada a mano en chat.py.
        """
        out = []
        for cap in self._caps.values():
            if categoria and cap.categoria != categoria:
                continue
            props = {p.nombre: p.a_json_schema() for p in cap.parametros}
            req = [p.nombre for p in cap.parametros if p.requerido]
            # La descripción incluye el bloque epistémico: el modelo necesita
            # saber qué es medición y qué es inferencia para no confundirlas
            # al redactar la respuesta.
            desc = (
                f"{cap.descripcion}\n"
                f"MIDE (hecho verificable): {cap.mide}\n"
                f"INFIERE (lectura, no hecho): {cap.infiere}\n"
                f"NO PUEDE SABER: {cap.no_sabe}"
            )
            entrada: dict = {"name": cap.nombre, "description": desc,
                             "parameters": {"type": "object", "properties": props}}
            if req:
                entrada["parameters"]["required"] = req
            out.append(entrada)
        return out

    def a_mcp(self) -> list[dict]:
        """Formato de tools de un servidor MCP."""
        out = []
        for cap in self._caps.values():
            props = {p.nombre: p.a_json_schema() for p in cap.parametros}
            req = [p.nombre for p in cap.parametros if p.requerido]
            out.append({
                "name": cap.nombre,
                "description": cap.descripcion,
                "inputSchema": {
                    "type": "object",
                    "properties": props,
                    **({"required": req} if req else {}),
                },
                "_axiom": cap.epistemico(),   # metadata propia de AXIOM
            })
        return out


# Instancia única
registro = RegistroCapacidades()


# ══ El decorador ══════════════════════════════════════════════════════════════

def capacidad(*, nombre: str, descripcion: str, entidad: str, categoria: str,
              costo: str, devuelve: str,
              mide: str, infiere: str, no_sabe: str, fuente: str, metodo: str,
              parametros: list[Param] | None = None):
    """
    Declara una capacidad de AXIOM y la registra al importarse el módulo.

    Va pegado al método de dominio que implementa la capacidad: declaración y
    código viven juntos, de modo que agregar una funcionalidad y que el chat la
    conozca sean el MISMO acto.

    Todos los campos son obligatorios, incluido el bloque epistémico. Si no
    aplica, se declara explícitamente (ej. infiere="nada") — eso obliga a
    verificar que efectivamente no hay inferencia escondida.

    Ejemplo:
        @capacidad(
            nombre="regimen_mercado",
            descripcion="Régimen actual del mercado en tres temporalidades.",
            entidad="mercado", categoria="mercado", costo="barato",
            devuelve="régimen, convicción y consenso por temporalidad",
            mide="clasificación de 12 señales sobre el último snapshot horario",
            infiere="el régimen es una lectura del estado, no una predicción",
            no_sabe="si el régimen se sostendrá ni cuándo cambiará",
            fuente="tabla snapshots (job horario)",
            metodo="voto ponderado de señales núcleo por temporalidad",
        )
        async def regimen_global(self) -> dict: ...
    """
    def decorador(func: Callable) -> Callable:
        if not inspect.iscoroutinefunction(func):
            raise ContratoInvalido(
                f"[{nombre}] las capacidades deben ser async def")

        cap = Capacidad(
            nombre=nombre, descripcion=descripcion, entidad=entidad,
            categoria=categoria, costo=costo, devuelve=devuelve,
            parametros=tuple(parametros or ()),
            mide=mide, infiere=infiere, no_sabe=no_sabe,
            fuente=fuente, metodo=metodo,
            funcion=func,
        )
        registro.registrar(cap)
        func._capacidad = cap        # accesible desde el método, si hace falta
        return func

    return decorador
