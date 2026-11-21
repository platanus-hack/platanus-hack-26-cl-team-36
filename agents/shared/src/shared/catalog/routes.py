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
