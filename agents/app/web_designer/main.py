"""Diseñador: genera temas con un skill de Claude y los mide sobre la página real.

Uso, desde agents/app/web_designer/:

    uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "Modo oscuro, letra más grande"
    uv run main.py --url https://es.wikipedia.org/wiki/Valdivia --gustos "..." --skill none --repeticiones 3
    uv run main.py --casos casos.json --repeticiones 2
    uv run main.py --url https://ejemplo.cl --gustos "..." --solo-evaluar tema.css
    uv run main.py --comparar <resumen_a.json> <resumen_b.json>
"""

import argparse
import asyncio
import json
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from disenador import config, resumen
from disenador.corrida import Caso, Opciones, correr, id_de_url, leer_casos
from disenador.modelo import ClaudeCode, leer_skill

ESFUERZOS = ["low", "medium", "high", "xhigh", "max"]


def ruta_visible(ruta: Path) -> str:
    try:
        return str(ruta.resolve().relative_to(config.REPO_DIR))
    except ValueError:
        return str(ruta.resolve())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="web_designer",
        description="Genera temas (CSS bajo html.mi-tema) con un skill de Claude, los aplica sobre la página real y"
        " los mide: métricas deterministas y un juez.",
    )
    que = parser.add_argument_group("qué diseñar: --url con --gustos, o --casos")
    que.add_argument("--url", help="página a la que se le diseña el tema")
    que.add_argument("--gustos", help="gustos del usuario, en texto libre")
    que.add_argument("--tarea", default=None, help="tarea del usuario en el sitio (opcional)")
    que.add_argument("--casos", type=Path, help="casos.json: lista de {id, url, gustos, tarea?}")
    parser.add_argument(
        "--skill",
        default=str(config.SKILL_POR_DEFECTO),
        help="SKILL.md que guía al modelo (por defecto .claude/skills/disenar-tema/SKILL.md); `none` para la línea base",
    )
    parser.add_argument("--model", default=config.MODELO, help=f"modelo que diseña (por defecto {config.MODELO})")
    parser.add_argument("--effort", default=config.ESFUERZO, choices=ESFUERZOS,
                        help=f"esfuerzo del modelo que diseña (por defecto {config.ESFUERZO})")
    parser.add_argument("--repeticiones", type=int, default=1, help="generaciones independientes por caso (varianza)")
    parser.add_argument("--juez-model", default=config.MODELO_JUEZ, help=f"modelo del juez (por defecto {config.MODELO_JUEZ})")
    parser.add_argument("--juez-effort", default=config.ESFUERZO_JUEZ, choices=ESFUERZOS)
    parser.add_argument("--concurrencia", type=int, default=config.CONCURRENCIA, help="generaciones simultáneas")
    parser.add_argument("--output", type=Path, default=None,
                        help="carpeta de la corrida (por defecto agents/.runs/diseno/<id o host>/<fecha-hora>/)")
    parser.add_argument("--solo-evaluar", type=Path, default=None, metavar="TEMA_CSS",
                        help="no genera: evalúa este CSS (saneamiento, métricas y juez)")
    parser.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP (por defecto, Chromium local)")
    parser.add_argument("--comparar", nargs=2, type=Path, metavar=("RESUMEN_A", "RESUMEN_B"),
                        help="imprime la diferencia entre dos resumen.json y termina")
    return parser


def _casos(parser: argparse.ArgumentParser, args) -> tuple[list[Caso], str]:
    if args.casos:
        if args.url or args.gustos:
            parser.error("usa --casos, o --url con --gustos, pero no ambos")
        try:
            return leer_casos(args.casos), args.casos.stem
        except (OSError, ValueError) as error:
            parser.error(f"no se pudo leer {args.casos}: {error}")
    if not (args.url and args.gustos):
        parser.error("falta qué diseñar: usa --url con --gustos, o --casos <casos.json>")
    identificador = id_de_url(args.url)
    return [Caso(identificador, args.url, args.gustos, args.tarea)], identificador


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.comparar:
        a, b = (json.loads(ruta.read_text(encoding="utf-8")) for ruta in args.comparar)
        print(resumen.comparar(a, b))
        return

    casos, nombre = _casos(parser, args)
    if args.repeticiones < 1:
        parser.error("--repeticiones debe ser al menos 1")
    if not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión")
    skill = None
    if args.skill.lower() != "none":
        ruta_skill = Path(args.skill)
        if not ruta_skill.is_file():
            parser.error(f"no existe el skill {ruta_skill}; usa --skill none para la línea base")
        skill = leer_skill(ruta_skill)
    if args.solo_evaluar and not args.solo_evaluar.is_file():
        parser.error(f"no existe el archivo {args.solo_evaluar}")

    fecha = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    salida = args.output or config.RUNS_DIR / nombre / fecha
    if salida.exists() and any(salida.iterdir()):
        parser.error(f"la carpeta {salida} ya existe y no está vacía")
    opciones = Opciones(
        skill=skill,
        modelo=args.model,
        esfuerzo=args.effort,
        modelo_juez=args.juez_model,
        esfuerzo_juez=args.juez_effort,
        repeticiones=1 if args.solo_evaluar else args.repeticiones,
        css_dado=args.solo_evaluar,
        concurrencia=args.concurrencia,
    )
    print(f"Skill: {skill.nombre + ' (' + skill.sha256 + ')' if skill else 'ninguno'} · modelo {args.model}"
          f" ({args.effort}) · juez {args.juez_model} · {len(casos)} caso(s) x {opciones.repeticiones}", flush=True)

    # Claude Code corre en una carpeta vacía para no cargar CLAUDE.md ni memoria de ningún proyecto.
    claude_cwd = Path(tempfile.mkdtemp(prefix="web_designer-claude-"))
    try:
        filas = asyncio.run(correr(
            casos, opciones, salida,
            ClaudeCode(args.model, args.effort, claude_cwd),
            ClaudeCode(args.juez_model, args.juez_effort, claude_cwd),
            cdp_url=args.cdp_url,
        ))
    finally:
        shutil.rmtree(claude_cwd, ignore_errors=True)
    meta = {
        "fecha": fecha,
        "skill": skill.describir() if skill else None,
        "modelo": args.model,
        "esfuerzo": args.effort,
        "modelo_juez": args.juez_model,
        "esfuerzo_juez": args.juez_effort,
        "repeticiones": opciones.repeticiones,
        "css_dado": str(args.solo_evaluar) if args.solo_evaluar else None,
        "casos": [vars(caso) for caso in casos],
    }
    datos = resumen.escribir(salida, filas, meta)
    total = datos["global"]
    print(f"\nListo. Juez {resumen.formato(total['promedios']['promedio_juez'])} · {total['errores']} error(es)."
          f"\nReporte: {ruta_visible(salida / 'reporte.md')}")
    if total["errores"] == total["generaciones"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
