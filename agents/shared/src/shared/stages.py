"""Única definición de cada etapa de una revisión: su app, los argumentos de su CLI y dónde queda su corrida.

El payload es el mismo del runtime: `{"stage", "revision", "url", ...}`. Nadie más arma líneas de comando.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, get_args

from shared import store

Stage = Literal["revision", "catalog", "guide", "visitor", "improver"]
STAGES: tuple[Stage, ...] = get_args(Stage)

APPS: dict[Stage, str] = {
    "revision": "conductor",
    "catalog": "cataloger",
    "guide": "guide",
    "visitor": "visitor",
    "improver": "web_designer",
}

# Opciones de cada etapa además de url y revision: campo del payload -> opción del CLI.
_OPTIONS: dict[Stage, dict[str, str]] = {
    "revision": {"goals_max": "--goals-max", "profiles": "--profiles", "runs": "--runs", "concurrency": "--concurrency"},
    "catalog": {},
    "guide": {},
    "visitor": {"profiles": "--profiles", "runs": "--runs"},
    "improver": {},
}
_INTEGERS = ("goals_max", "runs", "concurrency")
_WITH_GOAL: tuple[Stage, ...] = ("guide", "visitor")

COMMAND = ("uv", "run", "--locked", "main.py")
"""Cómo se corre el CLI de una app, desde su carpeta `agents/app/<app>/`."""


class InvalidPayload(ValueError):
    pass


@dataclass(frozen=True)
class StageCommand:
    stage: Stage
    app: str
    """Carpeta de la app en `agents/app/`."""
    args: tuple[str, ...]
    """Argumentos tras `main.py`."""
    prefix: store.RunPrefix
    """Prefijo del almacén donde queda la corrida de la etapa (con `revision` en el manifiesto)."""

    @property
    def argv(self) -> list[str]:
        return [*COMMAND, *self.args]


def _text(payload: Mapping[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise InvalidPayload(f"falta `{name}` en el payload")
    # Un valor que empieza con "-" se leería como otra opción del CLI.
    if value.strip().startswith("-"):
        raise InvalidPayload(f"`{name}` inválido: {value!r}")
    return value.strip()


def _option(name: str, value: Any) -> str:
    if name in _INTEGERS:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise InvalidPayload(f"`{name}` debe ser un entero positivo: {value!r}")
        return str(value)
    if not isinstance(value, str) or not value.strip() or value.strip().startswith("-"):
        raise InvalidPayload(f"`{name}` debe ser texto: {value!r}")
    return value.strip()


def _prefix(stage: Stage, url: str, goal: str | None) -> store.RunPrefix:
    if stage == "catalog":
        return store.cataloger(url)
    if stage == "guide":
        return store.guide(url, goal, "desktop")
    if stage == "visitor":
        return store.visitor(url, goal)
    if stage == "improver":
        return store.improver(url)
    return store.conductor(url)


def command(stage: str, payload: Mapping[str, Any]) -> StageCommand:
    """La etapa `stage` con el payload; lanza `InvalidPayload` si falta algo o no es válido. Los campos extra se ignoran."""
    if stage not in STAGES:
        raise InvalidPayload(f"etapa desconocida: {stage!r}; usa {', '.join(STAGES)}")
    url, revision = _text(payload, "url"), _text(payload, "revision")
    goal = _text(payload, "goal") if stage in _WITH_GOAL else None
    try:
        store.validate_revision(revision)
        prefix = _prefix(stage, url, goal)
    except ValueError as error:
        raise InvalidPayload(str(error)) from error
    args = ["--url", url, "--revision", revision]
    if stage == "guide":
        args.insert(0, "route")
    if stage == "catalog":
        args += ["--pages", "1"]
    if goal is not None:
        args += ["--goal", goal]
    for name, flag in _OPTIONS[stage].items():
        if payload.get(name) is not None:
            args += [flag, _option(name, payload[name])]
    return StageCommand(stage, APPS[stage], tuple(args), prefix)
