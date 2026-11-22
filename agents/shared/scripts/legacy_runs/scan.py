"""Plan de la migración: qué corrida del almacén sale de cada carpeta antigua, o por qué no sale ninguna.

Layout antiguo, bajo la raíz:
  <tarea u objetivo>/<YYYY-MM-DD_HH-MM-SS>/   tanda del evaluador        → <host>/visitor/<goal>/<run>
  <YYYY-MM-DD_HH-MM-SS>/                      tanda libre (--url)        → <host>/visitor/libre-…/<run>
  [<tarea u objetivo>/]reference/<viewport>/  ruta del mapeador          → <host>/guide/<goal>/<viewport>/<run>
  <host>/goals/                               catálogo del mapeador      → <host>/cataloger/<run>
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, cast

from legacy_runs.files import SourceFile, run_files
from legacy_runs.moments import batch_moment, is_batch_name, modified
from legacy_runs.old_ids import NOT_RUNS, OLD_TASK_GOALS
from shared import store
from shared.catalog.goal import instruction_goal_id
from shared.store.keys import AGENTS

Outcome = Literal["succeeded", "failed"]


@dataclass(frozen=True)
class Migration:
    source: Path
    prefix: store.RunPrefix
    started: datetime
    finished: datetime
    model: str | None
    status: Outcome
    files: tuple[SourceFile, ...]
    omitted: tuple[str, ...]

    @property
    def run(self) -> store.RunKey:
        return self.prefix.run(store.format_run_id(self.started))


@dataclass(frozen=True)
class Skip:
    source: Path
    reason: str


Item = Migration | Skip


class Unmappable(ValueError):
    pass


def _read(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise Unmappable(f"falta {path.name}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as error:
        raise Unmappable(f"{path.name} ilegible: {error}") from error
    if not isinstance(data, dict):
        raise Unmappable(f"{path.name} no es un objeto")
    return data


def _children(folder: Path) -> list[Path]:
    return sorted(child for child in folder.iterdir() if not child.name.startswith("."))


def _migration(folder: Path, prefix: store.RunPrefix, started: datetime, model: str | None,
               status: Outcome = "succeeded") -> Migration:
    files, omitted = run_files(folder, prefix.run(store.format_run_id(started)))
    finished = max(started, modified(file.path for file in files))
    return Migration(folder, prefix, started, finished, model, status, tuple(files), tuple(omitted))


def _check_task_id(document: dict[str, Any], old_id: str | None) -> None:
    if document.get("task_id") != old_id:
        raise Unmappable(f"task_id {document.get('task_id')!r} no corresponde a la carpeta ({old_id!r})")


def _batch(folder: Path, old_id: str | None, goals: dict[str, str]) -> Migration:
    tree = _read(folder / "route_tree.json")
    if not (folder / "report.md").is_file():
        raise Unmappable("sin report.md: la tanda no terminó")
    _check_task_id(tree, old_id)
    goal = goals[old_id] if old_id else instruction_goal_id(tree["instruction"])
    runs = [_read(profile / "run.json") for profile in _children(folder) if profile.is_dir()]
    # Como en el Visitante: sin un intento que cargó la página y no se interrumpió, la corrida es failed.
    attempted = any(run.get("start") and run.get("verdict", {}).get("outcome") != "interrupted" for run in runs)
    return _migration(folder, store.visitor(tree["url"], goal), batch_moment(folder.name, runs),
                      tree.get("user_model"), "succeeded" if attempted else "failed")


def _route(folder: Path, old_id: str | None, goals: dict[str, str]) -> Migration:
    route = _read(folder / "route.json")
    _check_task_id(route, old_id)
    goal = goals[old_id] if old_id else instruction_goal_id(route["instruction"])
    prefix = store.guide(route["start_url"], goal, cast(store.Viewport, folder.name))
    return _migration(folder, prefix, modified([folder / "route.json"]), route.get("model"))


def _catalog(folder: Path) -> Migration:
    catalog = _read(folder / "goals.json")
    return _migration(folder, store.cataloger(catalog["start_url"]), modified([folder / "goals.json"]),
                      catalog.get("model"))


def _attempt(source: Path, build: Callable[..., Migration], *args: Any) -> Item:
    """La migración de `source`, o por qué no se puede: nada se adivina."""
    try:
        return build(source, *args)
    except ValueError as error:  # incluye Unmappable, InvalidKey y un JSON ilegible
        return Skip(source, str(error))
    except (KeyError, TypeError, OSError) as error:
        return Skip(source, f"{type(error).__name__}: {error}")


def _routes(folder: Path, old_id: str | None, goals: dict[str, str]) -> list[Item]:
    return [_attempt(child, _route, old_id, goals) if child.is_dir() else Skip(child, "no es una carpeta de viewport")
            for child in _children(folder)]


def _goal_folder(folder: Path, goals: dict[str, str]) -> list[Item]:
    items: list[Item] = []
    for child in _children(folder):
        if child.is_dir() and is_batch_name(child.name):
            items.append(_attempt(child, _batch, folder.name, goals))
        elif child.is_dir() and child.name == "reference":
            items += _routes(child, folder.name, goals)
        else:
            items.append(Skip(child, "no es una tanda ni reference/"))
    return items


def _host_folder(folder: Path) -> list[Item]:
    items: list[Item] = []
    for child in _children(folder):
        if child.name == "goals" and child.is_dir():
            items.append(_attempt(child, _catalog))
        elif child.name in AGENTS:
            items.append(Skip(child, "ya tiene el layout del almacén"))
        else:
            items.append(Skip(child, "no es un catálogo"))
    return items


def _catalog_goal_ids(root: Path) -> set[str]:
    """Los ids de los objetivos de los catálogos antiguos: sus carpetas usan ese id tal cual."""
    ids: set[str] = set()
    for path in root.glob("*/goals/goals.json"):
        try:
            ids |= {goal["id"] for goal in json.loads(path.read_text(encoding="utf-8"))["goals"]}
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return ids


def scan(root: Path) -> list[Item]:
    goals = {goal_id: goal_id for goal_id in _catalog_goal_ids(root)} | OLD_TASK_GOALS
    items: list[Item] = []
    for entry in _children(root):
        if not entry.is_dir():
            items.append(Skip(entry, "archivo suelto"))
        elif entry.name in NOT_RUNS:
            items.append(Skip(entry, NOT_RUNS[entry.name]))
        elif is_batch_name(entry.name):
            items.append(_attempt(entry, _batch, None, goals))
        elif entry.name == "reference":
            items += _routes(entry, None, goals)
        elif entry.name in goals:
            items += _goal_folder(entry, goals)
        elif any(child.name == "goals" or child.name in AGENTS for child in entry.iterdir()):
            items += _host_folder(entry)
        else:
            items.append(Skip(entry, "ni tarea, ni objetivo de un catálogo, ni host"))
    return items
