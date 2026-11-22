"""Archivos de una carpeta antigua con su nombre en el almacén, y los que no se copian."""

from dataclasses import dataclass
from pathlib import Path

from shared.store import InvalidKey, RunKey

RENAMED = {"reference_comparison.json": "comparison.json"}

_PROPOSAL = "propuesta de ruta: en el almacén es proposals.json de una corrida de visitor, con otra forma"
_SUMMARY = "resumen del sitio: lo escribe el agente summary con otra forma (just local summary <url>)"


@dataclass(frozen=True)
class SourceFile:
    path: Path
    name: str
    profile: str | None


def omission(name: str) -> str | None:
    """Por qué un archivo antiguo no se copia, o None si se copia."""
    if name == "proposed.json":
        return _PROPOSAL
    if name.startswith("summary") and name.endswith((".json", ".md")):
        return _SUMMARY
    return None


def run_files(folder: Path, run: RunKey) -> tuple[list[SourceFile], list[str]]:
    """Los archivos que se copian a `run` y los omitidos con su motivo; falla si uno no cabe en el layout."""
    files: list[SourceFile] = []
    omitted: list[str] = []
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        parts = path.relative_to(folder).parts
        if any(part.startswith(".") for part in parts):
            continue
        if len(parts) > 2:
            raise InvalidKey(f"ruta demasiado profunda: {path.relative_to(folder)}")
        if reason := omission(parts[-1]):
            omitted.append(f"{'/'.join(parts)}: {reason}")
            continue
        profile = parts[0] if len(parts) == 2 else None
        name = RENAMED.get(parts[-1], parts[-1])
        run.file(name, profile)
        files.append(SourceFile(path, name, profile))
    return files, omitted
