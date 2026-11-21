"""Subcomando `route`: la ruta de referencia de una tarea en uno o más viewports."""

import argparse
import asyncio
import json
import time
from pathlib import Path

from mapper import config
from mapper.reference import Mapping, map_references
from mapper.runtime import runtime


def available_tasks() -> list[str]:
    return sorted(path.stem for path in config.TASKS_DIR.glob("*.json"))


def add_shorter_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--shorter", type=int, default=config.EXTRA_ROUTES,
        help=f"exploraciones más que buscan una ruta más corta que la primera verificada (por defecto: {config.EXTRA_ROUTES})",
    )


def add_parser(commands: argparse._SubParsersAction) -> None:
    route = commands.add_parser("route", help="encuentra y verifica la ruta de referencia de una tarea")
    target = route.add_argument_group("qué mapear: --task, o --url con --instruction")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    route.add_argument(
        "--viewports", default="desktop", help=f"viewports separados por coma: {', '.join(config.VIEWPORTS)} (por defecto: desktop)"
    )
    add_shorter_option(route)
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
    parser.error("falta qué mapear: usa --task <id>, o --url con --instruction")


async def _map(mappings: list[Mapping], cdp_url: str | None) -> list[dict | BaseException]:
    async with runtime(cdp_url) as (browser, claude_cwd):
        return await map_references(browser, mappings, claude_cwd, len(mappings))


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    task_id, url, instruction, base_dir = _target(parser, args)
    viewports = list(dict.fromkeys(key.strip() for key in args.viewports.split(",") if key.strip()))
    unknown = [key for key in viewports if key not in config.VIEWPORTS]
    if unknown:
        parser.error(f"viewports desconocidos: {', '.join(unknown)}; disponibles: {', '.join(config.VIEWPORTS)}")
    mappings = [
        Mapping(task_id, url, instruction, key, config.VIEWPORTS[key], args.model, args.effort,
                base_dir / "reference" / key, args.shorter)
        for key in viewports
    ]
    started = time.monotonic()
    results = asyncio.run(_map(mappings, args.cdp_url))
    print(f"\nListo en {time.monotonic() - started:.0f} s.")
    for mapping, result in zip(mappings, results):
        if isinstance(result, BaseException):
            print(f"  {mapping.viewport}: error interno, {type(result).__name__}: {result}")
        else:
            print(f"  {mapping.viewport}: {result['status']}, {result['totals']['min_steps']} pasos mínimos"
                  f" — {mapping.out_dir / 'route.md'}")
