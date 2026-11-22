"""Única definición del layout de claves del almacén, igual en disco y en S3."""

import re
from dataclasses import dataclass
from typing import Literal, cast, get_args
from urllib.parse import urlsplit

from shared.store.run_ids import is_run_id

Agent = Literal["cataloger", "guide", "visitor", "summary"]
Viewport = Literal["desktop", "mobile"]

AGENTS: tuple[Agent, ...] = get_args(Agent)
VIEWPORTS: tuple[Viewport, ...] = get_args(Viewport)

# Segmentos entre el agente y el id de corrida: goal y, en guide, viewport.
_PREFIX_DEPTH: dict[str, int] = {"cataloger": 0, "summary": 0, "visitor": 1, "guide": 2}
_DEFAULT_PORTS = {"http": 80, "https": 443}
_LABEL = r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
_HOST = re.compile(rf"{_LABEL}(?:\.{_LABEL})*(?::[1-9]\d{{0,4}})?")
_GOAL = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_PROFILE = re.compile(r"[a-z0-9]+(?:[_-][a-z0-9]+)*")
# Un archivo siempre lleva extensión y un perfil nunca: así no se confunden dentro de una corrida.
_FILE = re.compile(r"[a-z0-9][a-z0-9_-]*\.[a-z0-9]+")


class InvalidKey(ValueError):
    pass


def _check(pattern: re.Pattern[str], value: str, what: str) -> str:
    if not pattern.fullmatch(value):
        raise InvalidKey(f"{what} inválido: {value!r}")
    return value


def validate_host(host: str) -> str:
    _check(_HOST, host, "host")
    if host.startswith("www."):
        raise InvalidKey(f"host sin normalizar: {host!r}")
    return host


def validate_goal(goal: str) -> str:
    return _check(_GOAL, goal, "goal")


def validate_profile(profile: str) -> str:
    return _check(_PROFILE, profile, "perfil")


def validate_file_name(name: str) -> str:
    return _check(_FILE, name, "nombre de archivo")


def normalize_host(url: str) -> str:
    """Host de una URL como lo deja `shared.nodes.urls.normalize_url`, en punycode; un host suelto se toma como https."""
    text = url.strip()
    parts = urlsplit(text if "://" in text else f"https://{text}")
    try:
        host = (parts.hostname or "").lower().removesuffix(".").removeprefix("www.").encode("idna").decode()
        port = parts.port
    except (UnicodeError, ValueError) as error:
        raise InvalidKey(f"URL inválida: {url!r}") from error
    if port and port != _DEFAULT_PORTS.get(parts.scheme.lower()):
        host = f"{host}:{port}"
    return validate_host(host)


@dataclass(frozen=True)
class RunPrefix:
    """Carpeta que agrupa las corridas de un agente para un sitio (y goal, y viewport)."""

    host: str
    agent: Agent
    goal: str | None = None
    viewport: Viewport | None = None

    def __post_init__(self) -> None:
        validate_host(self.host)
        if self.agent not in AGENTS:
            raise InvalidKey(f"agente desconocido: {self.agent!r}")
        depth = _PREFIX_DEPTH[self.agent]
        if (self.goal is not None) != (depth >= 1):
            raise InvalidKey(f"{self.agent} {'exige' if depth >= 1 else 'no lleva'} goal")
        if (self.viewport is not None) != (depth == 2):
            raise InvalidKey(f"{self.agent} {'exige' if depth == 2 else 'no lleva'} viewport")
        if self.goal is not None:
            validate_goal(self.goal)
        if self.viewport is not None and self.viewport not in VIEWPORTS:
            raise InvalidKey(f"viewport inválido: {self.viewport!r}")

    def __str__(self) -> str:
        return "/".join(p for p in (self.host, self.agent, self.goal, self.viewport) if p is not None)

    def run(self, run_id: str) -> "RunKey":
        return RunKey(self, run_id)


@dataclass(frozen=True)
class RunKey:
    prefix: RunPrefix
    run_id: str

    def __post_init__(self) -> None:
        if not is_run_id(self.run_id):
            raise InvalidKey(f"id de corrida inválido: {self.run_id!r}")

    def __str__(self) -> str:
        return f"{self.prefix}/{self.run_id}"

    def file(self, name: str, profile: str | None = None) -> str:
        """Clave de un archivo de la corrida; `profile` solo existe en visitor."""
        validate_file_name(name)
        if profile is None:
            return f"{self}/{name}"
        if self.prefix.agent != "visitor":
            raise InvalidKey(f"{self.prefix.agent} no tiene carpetas de perfil")
        return f"{self}/{validate_profile(profile)}/{name}"


@dataclass(frozen=True)
class KeyParts:
    run: RunKey
    profile: str | None = None
    name: str | None = None

    def __str__(self) -> str:
        return str(self.run) if self.name is None else self.run.file(self.name, self.profile)


def cataloger(url: str) -> RunPrefix:
    return RunPrefix(normalize_host(url), "cataloger")


def guide(url: str, goal: str, viewport: Viewport) -> RunPrefix:
    return RunPrefix(normalize_host(url), "guide", goal, viewport)


def visitor(url: str, goal: str) -> RunPrefix:
    return RunPrefix(normalize_host(url), "visitor", goal)


def summary(url: str) -> RunPrefix:
    return RunPrefix(normalize_host(url), "summary")


def parse_key(key: str) -> KeyParts:
    """Partes de la clave de una corrida o de un archivo suyo."""
    parts = key.split("/")
    if len(parts) < 3 or parts[1] not in _PREFIX_DEPTH:
        raise InvalidKey(f"clave inválida: {key!r}")
    depth = _PREFIX_DEPTH[parts[1]]
    rest = parts[2 + depth:]
    if not 1 <= len(rest) <= 3:
        raise InvalidKey(f"clave inválida: {key!r}")
    prefix = RunPrefix(
        host=parts[0],
        agent=cast(Agent, parts[1]),
        goal=parts[2] if depth >= 1 else None,
        viewport=cast(Viewport, parts[3]) if depth == 2 else None,
    )
    run = prefix.run(rest[0])
    if len(rest) == 1:
        return KeyParts(run)
    profile, name = (None, rest[1]) if len(rest) == 2 else (rest[1], rest[2])
    run.file(name, profile)
    return KeyParts(run, profile, name)
