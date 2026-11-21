"""Subcomando `adopt`: verifica las rutas que propuso el Visitante para un objetivo."""

import argparse
import asyncio
from collections.abc import Iterator

from shared import store
from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS
from shared.catalog.routes import current_route

from guide.adopt import adopt

Pending = tuple[store.RunKey, dict, store.RunKey]


def add_parser(commands: argparse._SubParsersAction) -> None:
    command = commands.add_parser("adopt", help="verifica las rutas propuestas por el Visitante y adopta las más cortas")
    command.add_argument("--goal", required=True, help="<host>/<objetivo>: sus propuestas contra su ruta vigente")


def _checked(backend: store.Backend, host: str, goal: str) -> set[tuple[str, ...]]:
    """Las entradas de cada corrida de guide del objetivo: una propuesta revisada deja (ruta, visitor) en ellas."""
    checked = set()
    for viewport in SCREENS:
        for run in backend.list_runs(store.guide(host, goal, viewport)):
            try:
                checked.add(store.read_manifest(backend, run).inputs)
            except (OSError, ValueError, KeyError, TypeError):
                continue
    return checked


def pending(backend: store.Backend, host: str, goal: str) -> Iterator[Pending]:
    """Por ruta vigente, la propuesta más corta que la superó y no se revisó: (ruta, propuesta, corrida del Visitante)."""
    checked = _checked(backend, host, goal)
    candidates: dict[str, list[tuple[dict, store.RunKey]]] = {}
    for run in store.runs_with_status(backend, store.visitor(host, goal)):
        if not backend.exists(run.file("proposals.json")):
            continue
        for proposal in backend.read_json(run.file("proposals.json")):
            if (proposal["route"], str(run)) not in checked:
                candidates.setdefault(proposal["route"], []).append((proposal, run))
    for route_key, found in candidates.items():
        route_run = store.parse_key(route_key).run
        proposal, run = min(found, key=lambda item: item[0]["steps_count"])
        current = current_route(backend, proposal["start_url"], goal, route_run.prefix.viewport, proposal["instruction"])
        if current and current[0] == route_run:
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
        print(f"No hay propuestas pendientes para {args.goal}.")
        return
    statuses = asyncio.run(_adopt(backend, found, args.cdp_url))
    print(f"\nListo: {', '.join(statuses)}")
