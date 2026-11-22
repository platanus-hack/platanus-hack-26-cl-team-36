"""Guía: encuentra y verifica la ruta de referencia de una tarea u objetivo leyendo el DOM.

Uso, desde agents/app/guide/:

    uv run main.py route --task wom-baja-fibra
    uv run main.py route --url https://ejemplo.cl --instruction "Encontrar el horario de la sucursal"
    uv run main.py route --goals ../../.runs/www.wom.cl/goals/goals.json --routes 2
    uv run main.py adopt --id wom-baja-fibra
"""

import argparse
import shutil

from guide import adopt_command, config, route_command

COMMANDS = {"route": route_command, "adopt": adopt_command}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="guide", description="Guía: encuentra y verifica la ruta de referencia de una tarea u objetivo.")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in COMMANDS.values():
        command.add_parser(commands)
    for subparser in commands.choices.values():
        subparser.add_argument("--model", default=config.MODEL, help=f"modelo de la Guía (por defecto: {config.MODEL})")
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
