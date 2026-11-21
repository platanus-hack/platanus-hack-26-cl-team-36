"""Subcomando `adopt`: verifica las rutas que propuso el evaluador para una tarea u objetivo."""

import argparse
import asyncio
import json
from pathlib import Path

from mapper import config
from mapper.adopt import adopt
from mapper.runtime import runtime


def add_parser(commands: argparse._SubParsersAction) -> None:
    command = commands.add_parser("adopt", help="verifica las rutas propuestas por el evaluador y adopta las más cortas")
    command.add_argument("--id", required=True, help="tarea u objetivo: lee agents/.runs/<id>/reference/*/proposed.json")


async def _adopt(folders: list[Path], cdp_url: str | None) -> list[str]:
    async with runtime(cdp_url) as (browser, _):
        return [await adopt(browser, folder, lambda text: print(f"[adopt] {text}", flush=True)) for folder in folders]


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    folders = sorted(path.parent for path in (config.RUNS_DIR / args.id / "reference").glob("*/proposed.json"))
    pending = [folder for folder in folders
               if json.loads((folder / "proposed.json").read_text(encoding="utf-8"))["status"] == "proposed"]
    if not pending:
        parser.error(f"no hay propuestas pendientes en {config.RUNS_DIR / args.id / 'reference'}")
    statuses = asyncio.run(_adopt(pending, args.cdp_url))
    print(f"\nListo: {', '.join(statuses)}")
