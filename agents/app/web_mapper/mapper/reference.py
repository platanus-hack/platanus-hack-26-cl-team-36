"""Ruta de referencia de una tarea en un viewport: explorar, verificar, buscar una más corta y escribir."""

import asyncio
import shutil
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Browser

from browser import BrowserSession, create_context
from profiles import PROFILES, Profile

from mapper import config
from mapper.candidates import Candidate, search_record, shorter_instruction
from mapper.claude import ClaudeCaller
from mapper.decider import ClaudeDecider, Decider
from mapper.explore import Exploration, explore
from mapper.operate import Log
from mapper.output import route_document, write_reference
from mapper.prompts import system_prompt
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
    extra_routes: int = config.EXTRA_ROUTES


async def _explore(browser: Browser, mapping: Mapping, decider: Decider, instruction: str, log: Log) -> Exploration:
    context = await create_context(browser, mapping.profile)
    try:
        return await explore(BrowserSession(context, mapping.profile), mapping.url, decider, instruction, log)
    finally:
        await context.close()


def _meta(mapping: Mapping) -> dict:
    profile = mapping.profile
    return {
        "task_id": mapping.task_id,
        "instruction": mapping.instruction,
        "start_url": mapping.url,
        "viewport": mapping.viewport,
        "viewport_size": f"{profile.width}x{profile.height}",
        # Los exploradores recorren el sitio a propósito y no siguen la ruta: no se les aplica la referencia.
        "evaluator_profiles": [
            key for key, other in PROFILES.items()
            if not other.explora
            and (other.width, other.height, other.mobile) == (profile.width, profile.height, profile.mobile)
        ],
        "model": mapping.model,
        "effort": mapping.effort,
    }


def _details(best: Candidate, usage: dict, cost_usd: float) -> dict:
    exploration, verification = best.exploration, best.verification
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
    """Prueba la candidata que corta las vueltas donde se llegó a cada nodo y, si no verifica, la que corta donde se salió."""
    verification, previous = None, None
    for keep_steps_before_leaving in (False, True):
        candidate = distill(exploration.steps, keep_steps_before_leaving)
        if candidate == previous:
            break
        previous = candidate
        log(f"ruta candidata: {len(candidate)} de {len(exploration.steps)} acciones; verificando")
        verification = await verify_and_minimise(
            browser, mapping.profile, mapping.url, candidate, exploration.final_node, exploration.quote, log
        )
        if verification.verified:
            break
    return verification


async def _candidate(browser: Browser, mapping: Mapping, decider: Decider, instruction: str, log: Log) -> Candidate:
    cost_before = decider.cost_usd
    exploration = await _explore(browser, mapping, decider, instruction, log)
    verification = await _verify(browser, mapping, exploration, log) if exploration.end_reason == "done" else None
    return Candidate(exploration, verification, decider.cost_usd - cost_before)


async def _search(browser: Browser, mapping: Mapping, decider: Decider, log: Log) -> tuple[list[Candidate], Candidate]:
    """La primera ruta y hasta `extra_routes` exploraciones más que piden una más corta; gana la que `beats`."""
    best = await _candidate(browser, mapping, decider, mapping.instruction, log)
    candidates = [best]
    for _ in range(mapping.extra_routes):
        if best.status != "verified" or best.totals["min_steps"] == 0:
            break
        log(f"buscando una ruta de menos de {best.totals['min_steps']} pasos mínimos")
        candidate = await _candidate(browser, mapping, decider, shorter_instruction(mapping.instruction, best), log)
        candidates.append(candidate)
        if candidate.beats(best):
            best = candidate
    return candidates, best


async def map_reference(browser: Browser, mapping: Mapping, decider: Decider) -> dict:
    """Mapea la ruta, la escribe en `mapping.out_dir` y devuelve el documento de route.json."""
    prefix = f"{mapping.task_id} {mapping.viewport}" if mapping.task_id else mapping.viewport

    def log(text: str) -> None:
        print(f"[{prefix}] {text}", flush=True)

    shutil.rmtree(mapping.out_dir, ignore_errors=True)
    mapping.out_dir.mkdir(parents=True)
    candidates, best = await _search(browser, mapping, decider, log)
    document = route_document(
        _meta(mapping), best.status, best.start, best.steps, best.quote_scrolls,
        {**_details(best, decider.usage, decider.cost_usd), "search": search_record(candidates, best)},
    )
    write_reference(mapping.out_dir, document, best.start[2], best.steps)
    log(f"{best.status}: {document['totals']['min_steps']} pasos mínimos — {mapping.out_dir / 'route.json'}")
    return document


async def map_references(
    browser: Browser, mappings: list[Mapping], claude_cwd: Path, concurrency: int
) -> list[dict | BaseException]:
    """Mapea varias rutas, a lo más `concurrency` a la vez; el error de una no detiene a las demás."""
    semaphore = asyncio.Semaphore(concurrency)

    async def one(mapping: Mapping) -> dict:
        caller = ClaudeCaller(mapping.model, mapping.effort, claude_cwd, mapping.out_dir / "claude_code.log")
        decider = ClaudeDecider(system_prompt(mapping.profile.width, mapping.profile.height), caller)
        async with semaphore:
            return await map_reference(browser, mapping, decider)

    return await asyncio.gather(*(one(mapping) for mapping in mappings), return_exceptions=True)
