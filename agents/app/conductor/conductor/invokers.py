"""Cómo corre una etapa: `local`, su CLI como subproceso; `agentcore`, una sesión nueva del runtime.

Los dos devuelven cómo terminó la corrida de la etapa en el almacén, la de la misma revisión.
"""

import asyncio
import contextlib
import json
import os
import signal
import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import timedelta
from pathlib import Path
from typing import Any, Literal, Protocol

from shared import aws, stages, store

from conductor import config

# Las corridas de la etapa empiezan después de lanzarla; el margen cubre relojes algo desfasados entre máquinas.
_SKEW = timedelta(seconds=5)


@dataclass
class Outcome:
    status: Literal["succeeded", "failed"]
    run: str | None = None
    """Clave de la corrida de la etapa, si dejó una."""
    error: str | None = None
    seconds: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


class Invoker(Protocol):
    async def run(self, stage: str, payload: dict[str, Any], timeout_s: float) -> Outcome: ...


Found = tuple[store.RunKey, store.Status]


def _find(backend: store.Backend, command: stages.StageCommand, revision: str, since) -> Found | None:
    found = store.revision_manifest(backend, command.prefix, revision, since=since)
    return (found[0], found[1].status) if found else None


def _outcome(found: Found | None, error: str | None, seconds: float) -> Outcome:
    seconds = round(seconds, 1)
    run = str(found[0]) if found else None
    if found and found[1] == "succeeded" and error is None:
        return Outcome("succeeded", run, None, seconds)
    if error is None:
        error = f"la corrida terminó {found[1]}" if found else "no dejó una corrida de la revisión"
    return Outcome("failed", run, error, seconds)


def _close_abandoned(backend: store.Backend, key: store.RunKey) -> None:
    """Una corrida que quedó `running` porque su proceso murió: `failed`, para que nadie la espere."""
    manifest = store.read_manifest(backend, key)
    if manifest.status == "running":
        finished = store.utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")
        backend.write_json(key.file("manifest.json"), replace(manifest, status="failed", finished_at=finished).to_dict())


class LocalInvoker:
    """El CLI de la etapa en `agents/app/<app>/`, con su salida en `<log_dir>/<etapa>[-<goal>].log`."""

    def __init__(self, backend: store.Backend, apps_dir: Path = config.APPS_DIR, log_dir: Path | None = None,
                 command: Sequence[str] = stages.COMMAND):
        self.backend = backend
        self.apps_dir = apps_dir
        self.log_dir = log_dir
        self.command = tuple(command)

    async def run(self, stage: str, payload: dict[str, Any], timeout_s: float) -> Outcome:
        command = stages.command(stage, payload)
        started, since = time.monotonic(), store.utc_now() - _SKEW
        # Sin el VIRTUAL_ENV del conductor: cada app usa el suyo.
        env = {name: value for name, value in os.environ.items() if name != "VIRTUAL_ENV"}
        name = "-".join(filter(None, [stage, command.prefix.goal]))
        log = open(self.log_dir / f"{name}.log", "wb") if self.log_dir else None
        error = None
        try:
            process = await asyncio.create_subprocess_exec(
                *self.command, *command.args, cwd=self.apps_dir / command.app, env=env,
                stdin=asyncio.subprocess.DEVNULL, stdout=log or asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.STDOUT, start_new_session=True,
            )
            try:
                code = await asyncio.wait_for(process.wait(), timeout_s)
                if code:
                    error = f"salió con código {code}"
            except TimeoutError:
                error = f"superó el tiempo máximo de {timeout_s:g} s"
            finally:
                # `uv run` deja a la app en un proceso hijo, y la app a su navegador: se mata el grupo entero.
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        except asyncio.CancelledError:
            # Cancelada (Ctrl-C, SIGTERM): su corrida tampoco queda `running`.
            await asyncio.to_thread(self._found, command, payload["revision"], since)
            raise
        finally:
            if log:
                log.close()
        found = await asyncio.to_thread(self._found, command, payload["revision"], since)
        return _outcome(found, error, time.monotonic() - started)

    def _found(self, command: stages.StageCommand, revision: str, since) -> Found | None:
        found = _find(self.backend, command, revision, since)
        if found and found[1] == "running":
            _close_abandoned(self.backend, found[0])
            found = (found[0], "failed")
        return found


