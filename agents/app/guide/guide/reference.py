"""Ruta de referencia de una tarea en un viewport: explorar, verificar, buscar una más corta y escribir."""

import asyncio
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Browser

from shared.browser.session import BrowserSession, create_context
from shared.browser.viewports import Screen
from shared.claude.engines import make_caller
from shared import store

from guide import config
from guide.candidates import Candidate, search_record, shorter_instruction
from guide.decider import ClaudeDecider, Decider, scripted_decision
from guide.explore import Exploration, Progress, explore, no_progress
from guide.operate import Log
from guide.output import route_document, write_reference
from guide.prompts import system_prompt
from guide.replay import Verification, verify_and_minimise
from guide.route import distill
from guide.trace import GuideTrace


@dataclass
class Mapping:
    """Qué mapear y de qué corridas viene."""

    goal: str
    url: str
    instruction: str
    screen: Screen
    model: str
    effort: str
    inputs: tuple[store.RunKey, ...] = ()
    extra_routes: int = config.EXTRA_ROUTES
    revision: str | None = None   # en una revisión, la corrida solo termina succeeded con la ruta verificada

    @property
    def prefix(self) -> store.RunPrefix:
        return store.guide(self.url, self.goal, self.screen.viewport)

    @property
    def label(self) -> str:
        return f"{self.goal} {self.screen.viewport}"


class RouteNotVerified(Exception):
    """La ruta de una revisión quedó sin verificar: su corrida termina `failed`, con route.json publicado."""

    def __init__(self, run: store.RunKey, document: dict):
        super().__init__(f"ruta {document['status']}")
        self.run, self.document = run, document


async def _explore(browser: Browser, mapping: Mapping, decider: Decider, instruction: str, log: Log,
                   progress: Progress) -> Exploration:
    context = await create_context(browser, mapping.screen)
    try:
        return await explore(BrowserSession(context, mapping.screen), mapping.url, decider, instruction, log, progress)
    finally:
        await context.close()


def _meta(mapping: Mapping) -> dict:
    screen = mapping.screen
    return {
        "goal": mapping.goal,
        "instruction": mapping.instruction,
        "start_url": mapping.url,
        "viewport": screen.viewport,
        "viewport_size": f"{screen.width}x{screen.height}",
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
            browser, mapping.screen, mapping.url, candidate, exploration.final_node, exploration.quote, log
        )
        if verification.verified:
            break
    return verification


async def _candidate(browser: Browser, mapping: Mapping, decider: Decider, instruction: str, log: Log,
                     progress: Progress) -> Candidate:
    cost_before = decider.cost_usd
    exploration = await _explore(browser, mapping, decider, instruction, log, progress)
    verification = await _verify(browser, mapping, exploration, log) if exploration.end_reason == "done" else None
    return Candidate(exploration, verification, decider.cost_usd - cost_before)


async def _search(browser: Browser, mapping: Mapping, decider: Decider, log: Log,
                  progress: Progress) -> tuple[list[Candidate], Candidate]:
    """La primera ruta y hasta `extra_routes` exploraciones más que piden una más corta; gana la que `beats`."""
    best = await _candidate(browser, mapping, decider, mapping.instruction, log, progress)
    candidates = [best]
    for _ in range(mapping.extra_routes):
        if best.status != "verified" or best.totals["min_steps"] == 0:
            break
        log(f"buscando una ruta de menos de {best.totals['min_steps']} pasos mínimos")
        candidate = await _candidate(browser, mapping, decider, shorter_instruction(mapping.instruction, best), log,
                                     progress)
        candidates.append(candidate)
        if candidate.beats(best):
            best = candidate
    return candidates, best


async def map_reference(browser: Browser, mapping: Mapping, decider: Decider, out_dir: Path,
                        progress: Progress = no_progress) -> dict:
    """Mapea la ruta, la escribe en `out_dir` y devuelve el documento de route.json; `progress` sigue cada exploración."""
    def log(text: str) -> None:
        print(f"[{mapping.label}] {text}", flush=True)

    candidates, best = await _search(browser, mapping, decider, log, progress)
    document = route_document(
        _meta(mapping), best.status, best.start, best.steps, best.quote_scrolls,
        {**_details(best, decider.usage, decider.cost_usd), "search": search_record(candidates, best)},
    )
    write_reference(out_dir, document, best.start[2], best.steps)
    log(f"{best.status}: {document['totals']['min_steps']} pasos mínimos")
    return document


async def map_references(
    browser: Browser, backend: store.Backend, mappings: list[Mapping], claude_cwd: Path, concurrency: int
) -> list[tuple[store.RunKey, dict] | BaseException]:
    """Una corrida de guide por ruta, a lo más `concurrency` a la vez; el error de una no detiene a las demás."""
    semaphore = asyncio.Semaphore(concurrency)

    async def one(mapping: Mapping) -> tuple[store.RunKey, dict]:
        async with semaphore:
            with store.running(backend, mapping.prefix, model=mapping.model, inputs=mapping.inputs,
                               revision=mapping.revision) as run:
                caller = make_caller(mapping.model, mapping.effort, claude_cwd, run.workdir / "claude_code.log",
                                     fake=scripted_decision)
                decider = ClaudeDecider(system_prompt(mapping.screen.width, mapping.screen.height), caller)
                trace = GuideTrace(store.LiveTrace(backend, run, "guide"))
                try:
                    document = await map_reference(browser, mapping, decider, run.workdir, trace.explored)
                except BaseException:
                    trace.finish("failed")
                    raise
                trace.route(document)
                verified = document["status"] == "verified"
                trace.finish("succeeded" if verified else "failed")
                if mapping.revision and not verified:
                    raise RouteNotVerified(run.key, document)
            return run.key, document

    return await asyncio.gather(*(one(mapping) for mapping in mappings), return_exceptions=True)
