"""El modelo que diseña el tema y el juez, llamados con el motor de `shared.claude` (`AGENTS_ENGINE`).

Con Claude Code, sin herramientas, sin MCP, sin skills ni configuración del usuario, y con salida estructurada
validada contra un esquema JSON. El skill no se carga como skill de Claude Code: su cuerpo va en el prompt de
sistema, igual que lo usaría la extensión.
"""

import hashlib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path

from shared.claude.caller import ClaudeCallError
from shared.claude.engines import make_caller

from disenador import config, voz
from disenador.motor.componer import DIRECCIONES, FAMILIAS_DISPONIBLES, direcciones, recetas_meta

ESQUEMA_TEMA = {
    "type": "object",
    "properties": {
        "css": {"type": "string", "description": "La hoja de estilos completa del tema."},
        "resumen": {"type": "string", "description": "Una o dos frases con la idea del tema."},
        "decisiones": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Lista corta: una frase por decisión de diseño.",
        },
    },
    "required": ["css", "resumen", "decisiones"],
    "additionalProperties": False,
}

def _cadenas(*claves: str, max_largo: int | None = None) -> dict:
    cadena = {"type": "string", **({"maxLength": max_largo} if max_largo else {})}
    return {"type": "object", "properties": {c: cadena for c in claves}, "required": list(claves),
            "additionalProperties": False}


MAX_TAREAS_MODELO = 40
MAX_TEXTO_TAREA = 160


# El modo kit (`--revision`): el tema más la microcopia y el ancla de los componentes que propone el diagnóstico.
ESQUEMA_KIT = {
    **ESQUEMA_TEMA,
    "properties": {
        **ESQUEMA_TEMA["properties"],
        "componentes": {
            "type": "array",
            "description": "Uno por componente del diagnóstico, con su mismo `id`.",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "contenedor": {"type": "string", "description": "Selector del ancla; vacío: el propuesto."},
                    "textos": {"type": "object", "properties": {"es": _cadenas("titulo", "subtitulo", "boton"),
                                                                "en": _cadenas("titulo", "subtitulo", "boton")},
                               "required": ["es", "en"], "additionalProperties": False},
                    "etiquetas": {"type": "array", "items": _cadenas("nombre", "es", "en")},
                    "tareas": {"type": "array", "maxItems": MAX_TAREAS_MODELO,
                               "items": _cadenas("enlace", "titulo_es", "titulo_en", "detalle_es", "detalle_en",
                                                 max_largo=MAX_TEXTO_TAREA)},
                    "fuentes": {"type": "array", "description": "De dónde sale cada texto escrito.", "items": {
                        "type": "object",
                        "properties": {"texto": {"type": "string"}, "fuente": {"enum": list(voz.FUENTES)},
                                       "origen": {"type": "string"}},
                        "required": ["texto", "fuente", "origen"], "additionalProperties": False}},
                },
                "required": ["id", "contenedor", "textos", "etiquetas", "tareas", "fuentes"],
                "additionalProperties": False,
            },
        },
    },
    "required": [*ESQUEMA_TEMA["required"], "componentes"],
}

# El modo motor: el modelo elige una dirección de arte, una semilla y ajustes acotados; el código compone el CSS.
AJUSTES_NUMERICOS = ("neutros.tono", "neutros.croma", "neutros.fondo", "neutros.paso", "tinta.l", "tinta.l2",
                     "acento.l", "acento.c", "tipo.escala", "tipo.display.peso", "tipo.display.ancho",
                     "tipo.display.tracking", "forma.radio", "densidad")
