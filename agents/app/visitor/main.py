"""Visitante: usuarios sintéticos que intentan una tarea en un sitio viendo solo capturas.

Uso, desde agents/app/visitor/:

    uv run main.py --task wom.cl/baja-fibra
    uv run main.py --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
    uv run main.py --site https://www.wom.cl/ --limit 3
    uv run main.py --url https://www.wom.cl/ --revision r1 --goal baja-fibra --profiles desktop --runs 1
    uv run main.py --task wom.cl/baja-fibra --css tema.css
    uv run main.py --site https://www.metro.cl/ --goal planificar-viaje --tema ../../../extension/test/fixtures/metro/tema.json
    uv run main.py --task sii.cl/exencion-contribuciones --exploradores conocimiento --model claude-haiku-5-5
"""

import argparse
import asyncio
import os
import shutil
from pathlib import Path

from shared import store
from shared.browser.theme import describir_kit, describir_tema
from shared.catalog.files import read_catalog
from shared.catalog.goal import instruction_goal_id
from shared.catalog.tasks import available_tasks, load_task
from shared.claude import engines

from visitor import config
from visitor.batch import BatchInterrupted, run_batch
from visitor.catalog_run import plan, run_planned
from visitor.comparison import find_references
from visitor.conocimiento import ConocimientoDeTarea
from visitor.profiles import CONJUNTOS_EXPLORADORES, PERFILES_POR_DEFECTO, PROFILES, exploradores_del_conjunto
from visitor.stage import MissingInput, run_stage

