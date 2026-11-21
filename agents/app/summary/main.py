"""Resumen de un sitio: cada objetivo del catálogo con su ruta de la Guía y su última tanda del Visitante.

Uso, desde agents/app/summary/:

    uv run main.py --goals ../../.runs/www.wom.cl/goals/goals.json
    uv run main.py --goals ../../.runs/www.wom.cl/goals/goals.json --css tema.css
"""

import argparse
from pathlib import Path

from shared.browser.theme import TemaInvalido, describir_tema

from summary.site import write_summary

RUNS_DIR = Path(__file__).resolve().parents[2] / ".runs"


def main() -> None:
    parser = argparse.ArgumentParser(prog="summary", description="Escribe summary.md y summary.json junto a un catálogo.")
    parser.add_argument("--goals", type=Path, required=True, help="goals.json del Catalogador")
    parser.add_argument("--css", type=Path, default=None, metavar="ARCHIVO",
                        help="resume solo las tandas que corrieron con este tema (summary-tema-<sha>.md)")
    args = parser.parse_args()
    if not args.goals.is_file():
        parser.error(f"no existe el catálogo {args.goals}")
    tema = None
    if args.css is not None:
        try:
            tema = describir_tema(args.css)[1]["sha256"]
        except (OSError, TemaInvalido, UnicodeDecodeError) as error:
            parser.error(str(error))
    print(f"Resumen: {write_summary(args.goals, RUNS_DIR, tema)}")


if __name__ == "__main__":
    main()