_LISTA_DE_RECETAS = {"type": "array", "items": {"enum": list(recetas_meta())}}
ESQUEMA_MOTOR = {
    "type": "object",
    "properties": {
        "direccion": {"enum": [*DIRECCIONES, "auto"]},
        "semilla": {"type": "integer", "minimum": 1, "maximum": 2_147_483_647},
        "ajustes": {
            "type": "object",
            "properties": {
                **{ruta: {"type": "number"} for ruta in AJUSTES_NUMERICOS},
                "hero": {"enum": ["ocultar", "atmosfera"]},
                "disposicion": {"enum": ["apilado", "mosaico"]},
                "orden": {"enum": ["natural", "tareas-primero"]},
                "recetas": {"type": "object", "properties": {"agregar": _LISTA_DE_RECETAS, "quitar": _LISTA_DE_RECETAS},
                            "additionalProperties": False},
            },
            "additionalProperties": False,
        },
        "motivo": {"type": "string", "description": "Una o dos frases: por qué esa dirección y esos ajustes."},
        "componentes": ESQUEMA_KIT["properties"]["componentes"],
    },
    "required": ["direccion", "semilla", "ajustes", "motivo", "componentes"],
    "additionalProperties": False,
}


def _direcciones_para_el_modelo() -> str:
    lineas = []
    for d in direcciones().values():
        rangos = {ruta: valor for ruta in AJUSTES_NUMERICOS
                  if isinstance(valor := _en(d, ruta), list)}
        lineas.append(f"  - `{d['id']}` «{d['nombre']}» ({d['modo']}): {d['idea']} Recetas fijas:"
                      f" {', '.join(d['recetas']['fijas'])}; rangos: {json.dumps(rangos)}")
    return "\n".join(lineas)


def _en(datos: dict, ruta: str):
    for clave in ruta.split("."):
        datos = datos.get(clave) if isinstance(datos, dict) else None
    return datos


def contrato_motor() -> str:
    recetas = "; ".join(f"`{k}` ({v['idea']})" for k, v in recetas_meta().items())
    return f"""## Contrato de salida

No escribes CSS: eliges una dirección de arte y el código compone el tema, lo sanea y verifica el contraste AA.
Respondes solo el JSON pedido, con:
- `direccion`: una de estas, o `auto` para que el código la elija según los rasgos del sitio:
{_direcciones_para_el_modelo()}
- `semilla`: un entero ≥ 1; la misma semilla da el mismo tema, otra semilla otra variante dentro de la dirección.
- `ajustes`: opcional, para acercar el tema a los gustos. Un número fija ese parámetro dentro del rango de la
  dirección (fuera del rango se recorta); `hero`, `disposicion` y `orden` eligen una variante del sitio, si la tiene;
  `recetas.agregar` y `recetas.quitar` suman o sacan bloques: {recetas}. Una receta que no calza con la dirección
  o el sitio se ignora con un aviso.
- `motivo`: una o dos frases con el porqué.
Las letras disponibles son {", ".join(FAMILIAS_DISPONIBLES)}: cada dirección ya trae la suya.
"""


CONTRATO = """## Contrato de salida

Respondes solo el JSON pedido, con:
- `css`: la hoja de estilos completa del tema. Cada selector empieza con `html.mi-tema` (por ejemplo
  `html.mi-tema body` o `html.mi-tema nav a:hover`): la extensión agrega la clase `mi-tema` a `<html>` y la quita al
  apagar el tema. La hoja se inyecta como hoja de autor después de las del sitio. Está prohibido `url(`,
  `image-set(`, `@import`, la barra invertida, `expression(`, `javascript:` y los saltos de línea dentro de una
  cadena; lo que los contenga se descarta. Solo se aceptan las at-reglas `@media`, `@supports`, `@container` y
  `@keyframes` con un nombre que empiece por `mt-` (nada de `@layer` ni `@font-face`).
- `resumen`: una o dos frases con la idea del tema.
- `decisiones`: una lista corta, una frase por decisión de diseño.
"""

