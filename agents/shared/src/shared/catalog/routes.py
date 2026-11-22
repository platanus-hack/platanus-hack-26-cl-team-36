"""Las corridas vigentes de un objetivo para una instrucción: la última que terminó bien y es de esa instrucción.

Un id de objetivo puede repetirse entre el catálogo, una tarea y otra versión de la instrucción; por eso se recorre
de la más nueva a la más vieja y se toma la primera de la misma página inicial e instrucción.
"""

from collections.abc import Callable

from shared import store

Found = tuple[store.RunKey, dict]


def _first_matching(backend: store.Backend, prefix: store.RunPrefix, name: str,
                    matches: Callable[[dict], bool]) -> Found | None:
    for run in store.runs_with_status(backend, prefix):
        key = run.file(name)
        if backend.exists(key) and matches(data := backend.read_json(key)):
            return run, data
    return None


def current_route(backend: store.Backend, url: str, goal: str, viewport: str, instruction: str) -> Found | None:
    """La corrida de guide vigente y su route.json, verificada o no."""
    return _first_matching(backend, store.guide(url, goal, viewport), "route.json",
                           lambda route: (route.get("start_url"), route.get("instruction")) == (url, instruction))


def verified_route(backend: store.Backend, url: str, goal: str, viewport: str, instruction: str) -> Found | None:
    """La ruta vigente si verificó."""
    found = current_route(backend, url, goal, viewport, instruction)
    return found if found and found[1].get("status") == "verified" else None


def visit_tema(tree: dict) -> str | None:
    """El sha256 corto del tema de una corrida de visitor (route_tree.json, `tema`); None si fue sin tema."""
    tema = tree.get("tema")
    return tema.get("sha256") if isinstance(tema, dict) else None


def current_visit(backend: store.Backend, url: str, goal: str, instruction: str,
                  tema: str | None = None) -> Found | None:
    """La corrida de visitor vigente con ese tema (None = sin tema) y su route_tree.json.

    Con y sin tema van al mismo prefijo: una corrida con tema nunca es la vigente sin tema, ni al revés.
    """
    return _first_matching(backend, store.visitor(url, goal), "route_tree.json",
                           lambda tree: (tree.get("url"), tree.get("instruction"), visit_tema(tree))
                           == (url, instruction, tema))

