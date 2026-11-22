"""Exploración: vista del DOM -> el modelo decide -> se ejecuta la acción, hasta una respuesta respaldada."""

import asyncio
import time
from dataclasses import dataclass, field

from playwright.async_api import Error as PlaywrightError

from shared.browser.session import BrowserSession
from shared.nodes.urls import node_key
from shared.claude.caller import ClaudeCallError

from guide import config
from guide.decider import Decider, Decision
from guide.locators import record_locators
from guide.operate import ELEMENT_ACTIONS, ActionRejected, Log, perform_step
from guide.page_view import PageView, element_for_ref, read_page_view
from guide.prompts import HistoryEntry, render_turn
from guide.quote import quote_in_text
from guide.route import Step, Target

_FINAL_REASONS = {"blocked": "blocked", "give_up": "gave_up"}
_STEP_LIMIT_OUTCOME = "rechazada: se alcanzó el máximo de acciones; solo puedes terminar con done, blocked o give_up"


@dataclass
class Exploration:
    start_url: str = ""
    start_title: str = ""
    start_screenshot: bytes = field(default=b"", repr=False)
    steps: list[Step] = field(default_factory=list)
    history: list[HistoryEntry] = field(default_factory=list)
    # done | blocked | gave_up | step_limit | time_limit | turn_limit | model_error | browser_error
    end_reason: str = ""
    message: str = ""
    answer: str = ""
    quote: str = ""
    final_node: str = ""    # nodo de la página donde se dio la respuesta
    turns: int = 0
    duration_s: float = 0.0
    step_limit_warned: bool = False


def _describe(decision: Decision, view: PageView) -> str:
    element = view.element(decision.ref or "")
    parts = [decision.action, decision.ref]
    if element and element.name:
        parts.append(f"«{element.name}»")
    if decision.text and decision.action != "click":
        parts.append(f"«{decision.text}»")
    return " ".join(part for part in parts if part)


async def _act(session: BrowserSession, decision: Decision, view: PageView) -> Step:
    element = view.element(decision.ref) if decision.action in ELEMENT_ACTIONS and decision.ref else None
    handle = await element_for_ref(session.page, decision.ref) if element else None
    target = None
    if handle is not None:
        locators = await record_locators(session.page, handle, element)
        target = Target(element.tag, element.role, element.name, element.text, element.href, locators)
    reappear_s = config.REAPPEAR_S if element and element.visible else 0.0
    return await perform_step(session, decision.action, decision.text, handle, target, reappear_s)


def _exhausted_limit(exploration: Exploration, remaining_s: float) -> str | None:
    if exploration.turns >= config.MAX_TURNS:
        return "turn_limit"
    return "time_limit" if remaining_s <= 0 else None


async def _apply(session: BrowserSession, decision: Decision, view: PageView, exploration: Exploration) -> str | None:
    """Aplica una decisión. Devuelve el resultado para el historial, o None si la exploración terminó."""
    if decision.action in _FINAL_REASONS:
        exploration.end_reason, exploration.message = _FINAL_REASONS[decision.action], decision.text or ""
        return None
    if decision.action == "done":
        if not quote_in_text(decision.quote or "", view.text):
            return "rechazada: la cita no está en el texto visible de la página"
        exploration.end_reason, exploration.answer, exploration.quote = "done", decision.answer or "", decision.quote
        exploration.final_node = node_key(view.url, view.title)
        return None
    if len(exploration.steps) >= config.MAX_STEPS:
        # Con el límite alcanzado, solo una acción final; si ya se le avisó y vuelve a pedir otra, termina.
        if exploration.step_limit_warned:
            exploration.end_reason = "step_limit"
            return None
        exploration.step_limit_warned = True
        return _STEP_LIMIT_OUTCOME
    element = view.element(decision.ref or "")
    if decision.action == "click" and element and element.leaves_site(exploration.start_url):
        return "rechazada: ese enlace lleva a otro sitio; usa solo lo que ofrece este"
    try:
        step = await _act(session, decision, view)
    except ActionRejected as error:
        return f"error: {error}"
    except PlaywrightError as error:
        return f"error: {error.message.splitlines()[0]}"
    exploration.steps.append(step)
    return f"llegó a «{step.title_after}» {step.url_after}"


async def _read_view(session: BrowserSession) -> PageView:
    """Si la página todavía estaba navegando, espera a que se asiente y vuelve a leerla una vez."""
    try:
        return await read_page_view(session.page)
    except PlaywrightError:
        await session.wait_until_settled()
        return await read_page_view(session.page)


async def _turn(session: BrowserSession, decider: Decider, instruction: str, exploration: Exploration,
                remaining_s: float, log: Log) -> None:
    view = await _read_view(session)
    exploration.turns += 1
    prompt = render_turn(instruction, exploration.history, view)
    try:
        decision = await asyncio.wait_for(decider.decide(prompt, await session.screenshot()), timeout=remaining_s)
    except TimeoutError:
        exploration.end_reason = "time_limit"
        return
    except ClaudeCallError as error:
        exploration.end_reason, exploration.message = "model_error", str(error)
        return
    outcome = await _apply(session, decision, view, exploration)
    if outcome is not None:
        exploration.history.append(HistoryEntry(decision.reason or "", _describe(decision, view), outcome))
        log(f"turno {exploration.turns}: {_describe(decision, view)} -> {outcome}")


async def explore(session: BrowserSession, url: str, decider: Decider, instruction: str, log: Log = print) -> Exploration:
    """Abre `url` y explora hasta que el modelo termina, se agota un límite o falla el navegador."""
    exploration = Exploration()
    started = time.monotonic()
    try:
        await session.open(url)
        exploration.start_url, exploration.start_title = await session.url_and_title()
        exploration.start_screenshot = await session.screenshot()
        while not exploration.end_reason:
            remaining_s = config.MAX_SECONDS - (time.monotonic() - started)
            exploration.end_reason = _exhausted_limit(exploration, remaining_s) or ""
            if not exploration.end_reason:
                await _turn(session, decider, instruction, exploration, remaining_s, log)
    except PlaywrightError as error:
        exploration.end_reason, exploration.message = "browser_error", error.message.splitlines()[0]
    exploration.duration_s = round(time.monotonic() - started, 1)
    log(f"fin de la exploración: {exploration.end_reason} — {exploration.answer or exploration.message}")
    return exploration