class AgentCoreInvoker:
    """InvokeAgentRuntime con una sesión nueva por etapa; espera mirando el manifiesto de la etapa en el almacén.

    Las lecturas empiezan seguidas y se espacian hasta `poll_s`: las etapas cortas se notan pronto sin cargar S3.
    """

    def __init__(self, backend: store.Backend, runtime_arn: str, client=None, poll_s: float = config.POLL_S,
                 poll_first_s: float = config.POLL_FIRST_S,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 monotonic: Callable[[], float] = time.monotonic):
        if client is None:
            import boto3
            from botocore.config import Config

            # Reintentos con espera ante throttling o un 5xx de la invocación.
            client = boto3.client("bedrock-agentcore", region_name=aws.region(),
                                  config=Config(retries={"mode": "standard", "total_max_attempts": 6}))
        self.backend = backend
        self.runtime_arn = runtime_arn
        self.client = client
        self.poll_s = poll_s
        self.poll_first_s = min(poll_first_s, poll_s)
        self.sleep = sleep
        self.monotonic = monotonic

    async def run(self, stage: str, payload: dict[str, Any], timeout_s: float) -> Outcome:
        command = stages.command(stage, payload)
        started, since = self.monotonic(), store.utc_now() - _SKEW
        body = {"stage": stage, **{key: value for key, value in payload.items() if value is not None}}
        try:
            await asyncio.to_thread(self._invoke, body)
        except Exception as error:
            return _outcome(None, f"no se pudo invocar el runtime: {type(error).__name__}: {error}",
                            self.monotonic() - started)
        wait = self.poll_first_s
        while True:
            found = await asyncio.to_thread(_find, self.backend, command, payload["revision"], since)
            if found and found[1] != "running":
                return _outcome(found, None, self.monotonic() - started)
            remaining = timeout_s - (self.monotonic() - started)
            if remaining <= 0:
                return _outcome(found, f"superó el tiempo máximo de {timeout_s:g} s",
                                self.monotonic() - started)
            await self.sleep(min(wait, remaining))
            wait = min(wait * config.POLL_GROWTH, self.poll_s)

    def _invoke(self, body: dict[str, Any]) -> None:
        # El runtime responde al instante (modo async) y sigue trabajando; el id de sesión pide 33 caracteres o más.
        response = self.client.invoke_agent_runtime(
            agentRuntimeArn=self.runtime_arn,
            runtimeSessionId=f"{body['revision']}-{body['stage']}-{uuid.uuid4().hex}",
            payload=json.dumps(body).encode(),
            contentType="application/json",
            accept="application/json",
        )
        stream = response.get("response")
        if hasattr(stream, "read"):
            stream.read()
            stream.close()


def make_invoker(backend: store.Backend, log_dir: Path | None) -> Invoker:
    """El invocador de `CONDUCTOR_INVOKER`."""
    name = os.environ.get(config.INVOKER_VAR) or "local"
    if name == "local":
        return LocalInvoker(backend, log_dir=log_dir)
    if name == "agentcore":
        arn = os.environ.get(config.RUNTIME_ARN_VAR)
        if not arn:
            raise ValueError(f"{config.INVOKER_VAR}=agentcore necesita {config.RUNTIME_ARN_VAR}")
        return AgentCoreInvoker(backend, arn, poll_s=config.poll_s())
    raise ValueError(f"{config.INVOKER_VAR}={name} no es un invocador: usa {', '.join(config.INVOKERS)}")
