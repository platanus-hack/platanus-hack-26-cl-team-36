"""Rutas de referencia para los objetivos del catálogo, con el mismo pipeline que una tarea."""

from pathlib import Path

from playwright.async_api import Browser

from mapper import config
from mapper.goal_rules import complexity
from mapper.goals import Goal
from mapper.reference import Mapping, map_references

# El Mapeador no envía formularios: en un objetivo `transact` la ruta llega hasta el paso anterior al envío.
_TRANSACT_SUFFIX = (
    " Llega hasta el último paso antes de enviar, pagar o confirmar, sin hacerlo, y termina citando el texto de esa"
    " pantalla."
)


def instruction(goal: Goal) -> str:
    return goal.description + (_TRANSACT_SUFFIX if goal.intent == "transact" else "")


def route_summary(document: dict, route_path: Path) -> dict:
    """Los datos de la ruta que necesita la comparación con un intento (niveles-de-tarea.md, sección 4).

    `route` queda relativa a agents/.
    """
    return {
        "status": document["status"],
        "steps": document["totals"]["min_steps"],
        "pages": document["totals"]["distinct_pages"],
        "nodes": document["nodes"],
        "key_nodes": [document["final_node"]],
        "route": str(route_path.relative_to(config.AGENTS_DIR)),
    }


async def map_goal_routes(browser: Browser, goals: list[Goal], model: str, effort: str, claude_cwd: Path) -> None:
    """Mapea la ruta de cada objetivo y completa `reference_route`, `complexity` y, si verificó, `expected_answer`."""
    mappings = [
        Mapping(goal.id, goal.start_url, instruction(goal), "desktop", config.VIEWPORTS["desktop"], model, effort,
                config.RUNS_DIR / goal.id / "reference" / "desktop")
        for goal in goals
    ]
    documents = await map_references(browser, mappings, claude_cwd, config.ROUTE_CONCURRENCY)
    for goal, mapping, document in zip(goals, mappings, documents):
        if isinstance(document, BaseException):
            print(f"[{goal.id}] la ruta falló: {type(document).__name__}: {document}", flush=True)
            continue
        goal.reference_route = route_summary(document, mapping.out_dir / "route.json")
        if document["status"] == "verified":
            goal.complexity = complexity(document["totals"]["min_steps"])
            goal.expected_answer = document["answer"] or None
