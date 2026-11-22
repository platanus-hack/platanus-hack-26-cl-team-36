"""Resumen de un sitio: cada objetivo del último catálogo con su ruta de la Guía y su última tanda del Visitante.

Uso, desde agents/app/summary/:

    uv run main.py --site https://www.wom.cl/
    uv run main.py --site https://www.wom.cl/ --css tema.css
"""

import argparse
from pathlib import Path

from shared import store
from shared.browser.theme import TemaInvalido, describir_tema

from summary.site import write_summary


def main() -> None:
    parser = argparse.ArgumentParser(prog="summary", description="Escribe summary.md y summary.json del último catálogo de un sitio.")
    parser.add_argument("--site", required=True, help="URL del sitio")
    parser.add_argument("--css", type=Path, default=None, metavar="ARCHIVO",
                        help="resume solo las tandas que corrieron con este tema (summary.json lo registra en `tema`)")
    args = parser.parse_args()
    tema = None
    if args.css is not None:
        try:
            tema = describir_tema(args.css)[1]["sha256"]
        except (OSError, TemaInvalido, UnicodeDecodeError) as error:
            parser.error(str(error))
    try:
        run = write_summary(store.open_backend(), args.site, tema)
    except (LookupError, store.InvalidKey) as error:
        parser.error(str(error))
    print(f"Resumen: {run.file('summary.md')}")


if __name__ == "__main__":
    main()
