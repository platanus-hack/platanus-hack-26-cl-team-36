"""Subcomando `route`: la ruta de referencia de una tarea en uno o más viewports, o de los objetivos de un catálogo."""

import argparse
import asyncio
import time

from shared import store
from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS
from shared.catalog.files import read_catalog
from shared.catalog.goal import instruction_goal_id
from shared.catalog.tasks import available_tasks, load_task
from shared.claude.workdir import claude_workdir

from guide import config
from guide.catalog_routes import goal_mappings, pending_routes
from guide.reference import Mapping, map_references


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
    target = route.add_argument_group("qué mapear: --task, --url con --instruction, o --site")
    target.add_argument("--task", help=f"tarea de agents/tasks/ como <host>/<objetivo> ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--site", help="URL de un sitio: rutas de los objetivos de su último catálogo, en desktop")
    catalog = route.add_argument_group("con --site")
    catalog.add_argument("--routes", type=_route_limit, default=0,
                         help="deja hasta N objetivos con ruta verificada, o todos con all (por defecto: 0)")
    catalog.add_argument("--rerun", action="store_true", help="rehace las rutas ya verificadas")
    route.add_argument(
        "--viewports", default="desktop", help=f"viewports separados por coma: {', '.join(SCREENS)} (por defecto: desktop)"
    )
    route.add_argument(
        "--shorter", type=int, default=config.EXTRA_ROUTES,
        help=f"exploraciones más que buscan una ruta más corta que la primera verificada (por defecto: {config.EXTRA_ROUTES})",
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
        return instruction_goal_id(args.instruction), args.url, args.instruction
    parser.error("falta qué mapear: usa --task <host>/<objetivo>, --url con --instruction, o --site <url>")


def _task_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[Mapping]:
    goal, url, instruction = _target(parser, args)
    viewports = list(dict.fromkeys(key.strip() for key in args.viewports.split(",") if key.strip()))
    unknown = [key for key in viewports if key not in SCREENS]
    if unknown:
        parser.error(f"viewports desconocidos: {', '.join(unknown)}; disponibles: {', '.join(SCREENS)}")
    return [Mapping(goal, url, instruction, SCREENS[key], args.model, args.effort, extra_routes=args.shorter)
            for key in viewports]


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
    if args.site:
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
        if isinstance(result, BaseException):
            print(f"  {mapping.label}: error interno, {type(result).__name__}: {result}")
        else:
            run, document = result
            print(f"  {mapping.label}: {document['status']}, {document['totals']['min_steps']} pasos mínimos"
                  f" — {run.file('route.md')}")
