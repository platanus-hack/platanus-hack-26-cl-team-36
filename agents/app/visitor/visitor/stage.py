"""Etapa `visitor` de una revisión: un objetivo del catálogo de la revisión, medido contra la ruta de la Guía de la
misma revisión. La llaman igual la CLI (main.py) y el runtime.

Las entradas se buscan por revisión (`store.revision_run`), nunca como "la última del host". Sin catálogo, objetivo o
ruta verificada de la revisión, la corrida termina `failed` sin llamar al modelo.
"""

from dataclasses import dataclass

from shared import store
from shared.catalog.files import read_catalog
from shared.catalog.goal import Goal

from visitor.batch import run_batch
from visitor.comparison import References, reference_viewports


class MissingInput(Exception):
    """Falta una entrada de la revisión: la etapa no corre."""


@dataclass(frozen=True)
class StageInputs:
    catalog: store.RunKey
    goal: Goal
    references: References


def _succeeded(backend: store.Backend, prefix: store.RunPrefix, revision: str) -> store.RunKey | None:
    run = store.revision_run(backend, prefix, revision)
    return run if run and store.read_manifest(backend, run).status == "succeeded" else None


def stage_inputs(backend: store.Backend, url: str, revision: str, goal_id: str, profile_keys: list[str]) -> StageInputs:
    """El catálogo, el objetivo y las rutas verificadas de la revisión. Lanza MissingInput si falta alguno."""
    catalog = _succeeded(backend, store.cataloger(url), revision)
    if catalog is None:
        raise MissingInput(f"no hay catálogo terminado de la revisión {revision}")
    goal = next((item for item in read_catalog(backend, catalog)[1] if item.id == goal_id), None)
    if goal is None:
        raise MissingInput(f"el catálogo {catalog} no tiene el objetivo {goal_id}")
    if store.normalize_host(goal.start_url) != store.normalize_host(url):
        raise MissingInput(f"el objetivo {goal_id} empieza en otro sitio: {goal.start_url}")
    references: References = {}
    for viewport in reference_viewports(profile_keys):
        route_run = _succeeded(backend, store.guide(url, goal.id, viewport), revision)
        route_key = route_run.file("route.json") if route_run else None
        if route_key and backend.exists(route_key) and (route := backend.read_json(route_key)).get("status") == "verified":
            references[viewport] = (route_run, route)
    if not references:
        raise MissingInput(f"no hay ruta verificada de la Guía para {goal_id} en la revisión {revision}")
    return StageInputs(catalog, goal, references)


async def run_stage(backend: store.Backend, url: str, revision: str, goal_id: str, profile_keys: list[str],
                    runs: int = 1, **batch_options) -> store.RunKey:
    """La corrida de visitor de la revisión; `batch_options` van a `run_batch` (motor, navegador, juez...).

    Lanza MissingInput (con la corrida ya cerrada `failed`) o BatchInterrupted.
    """
    store.validate_revision(revision)
    prefix = store.visitor(url, goal_id)
    try:
        found = stage_inputs(backend, url, revision, goal_id, profile_keys)
    except MissingInput as missing:
        # La corrida queda `failed` en el almacén para que la revisión lo vea, sin haber llamado al modelo.
        with store.running(backend, prefix, model=None, revision=revision) as run:
            (run.workdir / "report.md").write_text(f"# Reporte del Visitante\n\nNo se corrió: {missing}.\n",
                                                   encoding="utf-8")
            raise
    goal = found.goal
    return await run_batch(backend, prefix, goal.start_url, goal.instruction, profile_keys, found.references,
                           inputs=(found.catalog,), runs=runs, revision=revision, **batch_options)