CONTRATO_KIT = """- `componentes`: uno por cada componente del diagnóstico (`atajo`, `lanzador` o `buscador`), con su mismo `id`;
  la extensión los dibuja con los datos del diagnóstico y tú pones las palabras y el lugar.
  Las palabras son las del sitio, no las de una app: cada texto sale primero de lo que la página ya dice para eso
  (`voz_del_sitio` del diagnóstico: el título de la sección que reemplaza el atajo, la etiqueta u opción vacía de
  cada `<select>`, el texto del botón que envía el formulario, el texto del menú de cada enlace). Solo si no existe o
  no se entiende, reformula breve con palabras de la página o del objetivo. Prohibido: preguntas a la persona
  ("¿A dónde vas?", "¿Qué quieres hacer?"), "Lo más buscado", "Accesos rápidos", "Todo lo que necesitas" y emojis; el
  código los reemplaza por el texto del sitio.
  - `textos`: en `es` y `en`, `titulo` (≤ 6 palabras, el del sitio; en el lanzador y el buscador, vacío si el sitio
    no titula ese bloque: el componente va sin titular), `subtitulo` (una frase corta, o vacío) y `boton` (el verbo
    de la acción en el atajo; el que abre la búsqueda en el buscador; en el lanzador, vacío).
  - `etiquetas`: en el atajo, una por campo (`nombre` del campo), corta y en ambos idiomas ("Origen" / "Origin").
  - `tareas`: en el lanzador y el buscador, una por tarea (mismo `enlace`, hasta 40). `titulo_es`: el texto del menú
    que lleva a ese enlace, si lo hay ("Planificador de Viajes"); si no, de 2 a 5 palabras con las del objetivo, no
    la descripción recortada. `titulo_en`: su traducción. `detalle_es` y `detalle_en`: una frase breve
    (≤ 160 caracteres). El inglés es la traducción, nunca una copia del español. Una tarea que está en ambos
    componentes basta escribirla en uno.
  - `fuentes`: una por texto que escribiste: `texto` (`titulo`, `subtitulo`, `boton`, `etiqueta:<nombre>` o
    `tarea:<enlace>`), `fuente` (`sitio`, `objetivo` o `reformulado`) y `origen` (el texto del sitio o del objetivo
    del que sale).
  - `contenedor`: un selector del mapa (un `id` o etiqueta, ≤ 200 caracteres) del bloque antes del cual va el
    componente, arriba y a la vista; vacío para dejar el propuesto. Si no existe en la página, queda el propuesto.
"""

CONTRATO_KIT_CSS = """  En el CSS, el componente se estiliza con `[data-mt-vista="<id>"]`, `.mt-atajo` y `.mt-lanzador`. La regla que
  oculta el bloque original que reemplaza el atajo la agrega el código; no la escribas.
"""


class ErrorDeModelo(Exception):
    """Claude Code no devolvió una respuesta estructurada."""


@dataclass
class Skill:
    ruta: Path
    nombre: str
    cuerpo: str
    sha256: str

    def describir(self) -> dict:
        return {"ruta": str(self.ruta), "nombre": self.nombre, "sha256": self.sha256}


def leer_skill(ruta: Path) -> Skill:
    """El SKILL.md sin su frontmatter; el nombre sale del frontmatter (`name`) o de la carpeta."""
    contenido = ruta.read_text(encoding="utf-8")
    nombre = ruta.parent.name
    cuerpo = contenido
    frontmatter = re.match(r"^---\s*\n(.*?)\n---\s*\n?", contenido, re.S)
    if frontmatter:
        cuerpo = contenido[frontmatter.end():]
        campo = re.search(r"^name:\s*(.+)$", frontmatter.group(1), re.M)
        if campo:
            nombre = campo.group(1).strip().strip("\"'")
    return Skill(ruta, nombre, cuerpo.strip(), hashlib.sha256(contenido.encode()).hexdigest()[:12])


def prompt_de_sistema(skill: Skill | None, kit: bool = False, con_motor: bool = False) -> str:
    """`kit`: con los componentes del diagnóstico; `con_motor`: el modelo elige dirección en vez de escribir CSS."""
    if con_motor:
        contrato = contrato_motor() + CONTRATO_KIT
    else:
        contrato = CONTRATO + CONTRATO_KIT + CONTRATO_KIT_CSS if kit else CONTRATO
    if skill is None:
        return "Diseñas temas CSS que cambian el aspecto de un sitio web según los gustos de su usuario.\n\n" + contrato
    return f"{skill.cuerpo}\n\n{contrato}"


