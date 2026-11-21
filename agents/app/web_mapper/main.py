"""Mapeador: lee el DOM para encontrar las rutas de referencia y los objetivos de un sitio.

Uso, desde agents/app/web_mapper/:

    uv run main.py route --task wom-baja-fibra
    uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
    uv run main.py goals --url https://www.wom.cl/ --routes 2
"""

import argparse
import shutil

from mapper import config, goals_command, route_command

COMMANDS = {"route": route_command, "goals": goals_command}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="web_mapper", description="Mapeador: cataloga los objetivos de un sitio y encuentra sus rutas de referencia.")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in COMMANDS.values():
        command.add_parser(commands)
    for subparser in commands.choices.values():
        subparser.add_argument("--model", default=config.MODEL, help=f"modelo del Mapeador (por defecto: {config.MODEL})")
        subparser.add_argument("--effort", default=config.EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
        subparser.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP (por defecto, Chromium local)")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión")
    COMMANDS[args.command].run(parser, args)


if __name__ == "__main__":
    main()
