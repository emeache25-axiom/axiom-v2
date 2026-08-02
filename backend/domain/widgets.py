"""
AXIOM — Declaración de Widgets.
════════════════════════════════════════════════════════════════════════════
Qué widgets existen, qué capacidad consume cada uno y qué muestra en cada
densidad. Vive en el backend, no en el frontend.

POR QUÉ ACÁ Y NO EN EL FRONTEND:

1. La declaración son DATOS, no código de plataforma. "En pantalla chica la
   tabla de pares muestra par, precio y la métrica ordenada" es una decisión de
   producto — debería ser la misma en la web y en un futuro cliente Flutter.
   Lo único intrínsecamente distinto entre plataformas es el RENDER.

2. Permite VALIDAR contra el registro de capacidades. Un widget declara por qué
   columnas se puede ordenar; si alguna no está entre las que acepta su
   capacidad, el servicio no arranca. Antes esas dos listas vivían en archivos
   distintos y se desincronizaron: el widget ofrecía ordenar por 'coin' y la
   capacidad respondía 400.

El frontend consume `/api/capacidades/_/widgets` y cada archivo de widget aporta
solo su función de render.

Ver AXIOM_sistema_widgets.md
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from backend.domain.registry import registro as registro_capacidades

logger = logging.getLogger(__name__)

NIVELES = ("compacto", "normal", "amplio")
CONTEXTOS = ("pantalla", "panel", "chat", "dashboard")


class WidgetInvalido(Exception):
    """Declaración de widget incoherente. Hace fallar el arranque."""


@dataclass(frozen=True)
class Densidad:
    """
    Qué muestra un widget a cierto ancho de CONTENEDOR (no de ventana).

    hasta          — ancho máximo en px (None = sin tope, el nivel más amplio)
    campos         — lista fija de campos; o None si usa fijas + slots
    fijas          — campos que siempre están (para widgets con slots)
    slots_metrica  — cuántos lugares se reservan para métricas variables.
                     La métrica por la que se ordena siempre ocupa uno: en
                     pantalla chica, ver la que estás ordenando es lo único que
                     hace usable la tabla. El resto se llena por preferencia.
                     La CANTIDAD total de campos no varía al reordenar — si
                     variara, la tabla saltaría de ancho en cada clic.
    disponible     — False si el widget no se muestra útilmente a ese ancho
    """
    hasta: int | None = None
    campos: tuple[str, ...] | None = None
    fijas: tuple[str, ...] = ()
    slots_metrica: int = 0
    disponible: bool = True

    def a_dict(self) -> dict:
        return {
            "hasta": self.hasta,
            "campos": list(self.campos) if self.campos else None,
            "fijas": list(self.fijas),
            "slots_metrica": self.slots_metrica,
            "disponible": self.disponible,
        }


@dataclass(frozen=True)
class Widget:
    id: str
    label: str
    grupo: str
    capacidad: str
    descripcion: str = ""
    icono: str = ""
    contextos: tuple[str, ...] = ("pantalla",)
    args_default: dict = field(default_factory=dict)
    densidades: dict[str, Densidad] = field(default_factory=dict)

    # Campos por los que se puede ordenar. Se validan contra las opciones
    # reales del parámetro `orden` de la capacidad.
    ordenable_por: tuple[str, ...] = ()
    # Campos que cuentan como métrica: pueden ocupar los slots variables.
    metricas: tuple[str, ...] = ()
    # Orden de preferencia para llenar slots que sobren.
    metricas_pref: tuple[str, ...] = ()

    def a_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "grupo": self.grupo,
            "descripcion": self.descripcion,
            "icono": self.icono,
            "capacidad": self.capacidad,
            "contextos": list(self.contextos),
            "args_default": self.args_default,
            "densidades": {n: d.a_dict() for n, d in self.densidades.items()},
            "ordenable_por": list(self.ordenable_por),
            "metricas": list(self.metricas),
            "metricas_pref": list(self.metricas_pref),
        }


class RegistroWidgets:
    def __init__(self):
        self._w: dict[str, Widget] = {}

    def registrar(self, w: Widget) -> None:
        self._validar(w)
        if w.id in self._w:
            raise WidgetInvalido(f"widget duplicado: {w.id!r}")
        self._w[w.id] = w
        logger.debug("[widgets] declarado: %s", w.id)

    def _validar(self, w: Widget) -> None:
        if not w.id or not w.label:
            raise WidgetInvalido(f"[{w.id}] faltan id o label")

        malos = [c for c in w.contextos if c not in CONTEXTOS]
        if malos:
            raise WidgetInvalido(f"[{w.id}] contextos desconocidos: {malos}")

        malos = [n for n in w.densidades if n not in NIVELES]
        if malos:
            raise WidgetInvalido(f"[{w.id}] densidades desconocidas: {malos}")

        # La capacidad tiene que existir en el registro.
        if not registro_capacidades.existe(w.capacidad):
            raise WidgetInvalido(
                f"[{w.id}] consume la capacidad {w.capacidad!r}, que no está "
                f"registrada. Widgets y capacidades se declaran por separado; "
                f"si la capacidad se renombró, hay que actualizar el widget."
            )

        # Y las columnas ordenables tienen que estar entre las que acepta.
        # Esta validación existe porque las dos listas ya se desincronizaron:
        # el widget ofrecía ordenar por 'coin' y la capacidad devolvía 400.
        if w.ordenable_por:
            cap = registro_capacidades.describir(w.capacidad)
            p_orden = next((p for p in cap["parametros"] if p["nombre"] == "orden"), None)
            admitidas = set(p_orden["opciones"] or []) if p_orden else set()
            if admitidas:
                fuera = [c for c in w.ordenable_por if c not in admitidas]
                if fuera:
                    raise WidgetInvalido(
                        f"[{w.id}] declara ordenable_por={fuera}, pero la "
                        f"capacidad {w.capacidad!r} no los admite. "
                        f"Admitidos: {sorted(admitidas)}"
                    )

        # Las métricas deben estar entre las ordenables (si se declararon).
        if w.metricas and w.ordenable_por:
            fuera = [m for m in w.metricas if m not in w.ordenable_por]
            if fuera:
                raise WidgetInvalido(
                    f"[{w.id}] métricas no ordenables: {fuera}")

    # ---- Consulta ----

    def listar(self, contexto: str = "", capacidad: str = "") -> list[dict]:
        out = []
        for w in sorted(self._w.values(), key=lambda x: (x.grupo, x.id)):
            if contexto and contexto not in w.contextos:
                continue
            if capacidad and w.capacidad != capacidad:
                continue
            out.append(w.a_dict())
        return out

    def obtener(self, wid: str) -> dict | None:
        w = self._w.get(wid)
        return w.a_dict() if w else None

    def por_capacidad(self, capacidad: str) -> list[dict]:
        return self.listar(capacidad=capacidad)


registro_widgets = RegistroWidgets()


# ══ Declaraciones ═════════════════════════════════════════════════════════════

registro_widgets.registrar(Widget(
    id="regimen_mercado",
    label="Régimen de mercado",
    grupo="Mercado",
    icono="ti-activity",
    descripcion=(
        "El régimen vigente en las tres temporalidades, con su convicción y "
        "el consenso entre señales. Es la vista natural del resultado de "
        "regimen_mercado."
    ),
    capacidad="regimen_mercado",
    contextos=("pantalla", "panel", "chat", "dashboard"),
    args_default={},

    densidades={
        # No hay columnas que recortar: lo que cambia con el espacio es la
        # DISPOSICIÓN. En compacto las tres tarjetas van apiladas y sin los
        # segmentos de consenso; con más ancho, en fila y completas.
        "compacto": Densidad(hasta=560, campos=("largo", "medio", "corto")),
        "normal":   Densidad(hasta=900, campos=("largo", "medio", "corto")),
        "amplio":   Densidad(hasta=None, campos=("largo", "medio", "corto")),
    },

    ordenable_por=(),
    metricas=(),
))


registro_widgets.registrar(Widget(
    id="canastas_sugeridas",
    label="Coins sugeridas",
    grupo="Mercado",
    icono="ti-bulb",
    descripcion=(
        "Las coins que el sistema sugiere según el régimen vigente, en tres "
        "canastas por horizonte (largo, medio, corto). No es una tabla: son "
        "secciones con encabezado propio. Es la vista natural del resultado de "
        "coins_sugeridas."
    ),
    capacidad="coins_sugeridas",
    contextos=("pantalla", "panel", "chat", "dashboard"),
    args_default={},

    densidades={
        # Lo mínimo para reconocer una candidata: qué es, a cuánto está y cómo
        # viene hoy.
        "compacto": Densidad(hasta=520, campos=("coin", "precio", "cambio_24h")),
        "normal":   Densidad(hasta=880, campos=(
            "coin", "precio", "cambio_24h", "cambio_7d")),
        # 'estado' trae la señal y las condiciones cumplidas (o el catalizador
        # en las canastas de medio y corto). 'agregar' solo se dibuja si el
        # contexto es 'pantalla'.
        "amplio":   Densidad(hasta=None, campos=(
            "coin", "precio", "cambio_24h", "cambio_7d", "estado", "agregar")),
    },

    # La capacidad no acepta ordenamiento: el orden de cada canasta lo define
    # el criterio de selección, no el usuario.
    ordenable_por=(),
    metricas=(),
))


registro_widgets.registrar(Widget(
    id="lista_watchlist",
    label="Watchlist",
    grupo="Seguimiento",
    icono="ti-list",
    descripcion=(
        "Los pares en seguimiento con su precio y variaciones. En la pantalla "
        "de gestión incluye acciones (activar bot, editar, eliminar); montado "
        "en otros contextos es solo lectura."
    ),
    capacidad="mi_watchlist",
    contextos=("pantalla", "panel", "chat", "dashboard"),
    args_default={},

    densidades={
        # Lo que sobrevive en pantalla chica: qué par es, a cuánto está y
        # cuánto se movió hoy. El resto es contexto que puede esperar.
        "compacto": Densidad(hasta=460, campos=("coin", "precio", "cambio_24h")),
        "normal":   Densidad(hasta=820, campos=(
            "coin", "precio", "cambio_24h", "cambio_7d", "exchange")),
        # En la vista amplia se suman volumen y la columna de acciones — que
        # el render muestra solo si el contexto es 'pantalla'.
        "amplio":   Densidad(hasta=None, campos=(
            "coin", "precio", "cambio_24h", "cambio_7d", "volumen",
            "exchange", "acciones")),
    },

    # La capacidad `mi_watchlist` no acepta ordenamiento: devuelve los pares en
    # el orden que el usuario definió (columna `position`). Reordenar es una
    # acción de gestión, no un parámetro de consulta.
    ordenable_por=(),
    metricas=(),
))


registro_widgets.registrar(Widget(
    id="tabla_pares",
    label="Screener de pares",
    grupo="Mercado",
    icono="ti-arrows-exchange",
    descripcion=(
        "Tabla de pares tradeables con sus métricas, ordenable por cualquier "
        "columna. Es la vista natural del resultado de buscar_pares."
    ),
    capacidad="buscar_pares",
    contextos=("pantalla", "panel", "chat", "dashboard"),
    args_default={"min_volumen": 1000, "orden": "volumen", "limit": 20},

    densidades={
        # En pantalla chica sobreviven el par, el precio y la métrica que se
        # está ordenando. Con 3 columnas entra sin scroll horizontal, y por eso
        # el encabezado puede quedar fijo.
        "compacto": Densidad(hasta=520, fijas=("par", "precio"), slots_metrica=1),
        "normal":   Densidad(hasta=940,
                             fijas=("par", "exchange", "precio", "volumen"),
                             slots_metrica=2),
        # Con todas las columnas hace falta scroll horizontal; ahí el encabezado
        # no puede fijarse (sticky no atraviesa overflow) pero tampoco hace
        # falta: hay pantalla de sobra.
        "amplio":   Densidad(hasta=None, campos=(
            "par", "exchange", "precio", "volumen", "cambio",
            "volatilidad", "repetible", "impulso", "impulso_rep",
            "spread", "velas", "coin")),
    },

    ordenable_por=("par", "exchange", "precio", "volumen", "cambio",
                   "volatilidad", "desvio", "repetible", "impulso",
                   "impulso_rep", "spread", "velas", "coin"),
    metricas=("volatilidad", "desvio", "repetible", "impulso",
              "impulso_rep", "spread"),
    # Orden de preferencia para llenar los slots libres: primero el rango
    # (la métrica principal), después el spread (define si el trade es viable).
    metricas_pref=("volatilidad", "spread", "impulso", "repetible",
                   "impulso_rep", "desvio"),
))
