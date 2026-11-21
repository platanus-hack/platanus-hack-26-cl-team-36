"""Filas del resumen: cada objetivo del catálogo con su ruta de la Guía y su última tanda del Visitante."""

import statistics

from shared import store
from shared.browser.viewports import SCREENS
from shared.catalog.goal import Goal
from shared.catalog.outline import SiteOutline
from shared.catalog.prominence import complexity, route_prominence
from shared.catalog.routes import current_route, current_visit
from shared.store import parse_key


Found = tuple[store.RunKey, dict]


def _routes(backend: store.Backend, goal: Goal) -> list[Found]:
    """Las rutas vigentes de esta instrucción, una por viewport que tenga."""
    return [route for viewport in SCREENS
            if (route := current_route(backend, goal.start_url, goal.id, viewport, goal.instruction))]


def _runs(backend: store.Backend, batch: store.RunKey) -> list[dict]:
    comparison_key = batch.file("comparison.json")
    comparison = backend.read_json(comparison_key) if backend.exists(comparison_key) else {"runs": []}
    compared = {row["profile"]: row for row in comparison["runs"]}
    runs = []
    for profile in backend.list_profiles(batch):
        run = backend.read_json(batch.file("run.json", profile))
        if run.get("verdict"):
            row = compared.get(run["profile"], {})
            runs.append({"profile": run["profile"], "outcome": run["verdict"].get("outcome"), "steps": len(run["steps"]),
                         "efficiency": row.get("efficiency"), "beat_reference": row.get("beat_reference", False)})
    return runs


def _proposal(backend: store.Backend, route: Found | None, batch: store.RunKey | None) -> str | None:
    """`promoted` si la ruta vigente se adoptó de un intento; `proposed` si la última tanda dejó una propuesta."""
    if route and any(parse_key(key).run.prefix.agent == "visitor"
                     for key in store.read_manifest(backend, route[0]).inputs):
        return "promoted"
    return "proposed" if batch and backend.exists(batch.file("proposals.json")) else None


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


def goal_row(backend: store.Backend, goal: Goal, outline: SiteOutline,
             tema: str | None = None) -> tuple[dict, list[store.RunKey]]:
    """La fila del objetivo, con `report` como clave del almacén, y las corridas que leyó.

    La tanda es la vigente con ese tema (sha256 corto; None = el sitio tal cual).
    """
    routes = _routes(backend, goal)
    found = next((item for item in routes if item[1].get("status") == "verified"), routes[0] if routes else None)
    route = found[1] if found else None
    visit = current_visit(backend, goal.start_url, goal.id, goal.instruction, tema)
    batch = visit[0] if visit else None
    runs = _runs(backend, batch) if batch else []
    row = {
        "id": goal.id, "description": goal.description, "level": goal.level, "intent": goal.intent,
        **_classification(goal, route, outline),
        "route_status": route.get("status") if route else None,
        "min_steps": route["totals"]["min_steps"] if route and route.get("status") == "verified" else None,
        "routes_tried": (route.get("search") or {}).get("tried", 1) if route else None,
        "runs": runs,
        "fewer": _fewer(route, runs),
        "proposal": _proposal(backend, found, batch),
        "report": batch.file("report.md") if batch else None,
        "not_run": None if runs else _not_run(goal, route),
    }
    return row, [key for key, _ in routes] + ([batch] if batch else [])


def _attempts(runs: list[dict]) -> list[dict]:
    """Los intentos reales: uno interrumpido por un error técnico no cuenta como éxito ni como fallo."""
    return [run for run in runs if run["outcome"] != "interrupted"]


def totals(rows: list[dict]) -> dict:
    every = [run for row in rows for run in row["runs"]]
    runs = _attempts(every)
    compared = [run["efficiency"] for run in runs if run["efficiency"] is not None]
    successes = sum(run["outcome"] == "success" for run in runs)
    return {
        "goals": len(rows),
        "mapped": sum(row["route_status"] is not None for row in rows),
        "verified": sum(row["route_status"] == "verified" for row in rows),
        "evaluated": sum(bool(_attempts(row["runs"])) for row in rows),
        "runs": len(runs),
        "interrupted": len(every) - len(runs),
        "successes": successes,
        "success_rate": round(successes / len(runs), 2) if runs else None,
        "spl": round(statistics.mean(compared), 2) if compared else None,
        "beat_reference": sum(run["beat_reference"] for run in runs),
        "proposals": sum(row["proposal"] is not None for row in rows),
    }
