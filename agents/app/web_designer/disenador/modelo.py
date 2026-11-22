"""El modelo que diseña el tema y el juez, llamados por el Claude Code local (`claude -p`) como en el evaluador.

Sin herramientas, sin MCP, sin skills ni configuración del usuario (`ClaudeCodeProcess` del evaluador), y con
salida estructurada validada contra un esquema JSON. El skill no se carga como skill de Claude Code: su cuerpo va
en el prompt de sistema, igual que lo usaría la extensión.
"""

import asyncio
import hashlib
import json
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

from disenador import config
from engines import ClaudeCodeError, ClaudeCodeProcess, png_image_block

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


def json_tolerante(texto) -> dict | None:
    """Un objeto JSON dentro de un texto, aunque venga envuelto en un bloque ```json; None si no hay."""
    if not isinstance(texto, str):
        return None
    cercado = re.search(r"```(?:json)?\s*(\{.*\})\s*```", texto, re.S)
    candidato = cercado.group(1) if cercado else texto[texto.find("{"): texto.rfind("}") + 1]
    try:
        datos = json.loads(candidato)
    except ValueError:
        return None
    return datos if isinstance(datos, dict) else None


@dataclass
class Respuesta:
    datos: dict
    uso: dict
    costo_usd: float
    segundos: float


class ClaudeCode:
    """Una llamada a `claude -p` con texto, varias imágenes y salida JSON.

    Si `claude` no entrega el resultado en `timeout_s` segundos, se mata el proceso y la llamada falla con
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
        proceso = await ClaudeCodeProcess.open(sistema, self.model, self.effort, esquema, self.cwd, log)
        contenido = [
            {"type": "text", "text": parte} if isinstance(parte, str) else png_image_block(parte) for parte in partes
        ]
        mensaje = {"type": "user", "message": {"role": "user", "content": contenido}}

        async def conversar() -> dict:
            proceso.process.stdin.write((json.dumps(mensaje) + "\n").encode())
            await proceso.process.stdin.drain()
            # El tope es el `asyncio.wait_for` de abajo (`self.timeout_s`), que además mata el proceso. Sin el
            # `math.inf`, `wait_for_result` cortaría antes con el tope del evaluador (`CLAUDE_CODE_TIMEOUT_S`).
            return await proceso.wait_for_result(timeout_s=math.inf)

        try:
            evento = await asyncio.wait_for(conversar(), timeout=self.timeout_s)
        except TimeoutError as error:
            _matar(proceso)
            raise ErrorDeModelo(f"claude no respondió en {self.timeout_s:g} s; se detuvo el proceso") from error
        except ClaudeCodeError as error:
            raise ErrorDeModelo(str(error)) from error
        finally:
            await proceso.close()
        salida = evento.get("structured_output")
        if not isinstance(salida, dict) and not evento.get("is_error"):
            salida = json_tolerante(evento.get("result"))
        if evento.get("is_error") or evento.get("subtype") != "success" or not isinstance(salida, dict):
            detalle = evento.get("result") or evento.get("subtype") or "sin detalle"
            raise ErrorDeModelo(f"Claude Code no devolvió una respuesta estructurada: {str(detalle)[:300]}")
        uso = {k: (evento.get("usage") or {}).get(k) or 0 for k in ("input_tokens", "output_tokens",
                                                                    "cache_read_input_tokens")}
        return Respuesta(salida, uso, evento.get("total_cost_usd") or 0.0, round(time.monotonic() - inicio, 1))


def _matar(proceso) -> None:
    try:
        proceso.process.kill()
    except ProcessLookupError:
        pass
