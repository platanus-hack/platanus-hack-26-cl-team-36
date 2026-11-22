"""Catalogador: recorre un sitio leyendo el DOM y cataloga los objetivos que ofrece a un visitante.

Uso, desde agents/app/cataloger/:

    uv run main.py --url https://www.wom.cl/
    uv run main.py --url https://www.sii.cl/ --pages 10 --rerun
"""

import argparse
import shutil

from shared.claude import engines

from cataloger import command, config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cataloger", description="Catalogador: descubre y clasifica los objetivos que un sitio ofrece a un visitante.")
    command.add_arguments(parser)
    parser.add_argument("--model", default=config.MODEL, help=f"modelo del Catalogador (por defecto: {config.MODEL})")
    parser.add_argument("--effort", default=config.EFFORT, choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--cdp-url", default=None, help="navegador remoto vía CDP (por defecto, Chromium local)")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if engines.needs_claude_cli() and not shutil.which("claude"):
        parser.error("no se encontró el comando `claude`; instala Claude Code e inicia sesión")
    args.model = engines.model_for(args.model, strong=True)
    command.run(parser, args)


if __name__ == "__main__":
    main()