def mensaje_de_diseno(url: str, gustos: str, tarea: str | None, mapa_texto: str, viewport: dict,
                      medido: str | None = None, diagnostico: str | None = None) -> str:
    """`medido`: el resumen de lo que midieron los agentes en la página (JSON), si lo hay; `diagnostico`: lo que les
    impidió llegar y los componentes del kit que salen de sus rutas (JSON), en el modo kit."""
    contexto = (
        "Lo que midieron usuarios sintéticos al intentar tareas en esta página (JSON): si la ruta existe, si llegaron"
        f" y dónde se desviaron o se detuvieron. Úsalo para que lo que lleva a la tarea se vea primero:\n{medido}\n\n"
        if medido else ""
    )
    if diagnostico:
        contexto += (
            "Diagnóstico (JSON): lo que dijeron los usuarios sintéticos al detenerse, los obstáculos que la Guía tuvo"
            " que sortear, los componentes propuestos (`componentes`), ya armados con los enlaces que la Guía"
            " verificó, y los textos que el sitio ya usa para cada uno (`voz_del_sitio`). Escríbeles la microcopia con"
            f" esa voz y elige dónde van:\n{diagnostico}\n\n"
        )
    return (
        "Diseña un tema para esta página.\n\n"
        f"Gustos del usuario: {gustos}\n"
        f"Tarea del usuario en el sitio: {tarea or '(no la indicó)'}\n"
        f"URL: {url}\n\n"
        f"{contexto}"
        f"Mapa de la página (JSON; cajas [x, y, ancho, alto] en px del documento; viewport "
        f"{viewport['width']}x{viewport['height']}):\n{mapa_texto}\n\n"
        "La imagen adjunta es la parte visible de la página, sin tema."
    )


def respuesta_guionizada(sistema: str, esquema: dict, partes: list) -> dict | None:
    """La respuesta del motor guionizado al diseño; el juez responde lo que dicta su esquema."""
    if esquema is ESQUEMA_MOTOR:
        return {"direccion": "auto", "semilla": 7, "ajustes": {}, "motivo": "Tema guionizado, sin modelo.",
                "componentes": []}
    if esquema is not ESQUEMA_TEMA and esquema is not ESQUEMA_KIT:
        return None
    tema = {"css": "html.mi-tema body { background-color: #fdfcf8; color: #1a1a1a; }",
            "resumen": "Tema guionizado, sin modelo.", "decisiones": ["fondo claro", "texto oscuro"]}
    return {**tema, "componentes": []} if esquema is ESQUEMA_KIT else tema


@dataclass
class Respuesta:
    datos: dict
    uso: dict
    costo_usd: float
    segundos: float


class ClaudeCode:
    """Una llamada con texto, varias imágenes y salida JSON, por el motor de `AGENTS_ENGINE`.

    Si la respuesta no llega en `timeout_s` segundos (con Claude Code se mata el proceso), la llamada falla con
    `ErrorDeModelo`: una generación colgada queda como error en el resumen y no detiene la corrida.
    """

    def __init__(self, model: str, effort: str, cwd: Path, timeout_s: float = config.TIMEOUT_MODELO_S):
        self.model = model
        self.effort = effort
        self.cwd = cwd
        self.timeout_s = timeout_s

    async def pedir(self, sistema: str, esquema: dict, partes: list[str | bytes], log: Path) -> Respuesta:
        """`partes` alterna texto e imágenes PNG, en el orden en que el modelo las ve."""
        inicio = time.monotonic()
        caller = make_caller(self.model, self.effort, self.cwd, log, self.timeout_s, fake=respuesta_guionizada)
        try:
            respuesta = await caller.answer(sistema, esquema, partes)
        except ClaudeCallError as error:
            raise ErrorDeModelo(str(error)) from error
        uso = {k: respuesta.usage.get(k) or 0 for k in ("input_tokens", "output_tokens", "cache_read_input_tokens")}
        return Respuesta(respuesta.output, uso, respuesta.cost_usd, round(time.monotonic() - inicio, 1))
