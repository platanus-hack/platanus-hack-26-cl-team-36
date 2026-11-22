"""Comparación de los intentos con la ruta de referencia que deja la Guía.

Las métricas y sus fuentes están en docs/agents/niveles-de-tarea.md, sección 5.
"""

import math
import statistics
from urllib.parse import parse_qsl, urlsplit

from shared import store
from shared.catalog.routes import verified_route
from shared.nodes.urls import node_key

from visitor.profiles import PROFILES, profile_of


References = dict[str, tuple[store.RunKey, dict]]
"""Por viewport, la corrida de guide y su route.json."""

FALLBACK_VIEWPORT = "desktop"
"""La Guía traza por defecto solo en escritorio: su página final también sirve para medir a los demás."""


def reference_viewports(profile_keys: list[str]) -> list[str]:
    """Los viewports cuya ruta se busca. Los exploradores recorren el sitio a propósito y no tienen referencia."""
    viewports = dict.fromkeys(PROFILES[key].screen.viewport for key in profile_keys if not PROFILES[key].explora)
    return list(viewports | dict.fromkeys([FALLBACK_VIEWPORT])) if viewports else []


def find_references(backend: store.Backend, url: str, goal: str, instruction: str, profile_keys: list[str]) -> References:
    """Las rutas verificadas vigentes de la Guía para los viewports de los perfiles."""
    found = {viewport: verified_route(backend, url, goal, viewport, instruction)
             for viewport in reference_viewports(profile_keys)}
    return {viewport: route for viewport, route in found.items() if route}


def reference_for(references: References, profile: str) -> tuple[store.RunKey, dict] | None:
    """La ruta de la pantalla del perfil o, si no hay, la de escritorio."""
    found = profile_of(profile)
    if found is None or found.explora:
        return None
    return references.get(found.screen.viewport) or references.get(FALLBACK_VIEWPORT)


def visited_nodes(run: dict) -> list[str]:
    """Nodos del intento en orden, sin repetir mientras se sigue en la misma página."""
    nodes = [node_key(run["start"]["url"], run["start"]["title"])]
    for step in run["steps"]:
        node = node_key(step["url"], step["title"])
        if node != nodes[-1]:
            nodes.append(node)
    return nodes


def _page(node: str) -> tuple[str, str, frozenset[str]]:
    parts = urlsplit(node.split(" | ", 1)[0])
    return parts.netloc, parts.path, frozenset(key for key, _ in parse_qsl(parts.query, keep_blank_values=True))


def reached(final_node: str, run: dict) -> bool:
    """Si el intento pasó por la página final. Si su URL trae query (un formulario enviado, como el planificador con
    `?inicio=..&fin=..`), basta el mismo pathname con las mismas claves en una página sin error HTTP: elegir otros
    valores también es llegar, pero un 403 en esa URL no."""
    if final_node in visited_nodes(run):
        return True
    final = _page(final_node)
    return bool(final[2]) and any(
        _page(node_key(step["url"], step["title"])) == final for step in run["steps"] if not step.get("error_detail")
    )


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
        "run": run.get("folder") or run["profile"],
        "reference_viewport": route.get("viewport"),
        "steps": steps,
        "min_steps": min_steps,
        "efficiency": round(min_steps / steps if steps > min_steps else 1.0, 2) if success else 0.0,
        "beat_reference": success and steps < min_steps,
        "lostness": round(math.sqrt((revisits - 1) ** 2 + (detour - 1) ** 2), 2),
        "revisits": round(revisits, 2),
        "detour": round(detour, 2),
        "reached_final_node": reached(route["final_node"], run),
        "similarity": round(_common_subsequence(nodes, route["nodes"]) / len(nodes), 2),
    }


def compare_batch(references: References, runs: list[dict]) -> dict | None:
    """Compara cada intento con la ruta de su viewport, sin los interrumpidos. None si ninguno se compara."""
    rows = []
    for run in runs:
        found = reference_for(references, run["profile"])
        if found and run["verdict"].get("outcome") != "interrupted":
            rows.append(compare(run, found[1]))
    if not rows:
        return None
    return {"spl": round(statistics.mean(row["efficiency"] for row in rows), 2), "runs": rows}


def report_section(comparison: dict, run_names: dict[str, str]) -> list[str]:
    """`run_names`: el nombre de cada intento por su carpeta (`run` de cada fila)."""
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
            f"| {run_names.get(row.get('run', row['profile']), row['profile'])} | {row['steps']} / {row['min_steps']}{fewer} | "
            f"{row['efficiency']:.2f} | {row['lostness']:.2f} | {'sí' if row['reached_final_node'] else 'no'} | "
            f"{row['similarity']:.2f} |"
        )
    for route in comparison.get("proposals", []):
        lines += ["", f"Un intento logró la tarea con menos pasos que la ruta `{route}`: queda propuesto en proposals.json."]
    return lines
