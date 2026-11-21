"""Mapeador: encuentra la ruta de referencia de una tarea leyendo el DOM.

Uso, desde agents/app/web_mapper/:

    uv run main.py route --task wom-baja-fibra
    uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
"""

import argparse
import asyncio
import json
import shutil
import tempfile
import time
from pathlib import Path

from playwright.async_api import async_playwright

from mapper import config
from mapper.decider import ClaudeDecider
from mapper.prompts import system_prompt
from mapper.reference import Mapping, map_reference

from browser import connect_browser  # del evaluador: va después de `mapper`, que lo pone en sys.path

AGENTS_DIR = Path(__file__).resolve().parents[2]
RUNS_DIR = AGENTS_DIR / ".runs"
TASKS_DIR = AGENTS_DIR / "tasks"


def available_tasks() -> list[str]:
    return sorted(path.stem for path in TASKS_DIR.glob("*.json"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="web_mapper", description="Mapeador: lee el DOM para encontrar rutas de referencia.")
    commands = parser.add_subparsers(dest="command", required=True)
    route = commands.add_parser("route", help="encuentra y verifica la ruta de referencia de una tarea")
    target = route.add_argument_group("qué mapear: --task, o --url con --instruction")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    route.add_argument(
        "--profiles", default="desktop", help=f"viewports separados por coma: {', '.join(config.VIEWPORTS)} (por defecto: desktop)"
    )
    route.add_argument("--model", default=config.MODEL, help=f"modelo del Mapeador (por defecto: {config.MODEL})")
    route.add_argument("--effort", default=config.EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
    route.add_argument(
        "--output", type=Path, default=None,
        help="carpeta base (por defecto agents/.runs/<tarea>/, o agents/.runs/ con --url); la ruta queda en reference/<perfil>/",
    )
    route.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP (por defecto, Chromium local)")
    return parser


def resolve_target(parser: argparse.ArgumentParser, args: argparse.Namespace) -> tuple[str | None, str, str, Path]:
    """Devuelve el id de la tarea, la URL, la instrucción y la carpeta base."""
    if args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        path = TASKS_DIR / f"{args.task}.json"
        if not path.is_file():
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        task = json.loads(path.read_text(encoding="utf-8"))
        return task["id"], task["start_url"], task["description"], args.output or RUNS_DIR / task["id"]
    if args.url and args.instruction:
        return None, args.url, args.instruction, args.output or RUNS_DIR
    parser.error("falta qué mapear: usa --task <id>, o --url con --instruction")


async def run_routes(mappings: list[Mapping], cdp_url: str | None) -> list[dict]:
    # Claude Code corre en una carpeta vacía para no cargar CLAUDE.md ni memoria de ningún proyecto.
    claude_cwd = Path(tempfile.mkdtemp(prefix="web_mapper-claude-"))
    try:
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright, cdp_url)
            try:
                return await asyncio.gather(*(
                    map_reference(browser, mapping, ClaudeDecider(
                        system_prompt(mapping.profile.width, mapping.profile.height),
                        mapping.model, mapping.effort, claude_cwd, mapping.out_dir / "claude_code.log",
                    ))
                    for mapping in mappings
                ))
            finally:
                await browser.close()
    finally:
        shutil.rmtree(claude_cwd, ignore_errors=True)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    task_id, url, instruction, base_dir = resolve_target(parser, args)
    viewports = [key.strip() for key in args.profiles.split(",") if key.strip()]
    unknown = [key for key in viewports if key not in config.VIEWPORTS]
    if unknown:
        parser.error(f"viewports desconocidos: {', '.join(unknown)}; disponibles: {', '.join(config.VIEWPORTS)}")
    if not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión")

    mappings = [
        Mapping(task_id, url, instruction, key, config.VIEWPORTS[key], args.model, args.effort, base_dir / "reference" / key)
        for key in viewports
    ]
    started = time.monotonic()
    documents = asyncio.run(run_routes(mappings, args.cdp_url))
    print(f"\nListo en {time.monotonic() - started:.0f} s.")
    for mapping, document in zip(mappings, documents):
        totals = document["totals"]
        print(f"  {mapping.viewport}: {document['status']}, {totals['min_steps']} pasos mínimos — {mapping.out_dir / 'route.md'}")


if __name__ == "__main__":
    main()
