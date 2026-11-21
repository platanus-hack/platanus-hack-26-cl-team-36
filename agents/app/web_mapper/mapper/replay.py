"""Verificación de la ruta repitiéndola en un contexto nuevo, y minimización sin llamar al modelo."""

from dataclasses import dataclass, field

from playwright.async_api import Browser
from playwright.async_api import Error as PlaywrightError

from browser import BrowserSession, create_context
from profiles import Profile
from route_tree import node_key

from mapper.explore import Log
from mapper.locators import resolve_locators
from mapper.operate import ActionRejected, perform_step
from mapper.page_view import page_text
from mapper.quote import quote_in_text, quote_on_screen
from mapper.route import Step


@dataclass
class Replay:
    start_url: str = ""
    start_title: str = ""
    start_screenshot: bytes = field(default=b"", repr=False)
    steps: list[Step] = field(default_factory=list)
    final_url: str = ""
    final_title: str = ""
    quote_found: bool = False
    quote_on_screen: bool = False
    error: str | None = None

    def verifies(self, final_node: str) -> bool:
        return self.error is None and self.quote_found and node_key(self.final_url, self.final_title) == final_node


@dataclass
class Verification:
    verified: bool
    route: list[Step]           # la ruta minimizada tal como se repitió, o la candidata si no se verificó
    replay: Replay              # la repetición de `route`
    replays: int
    removed_steps: int
    error: str | None           # por qué no verificó la candidata


async def _run_steps(session: BrowserSession, route: list[Step], replay: Replay) -> None:
    for number, step in enumerate(route, 1):
        try:
            handle = await resolve_locators(session.page, step.target.locators) if step.target else None
            replay.steps.append(await perform_step(session, step.action, step.value, handle, step.target))
        except (ActionRejected, PlaywrightError) as error:
            replay.error = f"paso {number} ({step.label}): {error}"
            return


async def replay_route(browser: Browser, profile: Profile, url: str, route: list[Step], quote: str) -> Replay:
    """Repite la ruta desde la URL inicial y comprueba si la cita está en la página final."""
    context = await create_context(browser, profile)
    replay = Replay()
    try:
        session = BrowserSession(context, profile)
        await session.open(url)
        replay.start_url, replay.start_title = await session.url_and_title()
        replay.start_screenshot = await session.screenshot()
        await _run_steps(session, route, replay)
        if replay.error is None:
            replay.final_url, replay.final_title = await session.url_and_title()
            replay.quote_found = quote_in_text(quote, await page_text(session.page))
            replay.quote_on_screen = replay.quote_found and await quote_on_screen(session.page, quote)
    except PlaywrightError as error:
        replay.error = f"el navegador falló: {error.message.splitlines()[0]}"
    finally:
        await context.close()
    return replay


def _failure(replay: Replay, final_node: str) -> str:
    if replay.error:
        return replay.error
    if node_key(replay.final_url, replay.final_title) != final_node:
        return f"terminó en otra página: «{replay.final_title}» {replay.final_url}"
    return "la cita no está en la página final"


async def verify_and_minimise(
    browser: Browser, profile: Profile, url: str, candidate: list[Step], final_node: str, quote: str, log: Log = print
) -> Verification:
    """Verifica la candidata y quita, una por una, las acciones que no cambian de página si la ruta sigue verificando."""
    best = await replay_route(browser, profile, url, candidate, quote)
    replays = 1
    if not best.verifies(final_node):
        error = _failure(best, final_node)
        log(f"la ruta candidata no verificó: {error}")
        return Verification(False, candidate, best, replays, 0, error)

    route = list(candidate)
    # De atrás hacia adelante, para que quitar un paso no corra la posición de los que faltan por probar.
    for index in reversed(range(len(candidate))):
        if route[index].changes_node or best.steps[index].changes_node:
            continue
        trial_route = route[:index] + route[index + 1:]
        trial = await replay_route(browser, profile, url, trial_route, quote)
        replays += 1
        if trial.verifies(final_node):
            log(f"se quitó el paso {index + 1}: {route[index].label}")
            route, best = trial_route, trial
    return Verification(True, best.steps, best, replays, len(candidate) - len(route), None)
