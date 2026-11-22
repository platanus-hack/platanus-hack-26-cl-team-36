"""Subcomando `route`: la ruta de referencia de una tarea en uno o más viewports, o de los objetivos de un catálogo."""

import argparse
import asyncio
import sys
import time

from shared import store
from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS
from shared.catalog.files import read_catalog
from shared.catalog.goal import Goal, exclusion, instruction_goal_id
from shared.catalog.tasks import available_tasks, load_task
from shared.claude.workdir import claude_workdir

from guide import config
from guide.catalog_routes import goal_mappings, pending_routes
from guide.reference import Mapping, RouteNotVerified, map_references


def _route_limit(value: str) -> int | None:
    """Un número o `all`, que es None: todos."""
    if value == "all":
        return None
    try:
        return int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("usa un número o all")


def add_parser(commands: argparse._SubParsersAction) -> None:
    route = commands.add_parser("route", help="encuentra y verifica la ruta de referencia de una tarea u objetivo")
    target = route.add_argument_group("qué mapear: --task, --url con --instruction o con --revision y --goal, o --site")
    target.add_argument("--task", help=f"tarea de agents/tasks/ como <host>/<objetivo> ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--site", help="URL de un sitio: rutas de los objetivos de su último catálogo, en desktop")
    target.add_argument("--revision", help="con --url y --goal: el objetivo del catálogo de esta revisión, en desktop")
    target.add_argument("--goal", help="con --revision: id del objetivo en goals.json")
    catalog = route.add_argument_group("con --site")
    catalog.add_argument("--routes", type=_route_limit, default=0,
                         help="deja hasta N objetivos con ruta verificada, o todos con all (por defecto: 0)")
    catalog.add_argument("--rerun", action="store_true", help="rehace las rutas ya verificadas")
    route.add_argument(
        "--viewports", default="desktop", help=f"viewports separados por coma: {', '.join(SCREENS)} (por defecto: desktop)"
    )
    route.add_argument(
        "--shorter", type=int,
        help="exploraciones más que buscan una ruta más corta que la primera verificada"
             f" (por defecto: {config.EXTRA_ROUTES}; con --revision, {config.REVISION_EXTRA_ROUTES})",
    )


def _target(parser: argparse.ArgumentParser, args: argparse.Namespace) -> tuple[str, str, str]:
    """Devuelve el objetivo, la URL y la instrucción."""
    if args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        task = load_task(args.task)
        if task is None:
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        return task.id, task.start_url, task.description
    if args.url and args.instruction:
        try:
            return instruction_goal_id(args.instruction), args.url, args.instruction
        except ValueError as error:
            parser.error(str(error))
    parser.error("falta qué mapear: usa --task <host>/<objetivo>, --url con --instruction, o --site <url>")


def _task_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[Mapping]:
    goal, url, instruction = _target(parser, args)
    viewports = list(dict.fromkeys(key.strip() for key in args.viewports.split(",") if key.strip()))
    unknown = [key for key in viewports if key not in SCREENS]
    if unknown:
        parser.error(f"viewports desconocidos: {', '.join(unknown)}; disponibles: {', '.join(SCREENS)}")
    return [Mapping(goal, url, instruction, SCREENS[key], args.model, args.effort, extra_routes=args.shorter)
            for key in viewports]


def _revision_goal(backend: store.Backend, catalog: store.RunKey | None, args: argparse.Namespace) -> Goal | str:
    """El objetivo `--goal` del catálogo de la revisión, o por qué no se mapea."""
    if catalog is None or store.read_manifest(backend, catalog).status != "succeeded":
        return f"no hay catálogo terminado de la revisión {args.revision} para {args.url}"
    goal = next((goal for goal in read_catalog(backend, catalog)[1] if goal.id == args.goal), None)
    if goal is None:
        return f"el catálogo {catalog} no tiene el objetivo {args.goal}"
    if exclusion(goal):
        return f"el objetivo {args.goal} está excluido: {exclusion(goal)}"
    # La corrida queda bajo el host de la ruta, y el conductor la busca bajo el de --url.
    if store.normalize_host(goal.start_url) != store.normalize_host(args.url):
        return f"el objetivo {args.goal} empieza en otro sitio: {goal.start_url}"
    return goal


