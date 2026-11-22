"""Subcomando `route`: la ruta de referencia de una tarea en uno o más viewports, o de los objetivos de un catálogo."""

import argparse
import asyncio
import json
import time
from pathlib import Path

from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS
from shared.catalog.files import read_catalog
from shared.claude.workdir import claude_workdir

from guide import config
from guide.catalog_routes import goal_mappings, pending_routes
from guide.reference import Mapping, map_references


def available_tasks() -> list[str]:
    return sorted(path.stem for path in config.TASKS_DIR.glob("*.json"))


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
    target = route.add_argument_group("qué mapear: --task, --url con --instruction, o --goals")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--goals", type=Path, help="goals.json del Catalogador: rutas de sus objetivos, en desktop")
    catalog = route.add_argument_group("con --goals")
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
    route.add_argument(
        "--output", type=Path, default=None,
        help="carpeta base (por defecto agents/.runs/<tarea>/, o agents/.runs/ con --url); la ruta queda en reference/<viewport>/",
    )


def _target(parser: argparse.ArgumentParser, args: argparse.Namespace) -> tuple[str | None, str, str, Path]:
    """Devuelve el id de la tarea, la URL, la instrucción y la carpeta base."""
    if args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        path = config.TASKS_DIR / f"{args.task}.json"
        if not path.is_file():
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        task = json.loads(path.read_text(encoding="utf-8"))
        return task["id"], task["start_url"], task["description"], args.output or config.RUNS_DIR / task["id"]
    if args.url and args.instruction:
        return None, args.url, args.instruction, args.output or config.RUNS_DIR
    parser.error("falta qué mapear: usa --task <id>, --url con --instruction, o --goals <goals.json>")


def _task_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[Mapping]:
    task_id, url, instruction, base_dir = _target(parser, args)
    viewports = list(dict.fromkeys(key.strip() for key in args.viewports.split(",") if key.strip()))
    unknown = [key for key in viewports if key not in SCREENS]
    if unknown:
        parser.error(f"viewports desconocidos: {', '.join(unknown)}; disponibles: {', '.join(SCREENS)}")
    return [Mapping(task_id, url, instruction, SCREENS[key], args.model, args.effort, base_dir / "reference" / key,
                    args.shorter) for key in viewports]


def _catalog_mappings(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[Mapping]:
    if args.task or args.url or args.instruction or args.output:
        parser.error("usa --goals sin --task, --url ni --output")
    if args.routes is not None and args.routes < 0:
        parser.error("--routes no puede ser negativo")
    try:
        goals = read_catalog(args.goals)[1]
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(f"no se pudo leer el catálogo {args.goals}: {error}")
    return goal_mappings(pending_routes(goals, args.routes, args.rerun), args.model, args.effort, args.shorter)


async def _map(mappings: list[Mapping], cdp_url: str | None, concurrency: int) -> list[dict | BaseException]:
    with claude_workdir("guide") as claude_cwd:
        async with open_browser(cdp_url) as browser:
            return await map_references(browser, mappings, claude_cwd, concurrency)


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.goals:
        mappings, concurrency = _catalog_mappings(parser, args), config.ROUTE_CONCURRENCY
    else:
        mappings = _task_mappings(parser, args)
        concurrency = len(mappings)
    if not mappings:
        print("Nada que mapear.")
        return
    started = time.monotonic()
    results = asyncio.run(_map(mappings, args.cdp_url, concurrency))
    print(f"\nListo en {time.monotonic() - started:.0f} s.")
    for mapping, result in zip(mappings, results):
        label = " ".join(part for part in (mapping.task_id, mapping.screen.viewport) if part)
        if isinstance(result, BaseException):
            print(f"  {label}: error interno, {type(result).__name__}: {result}")
        else:
            print(f"  {label}: {result['status']}, {result['totals']['min_steps']} pasos mínimos"
                  f" — {mapping.out_dir / 'route.md'}")
