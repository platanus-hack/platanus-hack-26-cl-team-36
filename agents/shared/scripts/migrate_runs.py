"""Copia las corridas del layout anterior a un almacén de shared.store; sin --write solo muestra el plan.

    uv run scripts/migrate_runs.py --to file:///tmp/corridas            # plan
    uv run scripts/migrate_runs.py --to file:///tmp/corridas --write    # escribe
"""

import argparse
import os
from pathlib import Path

from legacy_runs.migrate import existing_status, migrate
from legacy_runs.scan import Migration, scan

from shared.store import ENV_VAR, Backend, open_backend
from shared.store.selection import default_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="migrate_runs", description=__doc__.splitlines()[0])
    parser.add_argument("--from", dest="source", type=Path, default=None,
                        help="carpeta con el layout anterior (por defecto agents/.runs/)")
    parser.add_argument("--to", default=os.environ.get(ENV_VAR),
                        help=f"almacén de destino, file:///ruta o s3://bucket/prefijo (por defecto {ENV_VAR})")
    parser.add_argument("--write", action="store_true", help="escribe las corridas; sin él solo muestra el plan")
    return parser


def run(source: Path, backend: Backend, write: bool) -> list[str]:
    """Las líneas del plan, o de lo hecho con `write`; la fuente nunca se modifica."""
    lines: list[str] = []
    for item in scan(source):
        where = item.source.relative_to(source)
        if not isinstance(item, Migration):
            lines.append(f"{where}: se omite, {item.reason}")
            continue
        status = existing_status(backend, item)
        if status is not None:
            lines.append(f"{where}: ya migrada en {item.run} ({status})")
            continue
        key = migrate(backend, item) if write else item.run
        lines.append(f"{where} → {key}" + (" (failed)" if item.status == "failed" else ""))
        lines += [f"    sin {omitted}" for omitted in item.omitted]
    return lines


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not args.to:
        parser.error(f"falta el destino: --to o {ENV_VAR}")
    source = (args.source or default_root()).resolve()
    if not source.is_dir():
        parser.error(f"no existe {source}")
    for line in run(source, open_backend(args.to), args.write):
        print(line)
    if not args.write:
        print("\nSolo el plan: --write para escribir.")


if __name__ == "__main__":
    main()
