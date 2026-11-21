"""La ruta de referencia vigente de un objetivo: la de la última corrida de guide que terminó bien."""

from shared import store


def latest_route(backend: store.Backend, url: str, goal: str, viewport: str) -> tuple[store.RunKey, dict] | None:
    run = store.latest_run(backend, store.guide(url, goal, viewport))
    return (run, backend.read_json(run.file("route.json"))) if run else None


def verified_route(backend: store.Backend, url: str, goal: str, viewport: str,
                   instruction: str) -> tuple[store.RunKey, dict] | None:
    """La ruta vigente si verificó para esta instrucción y esta página inicial."""
    found = latest_route(backend, url, goal, viewport)
    if found is None:
        return None
    route = found[1]
    if route.get("status") == "verified" and (route.get("start_url"), route.get("instruction")) == (url, instruction):
        return found
    return None


def visit_tema(tree: dict) -> str | None:
    """El sha256 corto del tema de una corrida de visitor (route_tree.json, `tema`); None si fue sin tema."""
    tema = tree.get("tema")
    return tema.get("sha256") if isinstance(tema, dict) else None


def latest_visit(backend: store.Backend, url: str, goal: str,
                 tema: str | None = None) -> tuple[store.RunKey, dict] | None:
    """La última corrida de visitor que terminó bien con ese tema (None = sin tema) y su route_tree.json.

    Con y sin tema van al mismo prefijo: una corrida con tema nunca pasa por la línea base sin tema, ni al revés.
    """
    for run in reversed(backend.list_runs(store.visitor(url, goal))):
        if store.read_manifest(backend, run).status != "succeeded":
            continue
        key = run.file("route_tree.json")
        tree = backend.read_json(key) if backend.exists(key) else {}
        if visit_tema(tree) == tema:
            return run, tree
    return None
