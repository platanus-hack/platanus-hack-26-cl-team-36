"""Propuesta de ruta: el intento que logró la tarea con menos pasos que la referencia, en proposals.json.

La Guía la verifica repitiéndola (`adopt`); el Visitante solo la escribe.
"""

from visitor.comparison import References, reference_for, visited_nodes
from visitor.profiles import profile_of

_STEP_FIELDS = ("number", "action", "action_input", "description", "element", "url_before", "title_before", "url", "title")


def proposal(run: dict, route: dict, route_run: str) -> dict:
    nodes = visited_nodes(run)
    return {
        "route": route_run,
        "instruction": run["instruction"],
        "start_url": run["start_url"],
        "profile": run["profile"],
        "steps_count": len(run["steps"]),
        "reference_min_steps": route["totals"]["min_steps"],
        "nodes": nodes,
        "final_node": nodes[-1],
        "steps": [{key: step.get(key) for key in _STEP_FIELDS} for step in run["steps"]],
    }


def proposals(runs: list[dict], comparison: dict, references: References) -> list[dict]:
    """Una propuesta por ruta superada, con el intento más corto."""
    shortest: dict[str, tuple[dict, dict]] = {}
    runs_by_folder = {run.get("folder") or run["profile"]: run for run in runs}
    for row in comparison["runs"]:
        run = runs_by_folder[row["run"]]
        found = reference_for(references, run["profile"]) if row["beat_reference"] else None
        # Un intento medido contra la ruta de otra pantalla no la reemplaza.
        if found is None or found[1].get("viewport", "desktop") != profile_of(run["profile"]).screen.viewport:
            continue
        key = str(found[0])
        if key not in shortest or len(run["steps"]) < len(shortest[key][0]["steps"]):
            shortest[key] = (run, found[1])
    return [proposal(run, route, key) for key, (run, route) in shortest.items()]
