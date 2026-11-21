"""Unión de recorridos en un árbol de rutas y cálculo de la ruta recomendada.

- Nodo  = URL normalizada + título de la página.
- Rama  = acción que lleva de un nodo a otro. Se identifica por el texto del
          elemento clicado (no por coordenadas), así escritorio y móvil se unen.
- Costo = -ln((éxitos + 1) / (éxitos + fallos + 2)) por rama.
"""

import heapq
import math
import re
import statistics
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ERROR_SIGNALS = {"no_effect", "visible_error", "went_back"}
_TRACKING_PARAMS = re.compile(r"^(utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid)$", re.I)
_DEFAULT_PORTS = {"http": 80, "https": 443}
_CLICK_LABELS = {"left_click": "clic", "double_click": "doble clic", "triple_click": "triple clic"}


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if parts.port and parts.port != _DEFAULT_PORTS.get(scheme):
        host = f"{host}:{parts.port}"
    path = re.sub(r"/+$", "", parts.path) or "/"
    query = urlencode(sorted(
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAMS.match(key)
    ))
    # Se descarta el fragmento, salvo rutas de SPA (#/ruta o #!/ruta).
    fragment = parts.fragment if parts.fragment.startswith(("/", "!/")) else ""
    return urlunsplit((scheme, host, path, query, fragment))


def node_key(url: str, title: str) -> str:
    return f"{normalize_url(url)} | {(title or '').strip()}"


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
            if "went_back" in step.get("signals", []) and legs:
                legs[-1]["dead_end"] = True  # la rama que llevó a esta página no servía
            legs.append({
                "source": current,
                "target": target,
                "signature": action_signature(step),
                "seconds": step["seconds_since_start"] - arrived_at_s,
                "steps": steps_in_leg,
                "signals": signals_in_leg,
                "dead_end": False,
                "preceding_actions": in_page_actions,
            })
            current = target
            arrived_at_s, steps_in_leg, signals_in_leg, in_page_actions = step["seconds_since_start"], 0, set(), []

        nodes[current]["endings"][outcome] += 1
        for leg in legs:
            failed = outcome != "success" or leg["dead_end"] or bool(leg["signals"] & ERROR_SIGNALS)
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
        if branch["source"] != branch["target"]:
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
