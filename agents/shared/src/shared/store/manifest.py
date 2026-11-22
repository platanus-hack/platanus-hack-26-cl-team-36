"""Manifiesto de cada corrida: qué es, de qué corridas viene y cómo terminó."""

import re
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from shared.store.backend import Backend, json_bytes
from shared.store.keys import Agent, RunKey, RunPrefix, Viewport
from shared.store.run_ids import MAX_SEQUENCE, Clock, candidate_run_ids, format_run_id, utc_now

SCHEMA_VERSION = 1
MANIFEST = "manifest.json"

Status = Literal["running", "succeeded", "failed"]

_REVISION = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MAX_REVISION = 40


def validate_revision(revision: str) -> str:
    if len(revision) > MAX_REVISION or not _REVISION.fullmatch(revision):
        raise ValueError(f"revisión inválida: {revision!r}")
    return revision


@dataclass(frozen=True)
class Manifest:
    agent: Agent
    host: str
    goal: str | None
    viewport: Viewport | None
    run_id: str
    started_at: str
    status: Status
    model: str | None
    inputs: tuple[str, ...]
    """Claves de las corridas que esta corrida consumió."""
    finished_at: str | None = None
    schema_version: int = SCHEMA_VERSION
    revision: str | None = None
    """Revisión que agrupa las corridas de las etapas de una página."""

    def __post_init__(self) -> None:
        if self.revision is not None:
            validate_revision(self.revision)

    @property
    def key(self) -> RunKey:
        return RunPrefix(self.host, self.agent, self.goal, self.viewport).run(self.run_id)

    def to_dict(self) -> dict[str, Any]:
        data = {**asdict(self), "inputs": list(self.inputs)}
        if self.revision is None:
            del data["revision"]
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Manifest":
        # Ignora campos desconocidos para leer manifiestos de versiones más nuevas.
        known = {field.name for field in fields(cls)}
        return cls(**{key: value for key, value in data.items() if key in known} | {"inputs": tuple(data["inputs"])})


@dataclass(frozen=True)
class Run:
    manifest: Manifest
    workdir: Path

    @property
    def key(self) -> RunKey:
        return self.manifest.key


def _timestamp(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def start_run(
    backend: Backend,
    prefix: RunPrefix,
    *,
    model: str | None,
    inputs: Sequence[RunKey] = (),
    revision: str | None = None,
    clock: Clock = utc_now,
) -> Run:
    """Reserva el primer id libre escribiendo el manifiesto en estado running."""
    moment = clock()
    for run_id in candidate_run_ids(moment):
        manifest = Manifest(
            agent=prefix.agent,
            host=prefix.host,
            goal=prefix.goal,
            viewport=prefix.viewport,
            run_id=run_id,
            started_at=_timestamp(moment),
            status="running",
            model=model,
            inputs=tuple(str(run) for run in inputs),
            revision=revision,
        )
        if backend.create_bytes(manifest.key.file(MANIFEST), json_bytes(manifest.to_dict())):
            return Run(manifest, backend.workdir(manifest.key))
    raise RuntimeError(f"más de {MAX_SEQUENCE + 1} corridas en el mismo segundo bajo {prefix}")


def finish_run(
    backend: Backend,
    run: Run,
    status: Literal["succeeded", "failed"],
    clock: Clock = utc_now,
) -> Manifest:
    """Publica la carpeta de trabajo y, al final, el manifiesto con el estado y la hora de término."""
    if read_manifest(backend, run.key).status != "running":
        raise RuntimeError(f"la corrida {run.key} ya terminó")
    backend.publish(run.key, run.workdir)
    manifest = replace(run.manifest, status=status, finished_at=_timestamp(clock()))
    backend.write_json(run.key.file(MANIFEST), manifest.to_dict())
    return manifest


@contextmanager
def running(
    backend: Backend,
    prefix: RunPrefix,
    *,
    model: str | None,
    inputs: Sequence[RunKey] = (),
    revision: str | None = None,
    clock: Clock = utc_now,
) -> Iterator[Run]:
    """Una corrida entre `start_run` y `finish_run`: `succeeded` si el bloque termina, `failed` si lanza.

    Si publicar falla, la corrida también termina `failed` y se propaga el error original.
    """
    run = start_run(backend, prefix, model=model, inputs=inputs, revision=revision, clock=clock)
    try:
        yield run
        finish_run(backend, run, "succeeded", clock)
    except BaseException:
        _fail(backend, run, clock)
        raise


def _fail(backend: Backend, run: Run, clock: Clock) -> None:
    """Cierra la corrida como `failed`; si no se puede publicar, cierra solo el manifiesto."""
    if read_manifest(backend, run.key).status != "running":
        return
    try:
        finish_run(backend, run, "failed", clock)
    except Exception:
        manifest = replace(run.manifest, status="failed", finished_at=_timestamp(clock()))
        backend.write_json(run.key.file(MANIFEST), manifest.to_dict())


def read_manifest(backend: Backend, run: RunKey) -> Manifest:
    return Manifest.from_dict(backend.read_json(run.file(MANIFEST)))


def _manifests(
    backend: Backend, prefix: RunPrefix, since: datetime | None = None
) -> Iterator[tuple[RunKey, Manifest]]:
    """Las corridas legibles de `prefix` con su manifiesto, de la más nueva a la más vieja hasta `since`."""
    oldest = format_run_id(since) if since is not None else ""
    for run in reversed(backend.list_runs(prefix)):
        if run.run_id < oldest:
            return
        try:
            manifest = read_manifest(backend, run)
        except (OSError, ValueError, KeyError, TypeError):
            continue
        yield run, manifest


def runs_with_status(backend: Backend, prefix: RunPrefix, status: Status = "succeeded") -> Iterator[RunKey]:
    """Las corridas de `prefix` con `status`, de la más nueva a la más vieja; las de manifiesto ilegible se saltan."""
    return (run for run, manifest in _manifests(backend, prefix) if manifest.status == status)


def latest_run(backend: Backend, prefix: RunPrefix, status: Status = "succeeded") -> RunKey | None:
    """Última corrida de `prefix` cuyo manifiesto tiene `status`."""
    return next(runs_with_status(backend, prefix, status), None)


def revision_run(
    backend: Backend, prefix: RunPrefix, revision: str, *, since: datetime | None = None
) -> RunKey | None:
    """Última corrida de `prefix` de la revisión `revision`, con cualquier estado.

    Con `since` no lee los manifiestos de las corridas que empezaron antes: en S3 cada uno es un GET.
    """
    validate_revision(revision)
    runs = _manifests(backend, prefix, since)
    return next((run for run, manifest in runs if manifest.revision == revision), None)
