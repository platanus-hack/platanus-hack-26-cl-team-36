"""Conocimiento previo de un explorador sobre el tema de la tarea: qué tarea lee, qué sabe y qué palabras no conoce.

Hay dos niveles (`Profile.conocimiento`):

- `sin_contexto`: sabe lo que quiere con palabras de todos los días, no los nombres oficiales ("el impuesto de la casa",
  no "contribuciones"). Lee la versión coloquial de la tarea, si la tarea la trae, y el harness no le deja escribir un
  término oficial que todavía no haya visto en el sitio.
- `conoce_tema`: conoce los nombres oficiales y más o menos cómo funciona el trámite, y los usa al buscar.

Regla de oro: el conocimiento es del TEMA, nunca del SITIO. Ningún nivel sabe en qué sección, menú o página está la
respuesta; si lo supiera, la tanda mediría la pista y no el sitio.

Lo que sabe cada nivel viene de la tarea (agents/tasks/<host>/<id>.json), escrito a mano y revisado:
`description_sin_contexto`, `terminos_oficiales` y `conocimiento_del_tema`. Sin esos campos (objetivos del
Catalogador, --url), `sin_contexto` lee la tarea original y queda marcado con `tarea_coloquial: false` en run.json.
"""

import re
import unicodedata
from dataclasses import asdict, dataclass

from shared.catalog.tasks import Task

SIN_CONTEXTO = "sin_contexto"
CONOCE_TEMA = "conoce_tema"
NIVELES = (SIN_CONTEXTO, CONOCE_TEMA)


@dataclass(frozen=True)
class ConocimientoDeTarea:
    """Lo que una tarea dice sobre su tema, para los dos niveles."""

    description_sin_contexto: str | None = None  # la tarea con palabras de todos los días
    terminos_oficiales: tuple[str, ...] = ()     # los que `sin_contexto` no conoce y `conoce_tema` sí
    conocimiento_del_tema: str | None = None     # cómo funciona el trámite, sin decir dónde está en el sitio

    @classmethod
    def de_tarea(cls, task: Task | dict | None) -> "ConocimientoDeTarea":
        """Lo que trae una tarea (shared.catalog.tasks.Task, o su JSON como dict); vacío si no trae nada."""
        task = asdict(task) if isinstance(task, Task) else task or {}
        return cls(
            description_sin_contexto=(task.get("description_sin_contexto") or "").strip() or None,
            terminos_oficiales=tuple(t.strip() for t in task.get("terminos_oficiales") or () if t.strip()),
            conocimiento_del_tema=(task.get("conocimiento_del_tema") or "").strip() or None,
        )


@dataclass(frozen=True)
class TareaDelUsuario:
    """La tarea tal como la recibe un usuario sintético según su nivel."""

    instruccion: str
    contexto: str | None = None             # lo que sabe del tema; va en el primer mensaje, después de la tarea
    coloquial: bool | None = None           # solo `sin_contexto`: si leyó la versión con palabras de todos los días
    terminos_vetados: tuple[str, ...] = ()  # no puede escribirlos hasta verlos en el sitio


def tarea_para(nivel: str | None, instruccion: str, conocimiento: ConocimientoDeTarea | None = None) -> TareaDelUsuario:
    """La tarea que ve un usuario del nivel `nivel` (None = sin nivel: la tarea tal cual)."""
    conocimiento = conocimiento or ConocimientoDeTarea()
    if nivel is None:
        return TareaDelUsuario(instruccion)
    if nivel == SIN_CONTEXTO:
        coloquial = conocimiento.description_sin_contexto
        return TareaDelUsuario(
            instruccion=coloquial or instruccion,
            coloquial=coloquial is not None,
            terminos_vetados=conocimiento.terminos_oficiales,
        )
    if nivel == CONOCE_TEMA:
        partes = []
        if conocimiento.conocimiento_del_tema:
            partes.append(conocimiento.conocimiento_del_tema)
        if conocimiento.terminos_oficiales:
            partes.append("Nombres oficiales que conoces: " + ", ".join(conocimiento.terminos_oficiales) + ".")
        return TareaDelUsuario(instruccion, contexto=" ".join(partes) or None)
    raise ValueError(f"nivel de conocimiento desconocido: {nivel!r}; usa uno de: {', '.join(NIVELES)}")


def normalizar(texto: str) -> str:
    """Minúsculas, sin tildes y con espacios simples, para comparar palabras."""
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", sin_tildes.lower()).strip()


def terminos_en(texto: str, terminos) -> list[str]:
    """Los términos que aparecen en `texto` como palabras completas (admite plural en -s o -es)."""
    normal = normalizar(texto)
    return [
        termino for termino in terminos
        if re.search(rf"(?<!\w){re.escape(normalizar(termino))}(?:e?s)?(?!\w)", normal)
    ]
