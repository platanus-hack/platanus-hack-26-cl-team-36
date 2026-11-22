"""Rutas de referencia para los objetivos de un catálogo, con el mismo pipeline que una tarea."""

import json
from pathlib import Path

from shared.browser.viewports import SCREENS
from shared.catalog.goal import Goal, routable

from guide import config
from guide.reference import Mapping


def route_path(goal: Goal) -> Path:
    return config.RUNS_DIR / goal.id / "reference" / "desktop" / "route.json"


def _verified(goal: Goal) -> bool:
    """Si ya tiene una ruta verificada para su instrucción actual."""
    path = route_path(goal)
    document = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    return document.get("status") == "verified" and document.get("instruction") == goal.instruction


def pending_routes(goals: list[Goal], limit: int | None, rerun: bool) -> list[Goal]:
    """Los objetivos por mapear para que haya hasta `limit` con ruta verificada; las ya verificadas cuentan y no se rehacen."""
    candidates = routable(goals, None)
    if rerun:
        return candidates[:limit]
    pending = [goal for goal in candidates if not _verified(goal)]
    done = len(candidates) - len(pending)
    if done:
        print(f"[rutas] ya verificadas: {done}", flush=True)
    return pending if limit is None else pending[:max(0, limit - done)]


def goal_mappings(goals: list[Goal], model: str, effort: str, extra_routes: int) -> list[Mapping]:
    return [
        Mapping(goal.id, goal.start_url, goal.instruction, SCREENS["desktop"], model, effort, route_path(goal).parent,
                extra_routes)
        for goal in goals
    ]
