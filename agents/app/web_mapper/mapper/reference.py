"""Ruta de referencia de una tarea en un viewport: explorar, destilar, verificar, minimizar y escribir."""

import shutil
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Browser

from browser import BrowserSession, create_context
from profiles import PROFILES, Profile

from mapper.decider import Decider
from mapper.explore import Exploration, Log, explore
from mapper.output import route_document, write_reference
from mapper.replay import Verification, verify_and_minimise
from mapper.route import distill


@dataclass
class Mapping:
    """Qué mapear y dónde dejarlo."""

    task_id: str | None
    url: str
    instruction: str
    viewport: str
    profile: Profile
    model: str
    effort: str
    out_dir: Path


async def _explore(browser: Browser, mapping: Mapping, decider: Decider, log: Log) -> Exploration:
    context = await create_context(browser, mapping.profile)
    try:
        session = BrowserSession(context, mapping.profile)
        await session.open(mapping.url)
        return await explore(session, decider, mapping.instruction, log)
    finally:
        await context.close()


def _meta(mapping: Mapping) -> dict:
    profile = mapping.profile
    return {
        "task_id": mapping.task_id,
        "instruction": mapping.instruction,
        "start_url": mapping.url,
        "profile": mapping.viewport,
        "viewport": f"{profile.width}x{profile.height}",
        "evaluator_profiles": [
            key for key, other in PROFILES.items()
            if (other.width, other.height, other.mobile) == (profile.width, profile.height, profile.mobile)
        ],
        "model": mapping.model,
        "effort": mapping.effort,
    }


def _details(exploration: Exploration, verification: Verification | None, usage: dict, cost_usd: float) -> dict:
    return {
        "answer": exploration.answer,
        "quote": exploration.quote,
        "quote_found": bool(verification and verification.replay.quote_found),
        "exploration": {
            "end_reason": exploration.end_reason,
            "message": exploration.message,
            "steps": len(exploration.steps),
            "turns": exploration.turns,
            "duration_s": exploration.duration_s,
            "tokens": usage,
            "cost_usd": round(cost_usd, 4),
            "history": [f"{entry.action} — {entry.outcome} (razón: {entry.reason})" for entry in exploration.history],
        },
        "verification": {
            "replays": verification.replays,
            "removed_steps": verification.removed_steps,
            "error": verification.error,
        } if verification else None,
    }


async def _verify(browser: Browser, mapping: Mapping, exploration: Exploration, log: Log) -> Verification:
    candidate = distill(exploration.steps)
    log(f"ruta candidata: {len(candidate)} de {len(exploration.steps)} acciones; verificando")
    return await verify_and_minimise(
        browser, mapping.profile, mapping.url, candidate, exploration.final_node, exploration.quote, log
    )


async def map_reference(browser: Browser, mapping: Mapping, decider: Decider) -> dict:
    """Mapea la ruta, la escribe en `mapping.out_dir` y devuelve el documento de route.json."""
    def log(text: str) -> None:
        print(f"[{mapping.viewport}] {text}", flush=True)

    shutil.rmtree(mapping.out_dir, ignore_errors=True)
    mapping.out_dir.mkdir(parents=True)
    exploration = await _explore(browser, mapping, decider, log)
    verification = await _verify(browser, mapping, exploration, log) if exploration.end_reason == "done" else None

    if verification is None:
        status, steps = "not_found", []
    else:
        status, steps = ("verified" if verification.verified else "unverified"), verification.route
    start = verification.replay if verification and verification.verified else exploration
    document = route_document(
        _meta(mapping), status, start.start_url, start.start_title, steps,
        _details(exploration, verification, decider.usage, decider.cost_usd),
    )
    write_reference(mapping.out_dir, document, start.start_screenshot, steps)
    log(f"{status}: {document['totals']['min_steps']} pasos mínimos — {mapping.out_dir / 'route.json'}")
    return document
