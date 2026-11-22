"""Rutas de referencia para los objetivos de un catálogo, con el mismo pipeline que una tarea."""

from shared import store
from shared.browser.viewports import SCREENS
from shared.catalog.goal import Goal, routable
from shared.catalog.routes import verified_route

from guide.reference import Mapping


def pending_routes(backend: store.Backend, goals: list[Goal], limit: int | None, rerun: bool) -> list[Goal]:
    """Los objetivos por mapear para que haya hasta `limit` con ruta verificada; las ya verificadas cuentan y no se rehacen."""
    candidates = routable(goals, None)
    if rerun:
        return candidates[:limit]
    pending = [goal for goal in candidates
               if not verified_route(backend, goal.start_url, goal.id, "desktop", goal.instruction)]
    done = len(candidates) - len(pending)
    if done:
        print(f"[rutas] ya verificadas: {done}", flush=True)
    return pending if limit is None else pending[:max(0, limit - done)]


def goal_mappings(goals: list[Goal], catalog: store.RunKey, model: str, effort: str, extra_routes: int) -> list[Mapping]:
    return [Mapping(goal.id, goal.start_url, goal.instruction, SCREENS["desktop"], model, effort, (catalog,), extra_routes)
            for goal in goals]
