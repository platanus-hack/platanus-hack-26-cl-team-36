"""Evaluador web: lanza usuarios sintéticos que intentan una tarea en un sitio.

Uso, desde agents/app/web_evaluator/:

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

import config
from batch import run_batch
from goals_run import run_catalog
from profiles import PROFILES
from site_summary import write_summary

AGENTS_DIR = Path(__file__).resolve().parents[2]
RUNS_DIR = AGENTS_DIR / ".runs"
TASKS_DIR = AGENTS_DIR / "tasks"


def available_tasks() -> list[str]:
    return sorted(path.stem for path in TASKS_DIR.glob("*.json"))


def load_task(task_id: str) -> dict | None:
    path = TASKS_DIR / f"{task_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def display_path(path: Path) -> str:
    """La ruta relativa a la raíz del repo si está dentro de él; si no, la absoluta."""
    try:
        return str(path.resolve().relative_to(AGENTS_DIR.parent))
    except ValueError:
        return str(path.resolve())


def load_catalog(parser: argparse.ArgumentParser, path: Path) -> dict:
    try:
        catalog = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        parser.error(f"no se pudo leer el catálogo {path}: {error}")
    if any("instruction" not in goal or "exclusion" not in goal for goal in catalog.get("goals", [])):
        parser.error("al catálogo le faltan instruction y exclusion; vuelve a correr goals en el Mapeador")
    return catalog


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="web_evaluator",
        description="Lanza usuarios sintéticos que intentan una tarea en un sitio y une sus recorridos en un árbol de rutas.",
    )
    target = parser.add_argument_group("qué probar: --task, --url con --instruction, o --goals")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--goals", type=Path, help="goals.json del Mapeador: una tanda por objetivo con ruta verificada")
    catalog = parser.add_argument_group("con --goals")
    catalog.add_argument("--goal", action="append", default=[], help="solo este objetivo; se puede repetir")
    catalog.add_argument("--limit", type=int, default=None, help="como máximo N tandas nuevas")
    catalog.add_argument("--rerun", action="store_true", help="repite los objetivos que ya tienen tanda")
    catalog.add_argument("--summary", action="store_true", help="solo reescribe summary.md y summary.json desde disco")
    parser.add_argument(
        "--profiles",
        default=None,
        help=f"perfiles separados por coma (por defecto: {','.join(PROFILES)}; con --goals, first_time)",
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

    if args.goals:
        if args.task or args.url or args.instruction:
            parser.error("usa --goals sin --task ni --url")
        catalog = load_catalog(parser, args.goals)
        if args.summary:
            print(f"Resumen: {display_path(write_summary(args.goals, RUNS_DIR))}")
            return
    elif args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        task = load_task(args.task)
        if task is None:
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        url, instruction = task["start_url"], task["description"]
        output_dir = args.output or RUNS_DIR / task["id"]
    elif args.url and args.instruction:
        url, instruction = args.url, args.instruction
        output_dir = args.output or RUNS_DIR
    else:
        parser.error("falta qué probar: usa --task <id>, --url con --instruction, o --goals <goals.json>")

    if args.engine == "api" and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("falta la variable de entorno ANTHROPIC_API_KEY (necesaria con --engine api)")
    if args.engine == "claude-code" and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión, o usa --engine api")
    if args.cdp_url and args.browser != "local":
        parser.error("--cdp-url solo sirve con --browser local")
    if args.css is not None and not args.css.is_file():
        parser.error(f"no existe el archivo de tema {args.css}")
    profiles = args.profiles or ("first_time" if args.goals else ",".join(PROFILES))
    profile_keys = [key.strip() for key in profiles.split(",") if key.strip()]
    unknown = [key for key in profile_keys if key not in PROFILES]
    if unknown:
        parser.error(f"perfiles desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PROFILES)}")
    if args.goals:
        options = {"engine": args.engine, "user_model": args.model, "effort": args.effort, "cdp_url": args.cdp_url,
                   "browser": args.browser, "record_video": args.record_video, "tema_css": args.css}
        summary = asyncio.run(run_catalog(catalog, args.goals, RUNS_DIR, args.goal, args.limit, args.rerun, profile_keys,
                                          **options))
        print(f"\nListo. Resumen: {display_path(summary)}")
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
