"""Subcomando `adopt`: verifica las rutas que propuso el Visitante para un objetivo."""

import argparse
import asyncio
from collections.abc import Iterator

from shared import store
from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS

from guide.adopt import adopt

Pending = tuple[store.RunKey, dict, store.RunKey]


def add_parser(commands: argparse._SubParsersAction) -> None:
    command = commands.add_parser("adopt", help="verifica las rutas propuestas por el Visitante y adopta las más cortas")
    command.add_argument("--goal", required=True, help="<host>/<objetivo>: sus propuestas contra su ruta vigente")


def pending(backend: store.Backend, host: str, goal: str) -> Iterator[Pending]:
    """Por viewport, la ruta vigente y la propuesta más corta que la superó: (ruta, propuesta, corrida del Visitante)."""
    visitor_runs = [run for run in backend.list_runs(store.visitor(host, goal))
                    if store.read_manifest(backend, run).status == "succeeded"
                    and backend.exists(run.file("proposals.json"))]
    for viewport in SCREENS:
        route_run = store.latest_run(backend, store.guide(host, goal, viewport))
        candidates = [(proposal, run) for run in visitor_runs for proposal in backend.read_json(run.file("proposals.json"))
                      if route_run and proposal["route"] == str(route_run)]
        if candidates:
            proposal, run = min(candidates, key=lambda item: item[0]["steps_count"])
            yield route_run, proposal, run


async def _adopt(backend: store.Backend, found: list[Pending], cdp_url: str | None) -> list[str]:
    async with open_browser(cdp_url) as browser:
        return [await adopt(browser, backend, route_run, proposal, visitor_run,
                            lambda text: print(f"[adopt] {text}", flush=True))
                for route_run, proposal, visitor_run in found]


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    host, _, goal = args.goal.partition("/")
    backend = store.open_backend()
    try:
        found = list(pending(backend, host, goal))
    except store.InvalidKey as error:
        parser.error(f"objetivo inválido {args.goal!r}: {error}")
    if not found:
        parser.error(f"no hay propuestas pendientes para {args.goal}")
    statuses = asyncio.run(_adopt(backend, found, args.cdp_url))
    print(f"\nListo: {', '.join(statuses)}")