ENGINES = ("claude-code", "api", "bedrock", "fake")
BROWSERS = ("local", "agentcore")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="visitor",
        description="Lanza usuarios sintéticos que intentan una tarea en un sitio y une sus recorridos en un árbol de rutas.",
    )
    target = parser.add_argument_group("qué probar: --task, --url con --instruction, --site, o --url con --revision")
    target.add_argument("--task", help=f"tarea de agents/tasks/ como <host>/<objetivo> ({', '.join(available_tasks()) or 'ninguna'})")
    target.add_argument("--url", help="URL inicial del sitio")
    target.add_argument("--instruction", help="Tarea en lenguaje natural")
    target.add_argument("--site", help="URL de un sitio: una tanda por objetivo de su último catálogo con ruta verificada")
    target.add_argument(
        "--revision",
        help="con --url y un --goal: el objetivo del catálogo de esa revisión, medido contra la ruta de la Guía de la"
        " misma revisión (la etapa visitor); la corrida queda con esa revisión",
    )
    catalog = parser.add_argument_group("con --site")
    catalog.add_argument("--goal", action="append", default=[],
                         help="solo este objetivo; se puede repetir (con --revision, uno solo)")
    catalog.add_argument("--limit", type=int, default=None, help="como máximo N tandas nuevas")
    catalog.add_argument("--rerun", action="store_true", help="repite los objetivos que ya tienen tanda")
    parser.add_argument(
        "--profiles",
        default=None,
        help=f"perfiles separados por coma, de: {', '.join(PROFILES)} (por defecto: {','.join(PERFILES_POR_DEFECTO)})."
        " Los explorador* siguen la skill explorar-caminos y solo corren en local",
    )
    parser.add_argument("--runs", type=int, default=1, help="intentos por perfil (por defecto 1)")
    parser.add_argument(
        "--judge",
        action="store_true",
        help="un modelo juez dictamina con la última captura los intentos sin ruta de la Guía (dos llamadas más por"
        " intento); sin ruta ni juez, el resultado queda sin medir",
    )
    parser.add_argument(
        "--exploradores",
        nargs="?",
        const=config.CONJUNTO_EXPLORADORES,
        default=None,
        choices=list(CONJUNTOS_EXPLORADORES),
        metavar="CONJUNTO",
        help="suma los exploradores de un conjunto: "
        + "; ".join(f"{nombre} = {', '.join(claves)}" for nombre, claves in CONJUNTOS_EXPLORADORES.items())
        + f". Sin nombre, {config.CONJUNTO_EXPLORADORES} (config.CONJUNTO_EXPLORADORES). Sin --profiles, corren solo ellos",
    )
    parser.add_argument(
        "--engine",
        default=os.environ.get("AGENTS_ENGINE") or "claude-code",
        choices=ENGINES,
        help="claude-code: tu Claude Code local, sin clave de API (por defecto, o AGENTS_ENGINE). api: API de Anthropic"
        " con computer use. bedrock: Claude en Amazon Bedrock, con las credenciales de AWS del entorno. fake: un"
        " usuario guionizado, sin Claude, que repite la ruta de la Guía (para probar la etapa de punta a punta).",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"modelo de los usuarios sintéticos (por defecto {config.USER_MODEL}; con --engine bedrock,"
        f" {engines.MODEL_VAR} o {engines.DEFAULT_BEDROCK_MODEL})",
    )
    parser.add_argument("--effort", default=config.USER_EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument(
        "--browser",
        default=os.environ.get("AGENTS_BROWSER") or "local",
        choices=BROWSERS,
        help="local: Chromium en tu computador (por defecto, o AGENTS_BROWSER). agentcore: AgentCore Browser en AWS, una"
        " sesión por usuario.",
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
    parser.add_argument(
        "--tema",
        type=Path,
        default=None,
        metavar="TEMA_JSON",
        help="como --css con el tema.css vecino, y además monta los componentes y features de este tema.json de la"
        " extensión",
    )
    return parser


def _target(
    parser: argparse.ArgumentParser, args: argparse.Namespace
) -> tuple[str, str, str, ConocimientoDeTarea | None]:
    """Devuelve el objetivo, la URL, la instrucción y lo que la tarea dice de su tema (None con --url)."""
    if args.task:
        if args.url or args.instruction:
            parser.error("usa --task, o --url con --instruction, pero no ambos")
        task = load_task(args.task)
        if task is None:
            parser.error(f"no existe la tarea '{args.task}'; disponibles: {', '.join(available_tasks()) or 'ninguna'}")
        return task.id, task.start_url, task.description, ConocimientoDeTarea.de_tarea(task)
    if args.url and args.instruction:
        try:
            return instruction_goal_id(args.instruction), args.url, args.instruction, None
        except ValueError as error:
            parser.error(str(error))
    parser.error("falta qué probar: usa --task <host>/<objetivo>, --url con --instruction, o --site <url>")


def _profile_keys(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[str]:
    # argparse no valida contra `choices` un valor por defecto que viene del entorno.
    if args.engine not in ENGINES or args.browser not in BROWSERS:
        parser.error(f"AGENTS_ENGINE o AGENTS_BROWSER inválidos: usa {', '.join(ENGINES)} y {', '.join(BROWSERS)}")
    if args.runs < 1:
        parser.error("--runs debe ser al menos 1")
    if args.engine == "api" and not os.environ.get("ANTHROPIC_API_KEY"):
        parser.error("falta la variable de entorno ANTHROPIC_API_KEY (necesaria con --engine api)")
    if args.engine == "claude-code" and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión, o usa --engine api")
    if args.cdp_url and args.browser != "local":
        parser.error("--cdp-url solo sirve con --browser local")
    if args.exploradores and not args.profiles:
        profiles = ""  # solo los exploradores del conjunto
    else:
        profiles = args.profiles or ",".join(PERFILES_POR_DEFECTO)
    profile_keys = [key.strip() for key in profiles.split(",") if key.strip()]
    if args.exploradores:
        profile_keys += [key for key in exploradores_del_conjunto(args.exploradores) if key not in profile_keys]
    unknown = [key for key in profile_keys if key not in PROFILES]
    if unknown:
        parser.error(f"perfiles desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PROFILES)}")
    return profile_keys


def _tema(parser: argparse.ArgumentParser, css: Path | None, kit: Path | None) -> str | None:
    """El sha256 corto del tema de `--css` o del kit de `--tema`; None sin tema."""
    if css is not None and kit is not None:
        parser.error("usa --css o --tema, no ambos")
    archivo = css or kit
    if archivo is None:
        return None
    if not archivo.is_file():
        parser.error(f"no existe el archivo de tema {archivo}")
    try:
        return (describir_kit(kit) if kit else describir_tema(css))[1]["sha256"]
    except (ValueError, OSError, KeyError, StopIteration) as error:  # TemaInvalido y UnicodeDecodeError son ValueError
        parser.error(f"tema inválido: {error}")


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
                   tema, args.exploradores)
    asyncio.run(run_planned(backend, planned, catalog, profile_keys=profile_keys, **options))
    print("\nListo.")


def _run_revision(parser: argparse.ArgumentParser, args: argparse.Namespace, backend: store.Backend,
                  profile_keys: list[str], options: dict) -> None:
    """La etapa visitor de una revisión: sale con 0 solo si la corrida quedó `succeeded`."""
    if args.task or args.instruction or args.site or not args.url or len(args.goal) != 1:
        parser.error("--revision va con --url y un solo --goal, sin --task, --instruction ni --site")
    try:
        store.validate_revision(args.revision)
        store.visitor(args.url, args.goal[0])
    except (ValueError, store.InvalidKey) as error:
        parser.error(str(error))
    try:
        run = asyncio.run(run_stage(backend, args.url, args.revision, args.goal[0], profile_keys, **options))
    except MissingInput as missing:
        raise SystemExit(f"error: {missing}")
    except BatchInterrupted as interrupted:
        raise SystemExit(f"error: {interrupted}. Reporte: {interrupted.run.file('report.md')}")
    print(f"\nListo. Reporte: {run.file('report.md')}")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    tema = _tema(parser, args.css, args.tema)
    if not args.site and not args.revision:
        goal, url, instruction, conocimiento = _target(parser, args)
    profile_keys = _profile_keys(parser, args)
    options = {"engine": args.engine, "user_model": args.model, "effort": args.effort, "cdp_url": args.cdp_url,
               "browser": args.browser, "record_video": args.record_video, "runs": args.runs, "judge": args.judge,
               "tema_css": args.css, "tema_kit": args.tema, "conjunto_exploradores": args.exploradores}
    backend = store.open_backend()
    if args.revision:
        _run_revision(parser, args, backend, profile_keys, options)
        return
    if args.site:
        _run_site(parser, args, backend, profile_keys, options, tema)
        return
    references = find_references(backend, url, goal, instruction, profile_keys)
    try:
        run = asyncio.run(run_batch(backend, store.visitor(url, goal), url, instruction, profile_keys, references,
                                    conocimiento=conocimiento, **options))
    except BatchInterrupted as interrupted:
        raise SystemExit(f"error: {interrupted}. Reporte: {interrupted.run.file('report.md')}")
    print(f"\nListo. Reporte: {run.file('report.md')}")


if __name__ == "__main__":
    main()
