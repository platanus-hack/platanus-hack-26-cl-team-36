"""Rutas de referencia para los objetivos del catálogo, con el mismo pipeline que una tarea."""

import json
from pathlib import Path

from playwright.async_api import Browser

from mapper import config
from mapper.goal_rules import complexity
from mapper.goals import Goal
from mapper.reference import Mapping, map_references


def route_path(goal: Goal) -> Path:
    return config.RUNS_DIR / goal.id / "reference" / "desktop" / "route.json"


def route_summary(document: dict, path: Path) -> dict:
    """Los datos de la ruta que necesita la comparación con un intento (niveles-de-tarea.md, sección 4).

    `route` queda relativa a agents/; los totales y nodos, solo si la ruta verificó.
    """
    verified = document["status"] == "verified"
    return {
        "status": document["status"],
        "steps": document["totals"]["min_steps"] if verified else None,
        "pages": document["totals"]["distinct_pages"] if verified else None,
        "nodes": document["nodes"] if verified else None,
        "key_nodes": [document["final_node"]] if verified else None,
        "route": str(path.relative_to(config.AGENTS_DIR)),
    }


def _apply(goal: Goal, document: dict) -> None:
    """Completa `reference_route`; si verificó, `complexity` y la respuesta de un `find_info`."""
    goal.reference_route = route_summary(document, route_path(goal))
    if document["status"] == "verified":
        goal.complexity = complexity(document["totals"]["min_steps"])
        if goal.intent == "find_info":
            goal.expected_answer = document["answer"] or None


def resume_routes(goals: list[Goal]) -> list[Goal]:
    """Toma de disco las rutas ya verificadas para la instrucción actual y devuelve los objetivos que faltan."""
    pending = []
    for goal in goals:
        path = route_path(goal)
        document = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        if document.get("status") == "verified" and document.get("instruction") == goal.instruction:
            _apply(goal, document)
        else:
            pending.append(goal)
    return pending


async def map_goal_routes(
    browser: Browser, goals: list[Goal], model: str, effort: str, claude_cwd: Path, extra_routes: int
) -> None:
    mappings = [
        Mapping(goal.id, goal.start_url, goal.instruction, "desktop", config.VIEWPORTS["desktop"], model, effort,
                route_path(goal).parent, extra_routes)
        for goal in goals
    ]
    documents = await map_references(browser, mappings, claude_cwd, config.ROUTE_CONCURRENCY)
    for goal, document in zip(goals, documents):
        if isinstance(document, BaseException):
            print(f"[{goal.id}] la ruta falló: {type(document).__name__}: {document}", flush=True)
        else:
            _apply(goal, document)
