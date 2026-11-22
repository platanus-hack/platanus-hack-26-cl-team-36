"""El modelo que diseña el tema y el juez, llamados con el motor de `shared.claude` (`AGENTS_ENGINE`).

Con Claude Code, sin herramientas, sin MCP, sin skills ni configuración del usuario, y con salida estructurada
validada contra un esquema JSON. El skill no se carga como skill de Claude Code: su cuerpo va en el prompt de
sistema, igual que lo usaría la extensión.
"""

import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path

from shared.claude.caller import ClaudeCallError, tolerant_json
from shared.claude.engines import make_caller

from disenador import config

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


def prompt_de_sistema(skill: Skill | None) -> str:
    if skill is None:
        return "Diseñas temas CSS que cambian el aspecto de un sitio web según los gustos de su usuario.\n\n" + CONTRATO
    return f"{skill.cuerpo}\n\n{CONTRATO}"


def mensaje_de_diseno(url: str, gustos: str, tarea: str | None, mapa_texto: str, viewport: dict) -> str:
    return (
        "Diseña un tema para esta página.\n\n"
        f"Gustos del usuario: {gustos}\n"
        f"Tarea del usuario en el sitio: {tarea or '(no la indicó)'}\n"
        f"URL: {url}\n\n"
        f"Mapa de la página (JSON; cajas [x, y, ancho, alto] en px del documento; viewport "
        f"{viewport['width']}x{viewport['height']}):\n{mapa_texto}\n\n"
        "La imagen adjunta es la parte visible de la página, sin tema."
    )


json_tolerante = tolerant_json


def respuesta_guionizada(sistema: str, esquema: dict, partes: list) -> dict | None:
    """La respuesta del motor guionizado al diseño; el juez responde lo que dicta su esquema."""
    if esquema is not ESQUEMA_TEMA:
        return None
    return {"css": "html.mi-tema body { background-color: #fdfcf8; color: #1a1a1a; }",
            "resumen": "Tema guionizado, sin modelo.", "decisiones": ["fondo claro", "texto oscuro"]}


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
