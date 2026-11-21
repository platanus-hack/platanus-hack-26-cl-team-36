"""Una tanda por objetivo de un catálogo del Catalogador (goals.json), uno tras otro.

Qué objetivos se pueden intentar (`exclusion`) y con qué tarea (`instruction`) lo decide el catálogo.
"""

from dataclasses import dataclass
from pathlib import Path

from shared.catalog.goal import Goal
from shared.catalog.visits import tandas_con_tema

from visitor.batch import run_batch
from visitor.comparison import find_reference


@dataclass
class Planned:
    goal: Goal
    skip: str | None  # por qué no corre; None si corre


def plan(goals: list[Goal], runs_dir: Path, profile_keys: list[str], only: list[str], limit: int | None,
         rerun: bool, tema: str | None = None) -> list[Planned]:
    """Corre cada objetivo pedido, sin exclusión, con ruta verificada para algún perfil y sin tanda previa con el
    mismo tema (`tema` = sha256 corto, o None para el sitio tal cual)."""
    planned: list[Planned] = []
    for goal in goals:
        goal_dir = runs_dir / goal.id
        running = sum(item.skip is None for item in planned)
        if only and goal.id not in only:
            skip = "no pedido"
        elif goal.exclusion:
            skip = goal.exclusion
        elif not any(find_reference(goal_dir, goal.start_url, goal.instruction, key) for key in profile_keys):
            skip = "sin ruta verificada"
        elif not rerun and tandas_con_tema(goal_dir, tema):
            skip = "ya evaluado (--rerun para repetirlo)"
        elif limit is not None and running >= limit:
            skip = "límite"
        else:
            skip = None
        planned.append(Planned(goal, skip))
    return planned


async def run_planned(planned: list[Planned], runs_dir: Path, **batch_options) -> None:
    """Una tanda por objetivo planeado; si una falla, siguen las demás."""
    for item in planned:
        goal = item.goal
        if item.skip:
            print(f"[{goal.id}] se omite: {item.skip}", flush=True)
            continue
        print(f"[{goal.id}] tanda: {goal.instruction}", flush=True)
        try:
            await run_batch(url=goal.start_url, instruction=goal.instruction, output_dir=runs_dir / goal.id,
                            task_id=goal.id, **batch_options)
        except Exception as error:
            print(f"[{goal.id}] la tanda falló: {type(error).__name__}: {error}", flush=True)
