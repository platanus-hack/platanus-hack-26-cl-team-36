"""Unión de recorridos en un árbol de rutas y cálculo de la ruta recomendada.

- Nodo  = URL normalizada + título de la página.
- Rama  = acción que lleva de un nodo a otro. Se identifica por el texto del
          elemento clicado (no por coordenadas), así escritorio y móvil se unen.
- Costo = -ln((éxitos + 1) / (éxitos + fallos + 2)) por rama.
- Salto = `volver_a_nodo` de un explorador: lo lleva directo a una página ya vista. Queda en `branches` con
          `"salto": true` para que se vea la vuelta, pero no es un camino que una persona pueda seguir, así que la
          ruta recomendada nunca lo usa.

En un intento con éxito, un tramo cuenta como éxito solo si desde su destino el usuario llegó, por tramos hacia
adelante (ni saltos, ni retrocesos, ni vueltas a una página ya vista), a la página donde terminó. Las ramas que exploró y abandonó, y las vueltas a una página
ya vista (salvo a la final), cuentan como fallo aunque el intento haya tenido éxito.
"""

import heapq
import math
import statistics
from urllib.parse import urlsplit

from shared.nodes.urls import node_key, normalize_url

ERROR_SIGNALS = {"no_effect", "visible_error", "went_back"}
SALTO = "volver_a_nodo"
_CLICK_LABELS = {"left_click": "clic", "double_click": "doble clic", "triple_click": "triple clic"}

# Segundos niveles bajo un dominio de país que se registran como si fueran el dominio de primer nivel (gob.cl, com.ar,
# co.uk). Aproxima la Public Suffix List sin depender de ella; alcanza para decidir si dos páginas son del mismo sitio.
_SEGUNDOS_NIVELES = {"ac", "co", "com", "edu", "gob", "gov", "mil", "net", "nom", "org"}


def registrable_domain(url: str) -> str | None:
    """El dominio registrable de una URL http(s) (bibliotecanacional.gob.cl, metro.cl); None si no es http(s)."""
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return None
    host = parts.hostname.lower().rstrip(".")
    if host.replace(".", "").isdigit() or ":" in host:  # una IP: el sitio es la IP misma
        return host
    labels = host.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SEGUNDOS_NIVELES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def action_signature(step: dict) -> str:
    action = step["action"]
    if action in _CLICK_LABELS:
        element = step.get("element") or {}
        label = element.get("text") or element.get("href") or element.get("tag")
        if label:
            return f"{_CLICK_LABELS[action]} «{label}»"
    return step["description"]


def branch_cost(successes: int, failures: int) -> float:
    return -math.log((successes + 1) / (successes + failures + 2))


def build_route_tree(runs: list[dict]) -> dict:
    """Une recorridos (dicts de Run.to_dict()) en nodos, ramas y ruta recomendada."""
    nodes: dict[str, dict] = {}
    branches: dict[tuple, dict] = {}

    def visit(key: str, url: str, title: str, profile: str) -> dict:
        if key not in nodes:
            nodes[key] = {
                "id": f"n{len(nodes) + 1}",
                "url": normalize_url(url),
                "title": (title or "").strip(),
                "visits": 0,
                "profiles": [],
                "is_start": False,
                "endings": {"success": 0, "failed": 0, "abandoned": 0},
            }
        node = nodes[key]
        node["visits"] += 1
        if profile not in node["profiles"]:
            node["profiles"].append(profile)
        return node

    for run in runs:
        profile = run["profile"]
        outcome = (run.get("verdict") or {}).get("outcome", "abandoned")
        start = run["start"]
        current = node_key(start["url"], start["title"])
        visit(current, start["url"], start["title"], profile)["is_start"] = True
        last = run["steps"][-1] if run["steps"] else start
        final_node = node_key(last["url"], last["title"])

        # Un tramo es lo que pasa entre llegar a un nodo y salir de él hacia otro.
        legs: list[dict] = []
        arrived_at_s, steps_in_leg, signals_in_leg, in_page_actions = 0.0, 0, set(), []
        for step in run["steps"]:
            target = node_key(step["url"], step["title"])
            steps_in_leg += 1
            signals_in_leg |= set(step.get("signals", []))
            if target == current:
                in_page_actions.append(action_signature(step))
                continue  # acción dentro de la misma página: se suma al tramo
            visit(target, step["url"], step["title"], profile)
            legs.append({
                "source": current,
                "target": target,
                "signature": action_signature(step),
                "seconds": step["seconds_since_start"] - arrived_at_s,
                "steps": steps_in_leg,
                "signals": signals_in_leg,
                "salto": step["action"] == SALTO,
                "preceding_actions": in_page_actions,
            })
            current = target
            arrived_at_s, steps_in_leg, signals_in_leg, in_page_actions = step["seconds_since_start"], 0, set(), []

        nodes[current]["endings"][outcome] += 1
        useful = _leads_to(final_node, legs) if outcome == "success" else set()
        for leg in legs:
            failed = (
                leg["salto"]
                or leg["target"] not in useful
                or ("revisit" in leg["signals"] and leg["target"] != final_node)  # volver con un clic: exploración
                or bool(leg["signals"] & ERROR_SIGNALS)
            )
            key = (leg["source"], leg["target"], leg["signature"].casefold())
            branch = branches.setdefault(key, {
                "source": nodes[leg["source"]]["id"],
                "target": nodes[leg["target"]]["id"],
                "action": leg["signature"],
                "successes": 0,
                "failures": 0,
                "times_s": [],
                "steps": [],
                "profiles": [],
                "preceding_actions": [],
            })
            if leg["salto"]:
                branch["salto"] = True
            branch["failures" if failed else "successes"] += 1
            branch["times_s"].append(round(leg["seconds"], 1))
            branch["steps"].append(leg["steps"])
            branch["profiles"].append(profile)
            branch["preceding_actions"].append(
                {"profile": profile, "success": not failed, "actions": leg["preceding_actions"]}
            )

    branch_list = []
    for branch in branches.values():
        branch["median_time_s"] = round(statistics.median(branch["times_s"]), 1)
        branch["cost"] = round(branch_cost(branch["successes"], branch["failures"]), 4)
        branch_list.append(branch)

    node_list = list(nodes.values())
    return {
        "nodes": node_list,
        "branches": branch_list,
        "recommended_route": recommended_route(node_list, branch_list),
    }


