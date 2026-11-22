"""Conductor: encadena las etapas de una revisión de una página y deja su corrida en el almacén.

Uso, desde agents/app/conductor/:

    uv run main.py --url https://www.wom.cl/ --revision rev-1
    uv run main.py --url https://www.wom.cl/ --revision rev-1 --goals-max 1 --concurrency 1
"""

import argparse
import signal
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
    # SIGTERM como Ctrl-C: se cancelan las etapas en curso y la corrida termina `failed`.
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    try:
        succeeded = command.run(parser, parser.parse_args())
    except KeyboardInterrupt:
        succeeded = False
    sys.exit(0 if succeeded else 1)


if __name__ == "__main__":
    main()
