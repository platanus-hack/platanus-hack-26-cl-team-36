"""Conductor: encadena las etapas de una revisión de una página y deja su corrida en el almacén.

Uso, desde agents/app/conductor/:

    uv run main.py --url https://www.wom.cl/ --revision rev-1
    uv run main.py --url https://www.wom.cl/ --revision rev-1 --goals-max 1 --concurrency 1
"""

import argparse
import sys

from conductor import command


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="conductor",
        description="Revisión de una página: catálogo, Guía y Visitante por objetivo, y mejora (tema.css).",
    )
    command.add_arguments(parser)
    return parser


def main() -> None:
    parser = build_parser()
    sys.exit(0 if command.run(parser, parser.parse_args()) else 1)


if __name__ == "__main__":
    main()
