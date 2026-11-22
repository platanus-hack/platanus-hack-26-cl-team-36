"""Despachador del runtime chameleon: valida el pedido y corre el CLI de su etapa como subproceso."""

import logging
import os
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from shared import stages, store

APPS_DIR = Path(__file__).resolve().parent.parent
INVOKER_VAR = "CONDUCTOR_INVOKER"
RUNTIME_ARN_VAR = "CONDUCTOR_RUNTIME_ARN"
# Los ids de corrida tienen resolución de segundos; el margen cubre relojes desfasados entre procesos.
SINCE_MARGIN = timedelta(minutes=1)
_RUNTIME_ONLY = ("VIRTUAL_ENV", "PYTHONPATH")

log = logging.getLogger("chameleon.runtime")


class InvalidRequest(ValueError):
    pass


@dataclass(frozen=True)
class Request:
    stage: str
    revision: str
    command: stages.StageCommand


def parse_request(payload: Any) -> Request:
    """Valida el pedido y arma el comando de su etapa. Lanza InvalidRequest si algo no cuadra."""
    if not isinstance(payload, dict):
        raise InvalidRequest("el pedido debe ser un objeto JSON")
    url = payload.get("url")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise InvalidRequest("falta `url`, con http:// o https://")
    try:
        command = stages.command(payload.get("stage"), payload)
    except stages.InvalidPayload as error:
        raise InvalidRequest(str(error)) from error
    return Request(command.stage, payload["revision"].strip(), command)


def own_runtime_arn(environ: dict[str, str] = os.environ) -> str | None:
    """El ARN de este runtime: la variable, o el `cloud.resource_id` que AgentCore pone en OTEL_RESOURCE_ATTRIBUTES."""
    if environ.get(RUNTIME_ARN_VAR):
        return environ[RUNTIME_ARN_VAR]
    for attribute in environ.get("OTEL_RESOURCE_ATTRIBUTES", "").split(","):
        name, _, value = attribute.strip().partition("=")
        if name == "cloud.resource_id" and value:
            return value.split("/runtime-endpoint/")[0]
    return None


def stage_env(request: Request, environ: dict[str, str] = os.environ) -> dict[str, str]:
    """El entorno del subproceso; el conductor lanza las demás etapas en este mismo runtime."""
    # `uv run` debe usar el entorno de la app de la etapa, no el del runtime; PYTHONPATH lo pone
    # opentelemetry-instrument y en ese entorno su sitecustomize falla.
    env = {name: value for name, value in environ.items() if name not in _RUNTIME_ONLY}
    if request.stage == "revision":
        arn = own_runtime_arn(environ)
        if arn is None:
            raise RuntimeError(f"no se sabe el ARN del runtime: define {RUNTIME_ARN_VAR}")
        env |= {INVOKER_VAR: "agentcore", RUNTIME_ARN_VAR: arn}
    return env


class Children:
    """Los CLI de etapa en curso, para terminarlos cuando AgentCore apaga el contenedor."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running: set[subprocess.Popen] = set()
        self._stopping = False

    def run(self, argv: list[str], **options: Any) -> int:
        with self._lock:
            if self._stopping:
                raise RuntimeError("el runtime se está apagando")
            process = subprocess.Popen(argv, **options)
            self._running.add(process)
        try:
            return process.wait()
        finally:
            with self._lock:
                self._running.discard(process)

    def stop(self) -> None:
        with self._lock:
            self._stopping = True
            for process in self._running:
                process.terminate()


children = Children()


def run_command(request: Request, env: dict[str, str]) -> int:
    command = request.command
    log.info("etapa %s de la revisión %s: %s", request.stage, request.revision, " ".join(command.argv))
    return children.run(command.argv, cwd=APPS_DIR / command.app, env=env)


def close_without_trace(backend: store.Backend, request: Request, since) -> None:
    """Deja `failed` la corrida de la revisión: la crea si el CLI no dejó ninguna o la cierra si quedó a medias."""
    prefix = request.command.prefix
    run = store.revision_run(backend, prefix, request.revision, since=since - SINCE_MARGIN)
    if run is None:
        started = store.start_run(backend, prefix, model=None, revision=request.revision)
        store.finish_run(backend, started, "failed")
        log.warning("la etapa %s no dejó corrida: %s queda failed", request.stage, started.key)
        return
    manifest = store.read_manifest(backend, run)
    if manifest.status == "running":
        store.finish_run(backend, store.Run(manifest, backend.workdir(run)), "failed")
        log.warning("la etapa %s dejó %s a medias: queda failed", request.stage, run)


def run_stage(
    request: Request,
    *,
    backend: store.Backend | None = None,
    runner: Callable[[Request, dict[str, str]], int] = run_command,
    environ: dict[str, str] = os.environ,
    clock: store.Clock = store.utc_now,
) -> int:
    """Corre la etapa y devuelve su código de salida; si falla, su corrida queda `failed` en el almacén."""
    since = clock()
    try:
        code = runner(request, stage_env(request, environ))
    except Exception:
        log.exception("no se pudo correr la etapa %s", request.stage)
        code = -1
    if code != 0:
        close_without_trace(backend or store.open_backend(), request, since)
    return code
