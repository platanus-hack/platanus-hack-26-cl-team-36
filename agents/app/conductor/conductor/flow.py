"""Una revisión: catálogo → Guía y, con la ruta verificada, Visitante por objetivo (en paralelo con tope) → mejora.

La mejora no espera a todos los objetivos: con un Visitante exitoso, espera a los demás a lo más `improver_grace_s`.
"""

import asyncio
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any

from shared import store
from shared.catalog.files import read_catalog
from shared.catalog.goal import for_revision

from conductor import config
from conductor.invokers import Invoker, Outcome

Log = Callable[[str], None]

_NAMES = {"catalog": "catálogo", "guide": "Guía", "visitor": "Visitante", "improver": "mejora"}


@dataclass(frozen=True)
class Options:
    goals_max: int = config.GOALS_MAX
    profiles: str | None = None
    """Perfiles del Visitante tal cual su `--profiles`; None, los suyos por defecto."""
    runs: int = config.RUNS
    concurrency: int = config.CONCURRENCY
    timeouts: dict[str, float] = field(default_factory=lambda: dict(config.TIMEOUTS_S))
    improver_grace_s: float = config.IMPROVER_GRACE_S


def selected_goals(backend: store.Backend, catalog_run: str, goals_max: int) -> list[str]:
    """Los evaluables del catálogo con el criterio y el orden de `for_revision` (el mismo de la proyectora)."""
    goals = read_catalog(backend, store.parse_key(catalog_run).run)[1]
    return [goal.id for goal in for_revision(goals, goals_max)]


def route_verified(backend: store.Backend, guide: Outcome) -> bool:
    if guide.status != "succeeded" or guide.run is None:
        return False
    try:
        return backend.read_json(f"{guide.run}/route.json").get("status") == "verified"
    except (OSError, ValueError, AttributeError):
        return False


def _visited(entry: dict[str, Any]) -> bool:
    return bool(entry["visitor"]) and entry["visitor"]["status"] == "succeeded"


async def ready_for_improver(tasks: list[asyncio.Task], grace_s: float) -> set[asyncio.Task]:
    """Espera a todos, o al primer Visitante exitoso y luego `grace_s` más; devuelve los que siguen corriendo."""
    pending = set(tasks)
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        if any(_visited(task.result()) for task in done):
            break
    if pending:
        _, pending = await asyncio.wait(pending, timeout=grace_s)
    return pending


async def conduct(backend: store.Backend, invoker: Invoker, url: str, revision: str, options: Options,
                  log: Log = print) -> dict[str, Any]:
    """Corre la revisión y devuelve su informe; `status` es el de la mejora, o `failed` si no se llegó a ella."""
    report: dict[str, Any] = {"url": url, "revision": revision, "options": asdict(options), "status": "failed",
                              "error": None, "stages": {}, "goals": []}
    base = {"url": url, "revision": revision}

    async def stage(name: str, **extra: Any) -> Outcome:
        try:
            outcome = await invoker.run(name, {**base, **extra}, options.timeouts[name])
        except Exception as error:   # el error de una etapa no tumba a las demás
            outcome = Outcome("failed", error=f"{type(error).__name__}: {error}")
        where = f" ({extra['goal']})" if "goal" in extra else ""
        detail = outcome.error or outcome.run
        log(f"{_NAMES[name]}{where}: {outcome.status} en {outcome.seconds:g} s — {detail}")
        return outcome

    catalog = await stage("catalog")
    report["stages"]["catalog"] = catalog.to_dict()
    if catalog.status != "succeeded":
        report["error"] = "el catálogo falló"
        return report
    try:
        goals = await asyncio.to_thread(selected_goals, backend, catalog.run, options.goals_max)
    except (OSError, ValueError, KeyError, TypeError) as error:
        report["error"] = f"no se pudo leer el catálogo: {type(error).__name__}: {error}"
        return report
    if not goals:
        report["error"] = "el catálogo no tiene objetivos evaluables"
        return report
    log(f"objetivos: {', '.join(goals)}")

    semaphore = asyncio.Semaphore(options.concurrency)

    async def evaluate(goal: str) -> dict[str, Any]:
        entry: dict[str, Any] = {"id": goal, "guide": None, "visitor": None}
        try:
            async with semaphore:
                guide = await stage("guide", goal=goal)
                entry["guide"] = guide.to_dict()
                if not await asyncio.to_thread(route_verified, backend, guide):
                    entry["skipped"] = "la ruta no quedó verificada: no se lanza el Visitante"
                    return entry
                visitor = await stage("visitor", goal=goal, profiles=options.profiles, runs=options.runs)
                entry["visitor"] = visitor.to_dict()
        except Exception as error:   # un objetivo que falla no cancela la mejora ni a los demás
            entry["error"] = f"{type(error).__name__}: {error}"
            log(f"objetivo {goal}: {entry['error']}")
        return entry

    async def improve(tasks: list[asyncio.Task]) -> Outcome:
        running = await ready_for_improver(tasks, options.improver_grace_s)
        pending = [goal for goal, task in zip(goals, tasks) if task in running]
        if pending:
            log(f"mejora sin esperar a: {', '.join(pending)}")
        async with semaphore:
            improver = await stage("improver")
        report["stages"]["improver"] = {**improver.to_dict(), "pending_goals": pending}
        return improver

    async with asyncio.TaskGroup() as group:
        tasks = [group.create_task(evaluate(goal)) for goal in goals]
        improving = group.create_task(improve(tasks))
    report["goals"] = [task.result() for task in tasks]
    improver = improving.result()
    report["status"] = improver.status
    if improver.status != "succeeded":
        report["error"] = "la mejora falló"
    return report
