"""Visitante: usuarios sintéticos que intentan una tarea en un sitio viendo solo capturas.

Uso, desde agents/app/visitor/:

    uv run main.py --task wom-baja-fibra
    uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
    uv run main.py --goals ../../.runs/www.wom.cl/goals/goals.json --limit 3
    uv run main.py --task wom-baja-fibra --css tema.css
"""

import argparse
import asyncio
import json
import os
import shutil
from pathlib import Path

from shared.browser.theme import TemaInvalido, describir_tema
from shared.catalog.files import read_catalog
from shared.catalog.goal import Goal

from visitor import config
from visitor.batch import run_batch
from visitor.catalog_run import plan, run_planned
from visitor.profiles import PERFILES_POR_DEFECTO, PROFILES


def available_tasks() -> list[str]:
    return sorted(path.stem for path in config.TASKS_DIR.glob("*.json"))


def load_task(task_id: str) -> dict | None:
    path = config.TASKS_DIR / f"{task_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def display_path(path: Path) -> str:
    """La ruta relativa a la raíz del repo si está dentro de él; si no, la absoluta."""
    try:
        return str(path.resolve().relative_to(config.AGENTS_DIR.parent))
    except ValueError:
        return str(path.resolve())


def load_goals(parser: argparse.ArgumentParser, path: Path) -> list[Goal]:
    try:
        return read_catalog(path)[1]
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(f"no se pudo leer el catálogo {path}: {error}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="visitor",
        description="Lanza usuarios sintéticos que intentan una tarea en un sitio y une sus recorridos en un árbol de rutas.",
    )
    target = parser.add_argument_group("qué probar: --task, --url con --instruction, o --goals")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--goals", type=Path, help="goals.json del Catalogador: una tanda por objetivo con ruta verificada")
    catalog = parser.add_argument_group("con --goals")
    catalog.add_argument("--goal", action="append", default=[], help="solo este objetivo; se puede repetir")
    catalog.add_argument("--limit", type=int, default=None, help="como máximo N tandas nuevas")
    catalog.add_argument("--rerun", action="store_true", help="repite los objetivos que ya tienen tanda")
    parser.add_argument(
        "--profiles",
        default=None,
        help=f"perfiles separados por coma, de: {', '.join(PROFILES)} (por defecto: {','.join(PERFILES_POR_DEFECTO)};"
        " con --goals, first_time). Los explorador* siguen la skill explorar-caminos y solo corren en local",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="carpeta de las corridas (por defecto agents/.runs/, o agents/.runs/<tarea>/ con --task)",
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


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.css is not None:
        if not args.css.is_file():
            parser.error(f"no existe el archivo de tema {args.css}")
        try:
            describir_tema(args.css)
        except (TemaInvalido, UnicodeDecodeError) as error:
            parser.error(str(error))

    if args.goals:
        if args.task or args.url or args.instruction:
            parser.error("usa --goals sin --task ni --url")
        goals = load_goals(parser, args.goals)
    elif args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        task = load_task(args.task)
        if task is None:
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        url, instruction = task["start_url"], task["description"]
        output_dir = args.output or config.RUNS_DIR / task["id"]
    elif args.url and args.instruction:
        url, instruction = args.url, args.instruction
        output_dir = args.output or config.RUNS_DIR
    else:
        parser.error("falta qué probar: usa --task <id>, --url con --instruction, o --goals <goals.json>")

    if args.engine == "api" and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("falta la variable de entorno ANTHROPIC_API_KEY (necesaria con --engine api)")
    if args.engine == "claude-code" and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión, o usa --engine api")
    if args.cdp_url and args.browser != "local":
        parser.error("--cdp-url solo sirve con --browser local")
    profiles = args.profiles or ("first_time" if args.goals else ",".join(PERFILES_POR_DEFECTO))
    profile_keys = [key.strip() for key in profiles.split(",") if key.strip()]
    unknown = [key for key in profile_keys if key not in PROFILES]
    if unknown:
        parser.error(f"perfiles desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PROFILES)}")
    if args.goals:
        options = {"engine": args.engine, "user_model": args.model, "effort": args.effort, "cdp_url": args.cdp_url,
                   "browser": args.browser, "record_video": args.record_video, "tema_css": args.css}
        tema = describir_tema(args.css)[1]["sha256"] if args.css else None
        planned = plan(goals, config.RUNS_DIR, profile_keys, args.goal, args.limit, args.rerun, tema)
        asyncio.run(run_planned(planned, config.RUNS_DIR, profile_keys=profile_keys, **options))
        print("\nListo.")
        return

    batch_dir = asyncio.run(run_batch(
        url=url,
        instruction=instruction,
        profile_keys=profile_keys,
        output_dir=output_dir,
        engine=args.engine,
        user_model=args.model,
        effort=args.effort,
        cdp_url=args.cdp_url,
        task_id=args.task,
        browser=args.browser,
        record_video=args.record_video,
        tema_css=args.css,
    ))
    print(f"\nListo. Reporte: {display_path(batch_dir / 'report.md')}")


if __name__ == "__main__":
    main()
