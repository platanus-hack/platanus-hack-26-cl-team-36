"""Interfaz común de los backends: toda clave pasa por `parse_key` antes de tocar el almacén."""

import json
from abc import ABC, abstractmethod
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from shared.store.keys import InvalidKey, RunKey, RunPrefix, parse_key
from shared.store.run_ids import sort_run_ids


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def workdir_files(run: RunKey, workdir: Path) -> list[tuple[Path, str]]:
    """Archivos de la carpeta de trabajo con su clave; omite los ocultos y falla si otro no cabe en el layout."""
    files = []
    for path in sorted(p for p in workdir.rglob("*") if p.is_file()):
        parts = path.relative_to(workdir).parts
        if any(part.startswith(".") for part in parts):
            continue
        if len(parts) > 2:
            raise InvalidKey(f"ruta demasiado profunda en la corrida: {path}")
        files.append((path, run.file(parts[-1], parts[0] if len(parts) == 2 else None)))
    return files


class Backend(ABC):
    def write_bytes(self, key: str, data: bytes) -> None:
        parse_key(key)
        self._put(key, data)

    def write_text(self, key: str, text: str) -> None:
        self.write_bytes(key, text.encode())

    def write_json(self, key: str, value: Any) -> None:
        self.write_bytes(key, json_bytes(value))

    def create_bytes(self, key: str, data: bytes) -> bool:
        """Escribe solo si la clave no existe, de forma atómica; dice si escribió."""
        parse_key(key)
        return self._create(key, data)

    def read_bytes(self, key: str) -> bytes:
        parse_key(key)
        return self._get(key)

    def read_text(self, key: str) -> str:
        return self.read_bytes(key).decode()

    def read_json(self, key: str) -> Any:
        return json.loads(self.read_bytes(key))

    def exists(self, key: str) -> bool:
        parse_key(key)
        return self._exists(key)

    def list_runs(self, prefix: RunPrefix) -> list[RunKey]:
        return [prefix.run(run_id) for run_id in sort_run_ids(self._children(str(prefix)))]

    def list_profiles(self, run: RunKey) -> list[str]:
        """Carpetas de perfil de una corrida de visitor."""
        if run.prefix.agent != "visitor":
            raise InvalidKey(f"{run.prefix.agent} no tiene carpetas de perfil")
        return sorted(self._children(str(run)))

    @abstractmethod
    def workdir(self, run: RunKey) -> Path:
        """Carpeta local donde el agente deja los archivos de la corrida."""

    @abstractmethod
    def publish(self, run: RunKey, workdir: Path) -> None:
        """Deja en el almacén los archivos de la carpeta de trabajo."""

    @abstractmethod
    def _put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def _create(self, key: str, data: bytes) -> bool: ...

    @abstractmethod
    def _get(self, key: str) -> bytes: ...

    @abstractmethod
    def _exists(self, key: str) -> bool: ...

    @abstractmethod
    def _children(self, folder: str) -> Iterable[str]:
        """Nombres de las subcarpetas inmediatas de la clave `folder`."""
