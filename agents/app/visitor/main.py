"""Visitante: usuarios sintéticos que intentan una tarea en un sitio viendo solo capturas.

Uso, desde agents/app/visitor/:

    uv run main.py --task wom.cl/baja-fibra
    uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
    uv run main.py --site https://www.wom.cl/ --limit 3
    uv run main.py --task wom.cl/baja-fibra --css tema.css
"""

import argparse
import asyncio
import os
import shutil
from pathlib import Path

from shared import store
from shared.browser.theme import TemaInvalido, describir_tema
from shared.catalog.files import read_catalog
from shared.catalog.goal import instruction_goal_id
from shared.catalog.tasks import available_tasks, load_task

from visitor import config
from visitor.batch import BatchInterrupted, run_batch
from visitor.catalog_run import plan, run_planned
from visitor.comparison import find_references
from visitor.profiles import PERFILES_POR_DEFECTO, PROFILES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="visitor",
        description="Lanza usuarios sintéticos que intentan una tarea en un sitio y une sus recorridos en un árbol de rutas.",
    )
    target = parser.add_argument_group("qué probar: --task, --url con --instruction, o --site")
    target.add_argument("--task", help=f"tarea de agents/tasks/ como <host>/<objetivo> ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--site", help="URL de un sitio: una tanda por objetivo de su último catálogo con ruta verificada")
    catalog = parser.add_argument_group("con --site")
    catalog.add_argument("--goal", action="append", default=[], help="solo este objetivo; se puede repetir")
    catalog.add_argument("--limit", type=int, default=None, help="como máximo N tandas nuevas")
    catalog.add_argument("--rerun", action="store_true", help="repite los objetivos que ya tienen tanda")
    parser.add_argument(
        "--profiles",
        default=None,
        help=f"perfiles separados por coma, de: {', '.join(PROFILES)} (por defecto: {','.join(PERFILES_POR_DEFECTO)};"
        " con --site, first_time). Los explorador* siguen la skill explorar-caminos y solo corren en local",
    )
    parser.add_argument(
        "--engine",
        default="claude-code",
        choices=["claude-code", "api", "bedrock"],
        help="claude-code: tu Claude Code local, sin clave de API (por defecto). api: API de Anthropic con computer use."
        " bedrock: Claude en Amazon Bedrock, con las credenciales de AWS del entorno.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"modelo de los usuarios sintéticos (por defecto {config.USER_MODEL}; con --engine bedrock,"
        f" {config.BEDROCK_USER_MODEL})",
    )
    parser.add_argument("--effort", default=config.USER_EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument(
        "--browser",
        default="local",
        choices=["local", "agentcore"],
        help="local: Chromium en tu computador (por defecto). agentcore: AgentCore Browser en AWS, una sesión por usuario.",
    )
    parser.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP, con --browser local")
    parser.add_argument(
        "--record-video",
        action="store_true",
        help="graba un video .webm de cada intento, además de las capturas de cada paso",
    )
    parser.add_argument(
        "--css",
        type=Path,
        default=None,
        metavar="ARCHIVO",
        help="aplica este tema (CSS bajo html.mi-tema) en cada página, como la extensión; queda registrado en la tanda",
    )
    return parser


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
    parser.error("falta qué probar: usa --task <host>/<objetivo>, --url con --instruction, o --site <url>")


def _profile_keys(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[str]:
    if args.engine == "api" and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("falta la variable de entorno ANTHROPIC_API_KEY (necesaria con --engine api)")
    if args.engine == "claude-code" and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión, o usa --engine api")
    if args.cdp_url and args.browser != "local":
        parser.error("--cdp-url solo sirve con --browser local")
    profiles = args.profiles or ("first_time" if args.site else ",".join(PERFILES_POR_DEFECTO))
    profile_keys = [key.strip() for key in profiles.split(",") if key.strip()]
    unknown = [key for key in profile_keys if key not in PROFILES]
    if unknown:
        parser.error(f"perfiles desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PROFILES)}")
    return profile_keys


def _tema(parser: argparse.ArgumentParser, css: Path | None) -> str | None:
    """El sha256 corto del tema de `--css`; None sin tema."""
    if css is None:
        return None
    if not css.is_file():
        parser.error(f"no existe el archivo de tema {css}")
    try:
        return describir_tema(css)[1]["sha256"]
    except (TemaInvalido, UnicodeDecodeError) as error:
        parser.error(str(error))


def _run_site(parser: argparse.ArgumentParser, args: argparse.Namespace, backend: store.Backend,
              profile_keys: list[str], options: dict, tema: str | None) -> None:
    if args.task or args.url or args.instruction:
        parser.error("usa --site sin --task ni --url")
    try:
        catalog = store.latest_run(backend, store.cataloger(args.site))
    except store.InvalidKey:
        parser.error(f"URL inválida: {args.site}")
    if catalog is None:
        parser.error(f"no hay catálogo de {args.site}: corre el Catalogador primero")
    planned = plan(backend, read_catalog(backend, catalog)[1], profile_keys, args.goal, args.limit, args.rerun,
                   tema)
    asyncio.run(run_planned(backend, planned, catalog, profile_keys=profile_keys, **options))
    print("\nListo.")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    tema = _tema(parser, args.css)
    if not args.site:
        goal, url, instruction = _target(parser, args)
    profile_keys = _profile_keys(parser, args)
    options = {"engine": args.engine, "user_model": args.model, "effort": args.effort, "cdp_url": args.cdp_url,
               "browser": args.browser, "record_video": args.record_video,
               "tema_css": args.css}
    backend = store.open_backend()
    if args.site:
        _run_site(parser, args, backend, profile_keys, options, tema)
        return
    references = find_references(backend, url, goal, instruction, profile_keys)
    try:
        run = asyncio.run(run_batch(backend, store.visitor(url, goal), url, instruction, profile_keys, references,
                                    **options))
    except BatchInterrupted as interrupted:
        raise SystemExit(f"error: {interrupted}. Reporte: {interrupted.run.file('report.md')}")
    print(f"\nListo. Reporte: {run.file('report.md')}")


if __name__ == "__main__":
    main()
