"""Exploración: vista del DOM -> el modelo decide -> se ejecuta la acción, hasta una respuesta respaldada."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

from playwright.async_api import Error as PlaywrightError

from shared.browser.session import BrowserSession
from shared.nodes.urls import node_key
from shared.claude.caller import ClaudeCallError

from guide import config
from guide.decider import Decider, Decision
from guide.locators import record_locators
from guide.operate import ELEMENT_ACTIONS, ActionRejected, Log, now, perform_step
from guide.page_view import PageView, element_for_ref, read_page_view
from guide.prompts import HistoryEntry, render_turn
from guide.quote import quote_in_text
from guide.route import Step, Target

_FINAL_REASONS = {"blocked": "blocked", "give_up": "gave_up"}
_STEP_LIMIT_OUTCOME = "rechazada: se alcanzó el máximo de acciones; solo puedes terminar con done, blocked o give_up"
_QUOTE_REJECTED = ("rechazada: la cita no está en el texto visible de la página o es una sola palabra. Copia tal cual"
                   " una frase corta (una línea) de la sección TEXTO DE LA PÁGINA, no del título de la pestaña, la URL"
                   " ni la captura; si la respuesta no está en ese texto, ve a la página que la muestra")
_LEAVES_SITE = ("rechazada: ese enlace lleva a otro sitio y ningún enlace hacia allá se puede seguir. Usa otro enlace"
                " de este sitio o, si la tarea continúa allá, termina con done citando el texto de ese enlace")


@dataclass
class Exploration:
    start_url: str = ""
    site_urls: tuple[str, ...] = ()  # la URL pedida y la de llegada: un enlace del sitio de cualquiera es del sitio
    start_title: str = ""
    start_screenshot: bytes = field(default=b"", repr=False)
    steps: list[Step] = field(default_factory=list)
    history: list[HistoryEntry] = field(default_factory=list)
    # done | blocked | gave_up | step_limit | time_limit | turn_limit | repeated_rejection | model_error | browser_error
    end_reason: str = ""
    message: str = ""
    answer: str = ""
    quote: str = ""
    final_node: str = ""    # nodo de la página donde se dio la respuesta
    turns: int = 0
    duration_s: float = 0.0
    step_limit_warned: bool = False
    started: datetime | None = None   # abierta la página inicial: origen de `seconds_since_start` de cada paso
    last_rejection: tuple[str, str] | None = None   # acción y rechazo del turno anterior
    repeated_rejections: int = 0


Progress = Callable[[Exploration], Awaitable[None]]
"""Se llama al abrir la página inicial y tras cada paso ejecutado."""


async def no_progress(exploration: Exploration) -> None:
    pass


def _describe(decision: Decision, view: PageView) -> str:
    element = view.element(decision.ref or "")
    parts = [decision.action, decision.ref]
    if element and element.name:
        parts.append(f"«{element.name}»")
    if decision.text and decision.action != "click":
        parts.append(f"«{decision.text}»")
    if decision.action == "done" and decision.quote:
        parts.append(f"cita «{decision.quote[:150]}»")
    return " ".join(part for part in parts if part)


async def _act(session: BrowserSession, decision: Decision, view: PageView, started: datetime | None = None,
               decided: datetime | None = None) -> Step:
    element = view.element(decision.ref) if decision.action in ELEMENT_ACTIONS and decision.ref else None
    handle = await element_for_ref(session.page, decision.ref) if element else None
    target = None
    if handle is not None:
        locators = await record_locators(session.page, handle, element)
        target = Target(element.tag, element.role, element.name, element.text, element.href, locators)
    reappear_s = config.REAPPEAR_S if element and element.visible else 0.0
    return await perform_step(session, decision.action, decision.text, handle, target, reappear_s, started, decided)


def _exhausted_limit(exploration: Exploration, remaining_s: float) -> str | None:
    if exploration.turns >= config.MAX_TURNS:
        return "turn_limit"
    return "time_limit" if remaining_s <= 0 else None


async def _apply(session: BrowserSession, decision: Decision, view: PageView, exploration: Exploration,
                 progress: Progress, decided: datetime) -> str | None:
    """Aplica una decisión. Devuelve el resultado para el historial, o None si la exploración terminó."""
    if decision.action in _FINAL_REASONS:
        exploration.end_reason, exploration.message = _FINAL_REASONS[decision.action], decision.text or ""
        return None
    if decision.action == "done":
        if not quote_in_text(decision.quote or "", view.text):
            return _QUOTE_REJECTED
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
    if decision.action == "click" and element and element.leaves_site(exploration.site_urls):
        return _LEAVES_SITE
    try:
        step = await _act(session, decision, view, exploration.started, decided)
    except ActionRejected as error:
        return f"error: {error}"
    except PlaywrightError as error:
        return f"error: {error.message.splitlines()[0]}"
    exploration.steps.append(step)
    await progress(exploration)
    return f"llegó a «{step.title_after}» {step.url_after}"


def _count_rejection(exploration: Exploration, action: str, outcome: str) -> str:
    """Corta la exploración tras config.MAX_REPEATED_REJECTIONS rechazos iguales seguidos: el modelo no se corrige solo."""
    if outcome.startswith("llegó"):
        exploration.last_rejection, exploration.repeated_rejections = None, 0
        return outcome
    rejection = (action, outcome)
    same = rejection == exploration.last_rejection
    exploration.last_rejection = rejection
    exploration.repeated_rejections = exploration.repeated_rejections + 1 if same else 1
    count = exploration.repeated_rejections
    if count >= config.MAX_REPEATED_REJECTIONS:
        exploration.end_reason, exploration.message = "repeated_rejection", f"{count} veces seguidas: {outcome}"
    elif count > 1:
        outcome += (f" (rechazo igual n.º {count} seguido; al {config.MAX_REPEATED_REJECTIONS}.º la exploración"
                    " termina: haz otra cosa)")
    return outcome


async def _read_view(session: BrowserSession) -> PageView:
    """Si la página todavía estaba navegando, espera a que se asiente y vuelve a leerla una vez."""
    try:
        return await read_page_view(session.page)
    except PlaywrightError:
        await session.wait_until_settled()
        return await read_page_view(session.page)


async def _turn(session: BrowserSession, decider: Decider, instruction: str, exploration: Exploration,
                remaining_s: float, log: Log, progress: Progress) -> None:
    view = await _read_view(session)
    exploration.turns += 1
    prompt = render_turn(instruction, exploration.history, view, exploration.site_urls)
    try:
        decision = await asyncio.wait_for(decider.decide(prompt, await session.screenshot()), timeout=remaining_s)
    except TimeoutError:
        exploration.end_reason = "time_limit"
        return
    except ClaudeCallError as error:
        exploration.end_reason, exploration.message = "model_error", str(error)
        return
    outcome = await _apply(session, decision, view, exploration, progress, now())
    if outcome is not None:
        outcome = _count_rejection(exploration, decision.action, outcome)
        exploration.history.append(HistoryEntry(decision.reason or "", _describe(decision, view), outcome))
        log(f"turno {exploration.turns}: {_describe(decision, view)} -> {outcome}")


async def explore(session: BrowserSession, url: str, decider: Decider, instruction: str, log: Log = print,
                  progress: Progress = no_progress) -> Exploration:
    """Abre `url` y explora hasta que el modelo termina, se agota un límite o falla el navegador."""
    exploration = Exploration()
    started = time.monotonic()
    try:
        await session.open(url)
        exploration.start_url, exploration.start_title = await session.url_and_title()
        exploration.site_urls = (url, exploration.start_url)
        exploration.start_screenshot = await session.screenshot()
        exploration.started = now()
        await progress(exploration)
        while not exploration.end_reason:
            remaining_s = config.MAX_SECONDS - (time.monotonic() - started)
            exploration.end_reason = _exhausted_limit(exploration, remaining_s) or ""
            if not exploration.end_reason:
                await _turn(session, decider, instruction, exploration, remaining_s, log, progress)
    except PlaywrightError as error:
        exploration.end_reason, exploration.message = "browser_error", error.message.splitlines()[0]
    exploration.duration_s = round(time.monotonic() - started, 1)
    log(f"fin de la exploración: {exploration.end_reason} — {exploration.answer or exploration.message}")
    return exploration
