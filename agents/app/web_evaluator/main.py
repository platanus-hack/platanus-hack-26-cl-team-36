"""Evaluador web: lanza usuarios sintéticos que intentan una tarea en un sitio.

Uso, desde agents/app/web_evaluator/:

    uv run main.py --task wom-baja-fibra
    uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
"""

import argparse
import asyncio
import json
import os
import shutil
from pathlib import Path

import config
from batch import run_batch
from profiles import PROFILES

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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="web_evaluator",
        description="Lanza usuarios sintéticos que intentan una tarea en un sitio y une sus recorridos en un árbol de rutas.",
    )
    target = parser.add_argument_group("qué probar: --task, o --url con --instruction")
    target.add_argument("--task", help=f"id de una tarea de agents/tasks/ ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    parser.add_argument(
        "--profiles",
        default=",".join(PROFILES),
        help=f"perfiles separados por coma (por defecto: {','.join(PROFILES)})",
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
        choices=["claude-code", "api"],
        help="claude-code: tu Claude Code local, sin clave de API (por defecto). api: API de Anthropic con computer use.",
    )
    parser.add_argument("--model", default=config.USER_MODEL, help="modelo de los usuarios sintéticos")
    parser.add_argument("--effort", default=config.USER_EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP (por defecto, Chromium local)")
    parser.add_argument(
        "--record-video",
        action="store_true",
        help="graba un video .webm de cada intento, además de las capturas de cada paso",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.task:
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
        parser.error("falta qué probar: usa --task <id>, o --url con --instruction")

    if args.engine == "api" and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("falta la variable de entorno ANTHROPIC_API_KEY (necesaria con --engine api)")
    if args.engine == "claude-code" and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión, o usa --engine api")
    profile_keys = [key.strip() for key in args.profiles.split(",") if key.strip()]
    unknown = [key for key in profile_keys if key not in PROFILES]
    if unknown:
        parser.error(f"perfiles desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PROFILES)}")

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
        record_video=args.record_video,
    ))
    print(f"\nListo. Reporte: {display_path(batch_dir / 'report.md')}")


if __name__ == "__main__":
    main()
