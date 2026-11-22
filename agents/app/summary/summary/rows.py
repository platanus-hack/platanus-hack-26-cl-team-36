"""Filas del resumen: cada objetivo del catálogo con su ruta de la Guía y su última tanda del Visitante."""

import json
import os
import statistics
from pathlib import Path

from shared.browser.viewports import SCREENS
from shared.catalog.goal import Goal
from shared.catalog.outline import SiteOutline
from shared.catalog.prominence import complexity, route_prominence
from shared.catalog.visits import tandas_con_tema


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _route(goal_dir: Path, goal: Goal) -> dict | None:
    """La ruta de esta instrucción: una verificada si hay, si no la primera."""
    routes = [route for path in sorted(goal_dir.glob("reference/*/route.json")) if (route := _read(path))
              and (route.get("start_url"), route.get("instruction")) == (goal.start_url, goal.instruction)]
    return next((route for route in routes if route.get("status") == "verified"), routes[0] if routes else None)


def _latest_batch(goal_dir: Path, tema: str | None) -> Path | None:
    batches = tandas_con_tema(goal_dir, tema)
    return batches[-1] if batches else None


def _runs(batch: Path) -> list[dict]:
    comparison = _read(batch / "reference_comparison.json") or {"runs": []}
    compared = {row["profile"]: row for row in comparison["runs"]}
    runs = []
    for path in sorted(batch.glob("*/run.json")):
        run = _read(path)
        if run and run.get("verdict"):
            row = compared.get(run["profile"], {})
            runs.append({"profile": run["profile"], "outcome": run["verdict"].get("outcome"), "steps": len(run["steps"]),
                         "efficiency": row.get("efficiency"), "beat_reference": row.get("beat_reference", False)})
    return runs


def _fewer(route: dict | None, runs: list[dict]) -> str | None:
    """Quién necesitó menos pasos: la Guía (pasos mínimos) o el mejor intento con éxito."""
    successes = [run["steps"] for run in runs if run["outcome"] == "success"]
    if not route or route.get("status") != "verified" or not successes:
        return None
    best, reference = min(successes), route["totals"]["min_steps"]
    return "igual" if best == reference else ("visitante" if best < reference else "guía")


def _not_run(goal: Goal, route: dict | None) -> str:
    if goal.exclusion:
        return goal.exclusion
    if route is None:
        return "sin ruta (límite o error)"
    if route.get("status") != "verified":
        return f"ruta {route.get('status')}"
    return "sin tanda (límite o error)"


def _classification(goal: Goal, route: dict | None, outline: SiteOutline) -> dict:
    """Prominencia y complejidad: con una ruta verificada, salen de ella; si no, la prominencia es la del catálogo."""
    if not route or route.get("status") != "verified":
        return {"prominence": goal.prominence, "complexity": None}
    from_route = route_prominence(route["steps"], outline, SCREENS["desktop"].height)
    return {"prominence": from_route or goal.prominence, "complexity": complexity(route["totals"]["actions"])}


def goal_row(goal: Goal, outline: SiteOutline, runs_dir: Path, summary_dir: Path, tema: str | None = None) -> dict:
    goal_dir = runs_dir / goal.id
    route = _route(goal_dir, goal)
    batch = _latest_batch(goal_dir, tema)
    runs = _runs(batch) if batch else []
    proposals = [proposal["status"] for path in goal_dir.glob("reference/*/proposed.json") if (proposal := _read(path))]
    return {
        "id": goal.id, "description": goal.description, "level": goal.level, "intent": goal.intent,
        **_classification(goal, route, outline),
        "route_status": route.get("status") if route else None,
        "min_steps": route["totals"]["min_steps"] if route and route.get("status") == "verified" else None,
        "routes_tried": (route.get("search") or {}).get("tried", 1) if route else None,
        "runs": runs,
        "fewer": _fewer(route, runs),
        "proposal": proposals[0] if proposals else None,
        "report": os.path.relpath(batch / "report.md", summary_dir) if batch else None,
        "not_run": None if runs else _not_run(goal, route),
    }


def totals(rows: list[dict]) -> dict:
    runs = [run for row in rows for run in row["runs"]]
    compared = [run["efficiency"] for run in runs if run["efficiency"] is not None]
    successes = sum(run["outcome"] == "success" for run in runs)
    return {
        "goals": len(rows),
        "mapped": sum(row["route_status"] is not None for row in rows),
        "verified": sum(row["route_status"] == "verified" for row in rows),
        "evaluated": sum(bool(row["runs"]) for row in rows),
        "runs": len(runs),
        "successes": successes,
        "success_rate": round(successes / len(runs), 2) if runs else None,
        "spl": round(statistics.mean(compared), 2) if compared else None,
        "beat_reference": sum(run["beat_reference"] for run in runs),
        "proposals": sum(row["proposal"] is not None for row in rows),
    }