def _leads_to(final_node: str, legs: list[dict]) -> set[str]:
    """Los nodos desde los que el usuario llegó a `final_node` siguiendo tramos hacia adelante.

    No cuentan los saltos, los retrocesos ni los clics que vuelven a una página ya vista (`revisit`, por ejemplo el
    logo para volver al inicio), salvo que esa página sea la final: si no, una rama abandonada parecería llevar a la
    respuesta solo porque desde ella se volvió al inicio.
    """
    incoming: dict[str, set[str]] = {}
    for leg in legs:
        backwards = leg["salto"] or "went_back" in leg["signals"]
        if backwards or ("revisit" in leg["signals"] and leg["target"] != final_node):
            continue
        incoming.setdefault(leg["target"], set()).add(leg["source"])
    useful, pending = {final_node}, [final_node]
    while pending:
        for source in incoming.get(pending.pop(), ()):
            if source not in useful:
                useful.add(source)
                pending.append(source)
    return useful


def _representative_preceding_actions(branch: dict) -> list[str]:
    """Acciones dentro de la página antes de la rama: las del recorrido exitoso más corto."""
    options = sorted(branch["preceding_actions"], key=lambda option: (not option["success"], len(option["actions"])))
    return options[0]["actions"] if options else []


def recommended_route(nodes: list[dict], branches: list[dict]) -> dict | None:
    """Ruta de menor costo desde un nodo inicial hasta un nodo donde algún usuario tuvo éxito.

    Además del costo de las ramas, se suma el de terminar en ese nodo
    (-ln((éxitos+1)/(finales+2))), para preferir los finales más confiables.
    """
    nodes_by_id = {node["id"]: node for node in nodes}
    outgoing: dict[str, list[dict]] = {}
    for branch in branches:
        if branch["source"] != branch["target"] and not branch.get("salto"):
            outgoing.setdefault(branch["source"], []).append(branch)

    goal = "__goal__"
    distance: dict[str, float] = {}
    previous: dict[str, tuple[str, dict | None]] = {}
    queue: list[tuple[float, int, str]] = []
    counter = 0
    for node in nodes:
        if node["is_start"]:
            distance[node["id"]] = 0.0
            heapq.heappush(queue, (0.0, counter, node["id"]))
            counter += 1

    while queue:
        cost, _, current = heapq.heappop(queue)
        if current == goal:
            break
        if cost > distance.get(current, math.inf):
            continue
        neighbors = [(branch["target"], branch["cost"], branch) for branch in outgoing.get(current, [])]
        endings = nodes_by_id[current]["endings"]
        if endings["success"] > 0:
            total = sum(endings.values())
            neighbors.append((goal, -math.log((endings["success"] + 1) / (total + 2)), None))
        for target, edge_cost, branch in neighbors:
            new_cost = cost + edge_cost
            if new_cost < distance.get(target, math.inf):
                distance[target] = new_cost
                previous[target] = (current, branch)
                heapq.heappush(queue, (new_cost, counter, target))
                counter += 1

    if goal not in distance:
        return None

    end_node, _ = previous[goal]
    steps = []
    current = end_node
    while current in previous:
        source, branch = previous[current]
        steps.append({
            "source": branch["source"],
            "target": branch["target"],
            "action": branch["action"],
            "successes": branch["successes"],
            "failures": branch["failures"],
            "median_time_s": branch["median_time_s"],
            "cost": branch["cost"],
            "preceding_actions": _representative_preceding_actions(branch),
        })
        current = source
    steps.reverse()
    total_cost = distance[goal]
    return {
        "start_node": current,
        "end_node": end_node,
        "steps": steps,
        "total_cost": round(total_cost, 4),
        "estimated_probability": round(math.exp(-total_cost), 3),
        "total_median_time_s": round(sum(step["median_time_s"] for step in steps), 1),
    }
