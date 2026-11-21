"""Subcomando `goals`: esquema del sitio, catálogo de objetivos y, si se pide, sus rutas de referencia."""

import argparse
import asyncio
import shutil
import time
from pathlib import Path
from urllib.parse import urlsplit

from mapper import config
from mapper.catalog import propose_goals
from mapper.claude import ClaudeCallError, ClaudeCaller
from mapper.crawl import crawl
from mapper.goal_routes import map_goal_routes
from mapper.goal_rules import classify, id_prefix
from mapper.goals import routable
from mapper.goals_output import write_catalog, write_outline
from mapper.runtime import runtime


def add_parser(commands: argparse._SubParsersAction) -> None:
    goals = commands.add_parser("goals", help="descubre y clasifica los objetivos que un sitio ofrece a un visitante")
    goals.add_argument("--url", required=True, help="URL inicial del sitio")
    goals.add_argument("--pages", type=int, default=config.MAX_PAGES, help=f"tope de páginas (por defecto: {config.MAX_PAGES})")
    goals.add_argument("--depth", type=int, default=config.MAX_DEPTH, help=f"tope de profundidad (por defecto: {config.MAX_DEPTH})")
    goals.add_argument("--routes", type=int, default=0, help="mapea la ruta de referencia de hasta N objetivos (por defecto: 0)")
    goals.add_argument("--output", type=Path, default=None, help="otra carpeta en vez de agents/.runs/<host>/goals/")


def log(text: str) -> None:
    print(f"[objetivos] {text}", flush=True)


async def discover(args: argparse.Namespace, out_dir: Path) -> int:
    """Escribe el catálogo en `out_dir` y devuelve cuántos objetivos tiene."""
    profile = config.VIEWPORTS["desktop"]
    async with runtime(args.cdp_url) as (browser, claude_cwd):
        outline = await crawl(browser, profile, args.url, args.pages, args.depth, log)
        write_outline(out_dir, outline)
        caller = ClaudeCaller(args.model, args.effort, claude_cwd, out_dir / "claude_code.log")
        log(f"catálogo: el modelo lee {len(outline.pages)} páginas")
        raw_goals = await propose_goals(caller, outline, id_prefix(outline.host))
        goals, issues = classify(raw_goals, outline, profile.height)
        for issue in issues:
            log(f"corrección: {issue}")
        selected = routable(goals, args.routes)
        if selected:
            log(f"rutas de referencia para: {', '.join(goal.id for goal in selected)}")
            await map_goal_routes(browser, selected, args.model, args.effort, claude_cwd)
    meta = {
        "host": outline.host, "start_url": outline.start_url, "viewport": outline.viewport, "pages": len(outline.pages),
        "model": args.model, "effort": args.effort,
        "catalog_tokens": caller.usage, "catalog_cost_usd": round(caller.cost_usd, 4),
    }
    write_catalog(out_dir, meta, goals, issues)
    return len(goals)


def run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    host = urlsplit(args.url).hostname
    if not host:
        parser.error(f"URL inválida: {args.url}")
    out_dir = args.output or config.RUNS_DIR / host / "goals"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    started = time.monotonic()
    try:
        count = asyncio.run(discover(args, out_dir))
    except ClaudeCallError as error:
        raise SystemExit(f"error: el catálogo no se pudo generar: {error}")
    print(f"\nListo en {time.monotonic() - started:.0f} s: {count} objetivos — {out_dir / 'goals.md'}")
