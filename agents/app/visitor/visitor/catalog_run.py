"""Una corrida de visitor por objetivo del último catálogo del sitio, una tras otra.

Qué objetivos se pueden intentar (`exclusion`) y con qué tarea (`instruction`) lo decide el catálogo.
"""

from dataclasses import dataclass

from shared import store
from shared.catalog.goal import Goal
from shared.catalog.routes import latest_visit

from visitor.batch import run_batch
from visitor.comparison import References, find_references


@dataclass
class Planned:
    goal: Goal
    references: References
    skip: str | None  # por qué no corre; None si corre


def plan(backend: store.Backend, goals: list[Goal], profile_keys: list[str], only: list[str], limit: int | None,
         rerun: bool, tema: str | None = None) -> list[Planned]:
    """Corre cada objetivo pedido, sin exclusión, con ruta verificada para algún perfil y sin corrida previa con el
    mismo tema (`tema` = sha256 corto, o None para el sitio tal cual)."""
    planned: list[Planned] = []
    for goal in goals:
        running = sum(item.skip is None for item in planned)
        references = find_references(backend, goal.start_url, goal.id, goal.instruction, profile_keys)
        if only and goal.id not in only:
            skip = "no pedido"
        elif goal.exclusion:
            skip = goal.exclusion
        elif not references:
            skip = "sin ruta verificada"
        elif not rerun and latest_visit(backend, goal.start_url, goal.id, tema):
            skip = "ya evaluado (--rerun para repetirlo)"
        elif limit is not None and running >= limit:
            skip = "límite"
        else:
            skip = None
        planned.append(Planned(goal, references, skip))
    return planned


async def run_planned(backend: store.Backend, planned: list[Planned], catalog: store.RunKey, **batch_options) -> None:
    """Una corrida por objetivo planeado; si una falla, siguen las demás."""
    for item in planned:
        goal = item.goal
        if item.skip:
            print(f"[{goal.id}] se omite: {item.skip}", flush=True)
            continue
        print(f"[{goal.id}] tanda: {goal.instruction}", flush=True)
        try:
            await run_batch(backend, store.visitor(goal.start_url, goal.id), goal.start_url, goal.instruction,
                            references=item.references, inputs=(catalog,), **batch_options)
        except Exception as error:
            print(f"[{goal.id}] la tanda falló: {type(error).__name__}: {error}", flush=True)