def _revision_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace, backend: store.Backend) -> list[Mapping]:
    """Sin el objetivo, deja una corrida `failed` de la revisión: el conductor espera su manifiesto."""
    if not (args.url and args.goal) or args.task or args.instruction or args.site:
        parser.error("usa --revision con --url y --goal, sin --task, --instruction ni --site")
    try:
        store.validate_revision(args.revision)
        prefix = store.guide(args.url, args.goal, "desktop")
        catalog = store.revision_run(backend, store.cataloger(args.url), args.revision)
    except ValueError as error:
        parser.error(str(error))
    goal = _revision_goal(backend, catalog, args)
    if isinstance(goal, str):
        run = store.start_run(backend, prefix, model=args.model, inputs=(catalog,) if catalog else (),
                              revision=args.revision)
        store.finish_run(backend, run, "failed")
        sys.exit(f"{goal}; la corrida {run.key} queda failed")
    return goal_mappings([goal], catalog, args.model, args.effort, args.shorter, revision=args.revision)


def _catalog_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace, backend: store.Backend) -> list[Mapping]:
    if args.task or args.url or args.instruction:
        parser.error("usa --site sin --task ni --url")
    if args.routes is not None and args.routes < 0:
        parser.error("--routes no puede ser negativo")
    try:
        catalog = store.latest_run(backend, store.cataloger(args.site))
    except store.InvalidKey:
        parser.error(f"URL inválida: {args.site}")
    if catalog is None:
        parser.error(f"no hay catálogo de {args.site}: corre el Catalogador primero")
    goals = read_catalog(backend, catalog)[1]
    return goal_mappings(pending_routes(backend, goals, args.routes, args.rerun), catalog, args.model, args.effort,
                         args.shorter)


async def _map(backend: store.Backend, mappings: list[Mapping], cdp_url: str | None,
               concurrency: int) -> list[tuple[store.RunKey, dict] | BaseException]:
    with claude_workdir("guide") as claude_cwd:
        async with open_browser(cdp_url) as browser:
            return await map_references(browser, backend, mappings, claude_cwd, concurrency)


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    backend = store.open_backend()
    if args.goal and not args.revision:
        parser.error("--goal va con --revision")
    if args.shorter is None:
        args.shorter = config.REVISION_EXTRA_ROUTES if args.revision else config.EXTRA_ROUTES
    if args.revision:
        mappings, concurrency = _revision_mappings(parser, args, backend), 1
    elif args.site:
        mappings, concurrency = _catalog_mappings(parser, args, backend), config.ROUTE_CONCURRENCY
    else:
        mappings = _task_mappings(parser, args)
        concurrency = len(mappings)
    if not mappings:
        print("Nada que mapear.")
        return
    started = time.monotonic()
    results = asyncio.run(_map(backend, mappings, args.cdp_url, concurrency))
    print(f"\nListo en {time.monotonic() - started:.0f} s.")
    for mapping, result in zip(mappings, results):
        if isinstance(result, RouteNotVerified):
            print(f"  {mapping.label}: {result.document['status']}, la corrida queda failed — {result.run.file('route.md')}")
        elif isinstance(result, BaseException):
            print(f"  {mapping.label}: error interno, {type(result).__name__}: {result}")
        else:
            run, document = result
            print(f"  {mapping.label}: {document['status']}, {document['totals']['min_steps']} pasos mínimos"
                  f" — {run.file('route.md')}")
    if args.revision and not all(isinstance(result, tuple) for result in results):
        sys.exit(1)
