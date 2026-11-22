"""Una corrida del Catalogador: esquema del sitio y catálogo de objetivos."""

import argparse
import asyncio
import time
from pathlib import Path

from shared.browser.session import open_browser
from shared.browser.viewports import SCREENS
from shared.catalog.goal import Goal, exclusion
from shared.claude.caller import ClaudeCallError
from shared.claude.engines import make_caller
from shared.claude.workdir import claude_workdir
from shared import store

from cataloger import config
from cataloger.crawl import crawl
from cataloger.output import write_catalog, write_outline
from cataloger.propose import propose_goals, scripted_catalog
from cataloger.rules import classify


class CrawlError(Exception):
    """El esquema no tiene páginas: no hay nada que catalogar."""


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--url", required=True, help="URL inicial del sitio")
    parser.add_argument("--pages", type=int, default=None,
                        help=f"tope de páginas (por defecto: {config.MAX_PAGES}; 1 con --revision)")
    parser.add_argument("--depth", type=int, default=config.MAX_DEPTH, help=f"tope de profundidad (por defecto: {config.MAX_DEPTH})")
    parser.add_argument("--rerun", action="store_true", help="hace un catálogo nuevo aunque ya haya uno")
    parser.add_argument("--revision", default=None, help="cataloga solo esta página para esa revisión, sin reusar otro catálogo")


def log(text: str) -> None:
    print(f"[catálogo] {text}", flush=True)


async def catalog(args: argparse.Namespace, out_dir: Path) -> list[Goal]:
    """Escribe el esquema y el catálogo en `out_dir` y devuelve los objetivos."""
    screen = SCREENS["desktop"]
    with claude_workdir("cataloger") as claude_cwd:
        async with open_browser(args.cdp_url) as browser:
            outline = await crawl(browser, screen, args.url, args.pages, args.depth, log)
        write_outline(out_dir, outline)
        if not outline.pages:
            raise CrawlError("la página inicial no cargó: " + ("; ".join(outline.failures) or "sin páginas"))
        caller = make_caller(args.model, args.effort, claude_cwd, out_dir / "claude_code.log", fake=scripted_catalog)
        log(f"el modelo lee {len(outline.pages)} páginas")
        goals, issues = classify(await propose_goals(caller, outline), outline, screen.height)
    for issue in issues:
        log(f"corrección: {issue}")
    meta = {
        "host": outline.host, "start_url": outline.start_url, "viewport": outline.viewport, "pages": len(outline.pages),
        "model": args.model, "effort": args.effort,
        "catalog_tokens": caller.usage, "catalog_cost_usd": round(caller.cost_usd, 4),
    }
    write_catalog(out_dir, meta, goals, issues)
    return goals


def _catalog_run(backend: store.Backend, args: argparse.Namespace) -> str:
    with store.running(backend, store.cataloger(args.url), model=args.model, revision=args.revision) as run:
        goals = asyncio.run(catalog(args, run.workdir))
    evaluable = sum(exclusion(goal) is None for goal in goals)
    return f"{len(goals)} objetivos, {evaluable} evaluables — {run.key.file('goals.md')}"


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    try:
        prefix = store.cataloger(args.url)
    except store.InvalidKey:
        parser.error(f"URL inválida: {args.url}")
    if args.revision is not None:
        try:
            store.validate_revision(args.revision)
        except ValueError:
            parser.error(f"revisión inválida: {args.revision}")
    if args.pages is None:
        args.pages = 1 if args.revision else config.MAX_PAGES
    backend = store.open_backend()
    # Con --revision la corrida es de esa revisión: un catálogo de otra no sirve.
    previous = None if args.revision else store.latest_run(backend, prefix)
    if previous and not args.rerun:
        print(f"Ya hay un catálogo: {previous.file('goals.json')} (--rerun para hacer otro).")
        return
    started = time.monotonic()
    try:
        done = _catalog_run(backend, args)
    except (ClaudeCallError, CrawlError) as error:
        raise SystemExit(f"error: el catálogo no se pudo generar: {error}")
    print(f"\nListo en {time.monotonic() - started:.0f} s: {done}")
