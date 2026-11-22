"""trace.json: el avance de un agente mientras trabaja, publicado paso a paso para mirar la corrida en vivo."""

import json
import os
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from shared.store.backend import Backend
from shared.store.manifest import Run, Status, _timestamp
from shared.store.run_ids import Clock, utc_now

TRACE = "trace.json"
TRACE_SCHEMA_VERSION = 1


@dataclass
class LiveTrace:
    """El trace.json de una corrida en curso o, en visitor, de un intento suyo (la carpeta `folder`)."""

    backend: Backend
    run: Run
    agent: Literal["guide", "visitor"]
    profile: str | None = None
    folder: str | None = None
    clock: Clock = utc_now

    @property
    def directory(self) -> Path:
        return self.run.workdir / self.folder if self.folder else self.run.workdir

    def write(self, status: Status, start: dict, steps: list[dict], publish: Iterable[str] = ()) -> None:
        """Escribe trace.json y, si `publish` nombra archivos (las capturas nuevas), sube esos y luego trace.json.

        Sin `publish` queda solo en la carpeta de trabajo, como el estado final que sube `finish_run`.
        """
        manifest = self.run.manifest
        document = {
            "schema_version": TRACE_SCHEMA_VERSION,
            "agent": self.agent,
            "goal": manifest.goal,
            "revision": manifest.revision,
            "profile": self.profile,
            "status": status,
            "updated_at": _timestamp(self.clock()),
            "start": start,
            "steps": steps,
        }
        _replace(self.directory / TRACE, json.dumps(document, ensure_ascii=False, indent=2) + "\n")
        names = list(publish)
        if names:
            for name in [*names, TRACE]:
                self.backend.publish_file(self.run.key, self.run.workdir, name, self.folder)

    def discard(self, names: Iterable[str]) -> None:
        """Borra esos archivos de la carpeta y del almacén."""
        for name in names:
            (self.directory / name).unlink(missing_ok=True)
            self.backend.publish_file(self.run.key, self.run.workdir, name, self.folder)


def _replace(path: Path, text: str) -> None:
    """De una vez: en disco, quien lee la corrida en curso nunca ve un trace.json a medias."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        file.write(text)
    os.replace(name, path)
