"""Propuesta de ruta: el intento que logró la tarea con menos pasos que la referencia, junto a ella.

El Mapeador la verifica repitiéndola (`adopt`); el evaluador solo la escribe.
"""

import json
from pathlib import Path

from reference import find_reference, visited_nodes

_STEP_FIELDS = ("number", "action", "action_input", "description", "element", "url_before", "title_before", "url", "title")


def proposal(run: dict, route: dict, batch: str) -> dict:
    nodes = visited_nodes(run)
    return {
        "status": "proposed",
        "instruction": run["instruction"],
        "start_url": run["start_url"],
        "batch": batch,
        "profile": run["profile"],
        "steps_count": len(run["steps"]),
        "reference_min_steps": route["totals"]["min_steps"],
        "nodes": nodes,
        "final_node": nodes[-1],
        "steps": [{key: step.get(key) for key in _STEP_FIELDS} for step in run["steps"]],
    }


def _steps_count(path: Path) -> int | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))["steps_count"]
    except (OSError, ValueError, KeyError):
        return None


def write_proposals(output_dir: Path, batch_dir: Path, runs: list[dict], comparison: dict) -> list[str]:
    """Una propuesta por ruta superada, con el intento más corto; no reemplaza una anterior con menos pasos.

    Devuelve los archivos de propuesta, relativos a `output_dir`.
    """
    shortest: dict[Path, tuple[dict, dict]] = {}
    runs_by_profile = {run["profile"]: run for run in runs}
    for row in comparison["runs"]:
        run = runs_by_profile[row["profile"]]
        found = find_reference(output_dir, run["start_url"], run["instruction"], run["profile"]) if row["beat_reference"] else None
        if found is None:
            continue
        path = found[0].parent / "proposed.json"
        if path not in shortest or len(run["steps"]) < len(shortest[path][0]["steps"]):
            shortest[path] = (run, found[1])
    for path, (run, route) in shortest.items():
        previous = _steps_count(path)
        if previous is None or len(run["steps"]) < previous:
            document = proposal(run, route, batch_dir.name)
            path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    return [str(path.relative_to(output_dir)) for path in shortest]
