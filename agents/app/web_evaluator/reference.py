"""Comparación de los intentos con la ruta de referencia que deja el Mapeador.

Las métricas y sus fuentes están en docs/agents/niveles-de-tarea.md, sección 5.
"""

import json
import statistics
from pathlib import Path

from route_tree import node_key


def find_reference(output_dir: Path, url: str, instruction: str, profile: str) -> tuple[Path, dict] | None:
    """El route.json verificado de esta tarea para el viewport del perfil, si el Mapeador lo dejó en `output_dir`."""
    for path in sorted(output_dir.glob("reference/*/route.json")):
        try:
            route = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (
            route.get("status") == "verified"
            and profile in route.get("evaluator_profiles", [])
            and (route.get("start_url"), route.get("instruction")) == (url, instruction)
        ):
            return path, route
    return None


def load_reference(output_dir: Path, url: str, instruction: str, profile: str) -> dict | None:
    found = find_reference(output_dir, url, instruction, profile)
    return found[1] if found else None


def visited_nodes(run: dict) -> list[str]:
    """Nodos del intento en orden, sin repetir mientras se sigue en la misma página."""
    nodes = [node_key(run["start"]["url"], run["start"]["title"])]
    for step in run["steps"]:
        node = node_key(step["url"], step["title"])
        if node != nodes[-1]:
            nodes.append(node)
    return nodes


def _common_subsequence(a: list[str], b: list[str]) -> int:
    lengths = [0] * (len(b) + 1)
    for item in a:
        previous = 0
        for index, other in enumerate(b, 1):
            current = lengths[index]
            lengths[index] = previous + 1 if item == other else max(current, lengths[index - 1])
            previous = current
    return lengths[-1]


def compare(run: dict, route: dict) -> dict:
    """Métricas de un intento contra la ruta: eficiencia, desorientación, llegada y similitud."""
    min_steps = route["totals"]["min_steps"]
    steps = len(run["steps"])
    success = run["verdict"].get("outcome") == "success"
    nodes = visited_nodes(run)
    distinct = len(set(nodes))
    revisits = distinct / len(nodes)                      # N/T: 1 si no volvió a ninguna página
    # R/N, acotado a 1: un intento que se detuvo antes de recorrer la ruta no cuenta como desvío.
    detour = min(1.0, route["totals"]["distinct_pages"] / distinct)
    return {
        "profile": run["profile"],
        "steps": steps,
        "min_steps": min_steps,
        "efficiency": round(min_steps / steps if steps > min_steps else 1.0, 2) if success else 0.0,
        "beat_reference": success and steps < min_steps,
        "lostness": round((revisits - 1) ** 2 + (detour - 1) ** 2, 2),
        "revisits": round(revisits, 2),
        "detour": round(detour, 2),
        "reached_final_node": route["final_node"] in nodes,
        "similarity": round(_common_subsequence(nodes, route["nodes"]) / len(nodes), 2),
    }


def compare_batch(output_dir: Path, url: str, instruction: str, runs: list[dict]) -> dict | None:
    """Compara cada intento con la ruta de su viewport. None si ninguno tiene ruta de referencia."""
    rows = []
    for run in runs:
        route = load_reference(output_dir, url, instruction, run["profile"])
        if route:
            rows.append(compare(run, route))
    if not rows:
        return None
    return {"spl": round(statistics.mean(row["efficiency"] for row in rows), 2), "runs": rows}


def report_section(comparison: dict, profile_names: dict[str, str]) -> list[str]:
    lines = [
        "",
        "## Contra la ruta de referencia",
        "",
        f"Eficiencia de la tanda (SPL): **{comparison['spl']:.2f}**. "
        "1 es lograr la tarea con los pasos mínimos; un intento sin éxito vale 0.",
        "",
        "| Perfil | Pasos / mínimos | Eficiencia | Desorientación | Llegó a la página final | Similitud |",
        "|---|---|---|---|---|---|",
    ]
    for row in comparison["runs"]:
        fewer = " (menos que la referencia)" if row["beat_reference"] else ""
        lines.append(
            f"| {profile_names.get(row['profile'], row['profile'])} | {row['steps']} / {row['min_steps']}{fewer} | "
            f"{row['efficiency']:.2f} | {row['lostness']:.2f} | {'sí' if row['reached_final_node'] else 'no'} | "
            f"{row['similarity']:.2f} |"
        )
    for path in comparison.get("proposals", []):
        lines += ["", f"Un intento logró la tarea con menos pasos que la referencia: queda propuesto en `{path}`."]
    return lines
