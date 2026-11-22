"""Una tanda por objetivo de un catálogo del Mapeador (goals.json), uno tras otro, y el resumen del sitio.

Qué objetivos se pueden intentar (`exclusion`) y con qué tarea (`instruction`) lo decide el Mapeador en el catálogo.
"""

from dataclasses import dataclass
from pathlib import Path

from batch import describir_tema, run_batch
from reference import find_reference
from site_summary import tandas_con_tema, write_summary


@dataclass
class Planned:
    goal: dict
    skip: str | None  # por qué no corre; None si corre


def plan(goals: list[dict], runs_dir: Path, profile_keys: list[str], only: list[str], limit: int | None,
         rerun: bool, tema: str | None = None) -> list[Planned]:
    """Corre cada objetivo pedido, sin exclusión, con ruta verificada para algún perfil y sin tanda previa con el
    mismo tema (`tema` = sha256 corto, o None para el sitio tal cual)."""
    planned: list[Planned] = []
    for goal in goals:
        goal_dir = runs_dir / goal["id"]
        running = sum(item.skip is None for item in planned)
        if only and goal["id"] not in only:
            skip = "no pedido"
        elif goal["exclusion"]:
            skip = goal["exclusion"]
        elif not any(find_reference(goal_dir, goal["start_url"], goal["instruction"], key) for key in profile_keys):
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
        goal_id = item.goal["id"]
        if item.skip:
            print(f"[{goal_id}] se omite: {item.skip}", flush=True)
            continue
        print(f"[{goal_id}] tanda: {item.goal['instruction']}", flush=True)
        try:
            await run_batch(url=item.goal["start_url"], instruction=item.goal["instruction"],
                            output_dir=runs_dir / goal_id, task_id=goal_id, **batch_options)
        except Exception as error:
            print(f"[{goal_id}] la tanda falló: {type(error).__name__}: {error}", flush=True)


async def run_catalog(catalog: dict, catalog_path: Path, runs_dir: Path, only: list[str], limit: int | None,
                      rerun: bool, profile_keys: list[str], **batch_options) -> Path:
    """Corre las tandas del catálogo y devuelve summary.md."""
    tema_css = batch_options.get("tema_css")
    tema = describir_tema(tema_css)[1]["sha256"] if tema_css else None
    planned = plan(catalog["goals"], runs_dir, profile_keys, only, limit, rerun, tema)
    await run_planned(planned, runs_dir, profile_keys=profile_keys, **batch_options)
    return write_summary(catalog_path, runs_dir, tema)
