"""Ejecución de una acción sobre un elemento, solo como la haría una persona, y registro del paso."""

import asyncio
import time
from collections.abc import Callable
from datetime import datetime

from playwright.async_api import ElementHandle, Request
from playwright.async_api import Error as PlaywrightError

from shared.browser.keys import InvalidKeyError, translate_key
from shared.browser.session import BrowserSession

from guide.page_view import display_state
from guide.route import Step, Target

ELEMENT_ACTIONS = {"click", "fill", "select"}
_ACTION_TIMEOUT_MS = 5_000
_SCROLL_FRACTION = 0.8   # de la altura del viewport por scroll
_REAPPEAR_POLL_S = 0.5
_NAVIGATION_START_S = 0.4    # lo que tarda en partir la navegación que inicia una acción
_NAVIGATION_TIMEOUT_S = 30

Log = Callable[[str], None]


class ActionRejected(Exception):
    """La acción no se puede hacer; el mensaje es para el modelo."""


async def _execute(session: BrowserSession, action: str, value: str | None, handle: ElementHandle | None) -> None:
    page = session.page
    if action == "click":
        # Sin esperar la navegación que inicia: la espera `_settle`, sin el tope de la acción.
        if session.screen.mobile:
            await handle.tap(timeout=_ACTION_TIMEOUT_MS, no_wait_after=True)
        else:
            await handle.click(timeout=_ACTION_TIMEOUT_MS, no_wait_after=True)
    elif action == "fill":
        if await handle.get_attribute("type") == "password":
            raise ActionRejected("No se escribe en campos de contraseña.")
        await handle.fill(value or "", timeout=_ACTION_TIMEOUT_MS)
    elif action == "select":
        await handle.select_option(label=value or "", timeout=_ACTION_TIMEOUT_MS)
    elif action == "press":
        await page.keyboard.press(translate_key(value or ""))
    elif action == "back":
        await page.go_back(wait_until="domcontentloaded", timeout=10_000)
    elif action == "scroll":
        if value not in ("down", "up"):
            raise ActionRejected("La dirección del scroll debe ser 'down' o 'up'.")
        screen = session.screen
        await page.mouse.move(screen.width // 2, screen.height // 2)
        await page.mouse.wheel(0, (1 if value == "down" else -1) * screen.height * _SCROLL_FRACTION)
    else:
        raise ActionRejected(f"La acción '{action}' no existe.")


def _browser_error(error: PlaywrightError) -> str:
    """Un clic que agota el tiempo suele ser un elemento tapado o dentro de un menú cerrado: se le dice al modelo."""
    lines = error.message.splitlines()
    message = f"El navegador no pudo hacer la acción: {lines[0]}"
    if "Timeout" not in lines[0]:
        return message
    cause = next((line.strip(" -") for line in reversed(lines) if "intercepts pointer events" in line), None)
    if cause:
        message += f" ({cause[:200]})"
    return (message + " Puede estar tapado por otro elemento o dentro de un menú o panel cerrado: abre primero ese"
            " menú o panel, o usa otro enlace que lleve al mismo lugar.")


async def _display_state(handle: ElementHandle, reappear_s: float) -> tuple[bool, bool]:
    """Como `display_state`, esperando hasta `reappear_s` a que se vuelva a mostrar (un carrusel que rota)."""
    deadline = time.monotonic() + reappear_s
    visible, in_viewport = await display_state(handle)
    while not visible and time.monotonic() < deadline:
        await asyncio.sleep(_REAPPEAR_POLL_S)
        visible, in_viewport = await display_state(handle)
    return visible, in_viewport


async def _settle(session: BrowserSession, navigations: list[Request]) -> None:
    """Espera la respuesta de la navegación que inició la acción, si hubo, y que la página se asiente."""
    await asyncio.sleep(_NAVIGATION_START_S)
    if navigations:
        try:
            await asyncio.wait_for(navigations[-1].response(), timeout=_NAVIGATION_TIMEOUT_S)
        except (TimeoutError, PlaywrightError):
            pass
    await session.wait_until_settled()


def now() -> datetime:
    return datetime.now().astimezone()


def iso(moment: datetime | None) -> str:
    return moment.isoformat(timespec="milliseconds") if moment else ""


async def perform_step(
    session: BrowserSession, action: str, value: str | None, handle: ElementHandle | None, target: Target | None,
    reappear_s: float = 0.0, started: datetime | None = None, decided: datetime | None = None,
) -> Step:
    """Hace la acción, espera a que la página reaccione y devuelve el paso con lo observado antes y después.

    `reappear_s`: cuánto esperar a un elemento que estaba a la vista y dejó de estarlo. `started`: inicio de la
    exploración o repetición, para `seconds_since_start`; `decided`: cuándo el modelo pidió la acción.
    """
    started = started or now()
    if action in ELEMENT_ACTIONS and handle is None:
        raise ActionRejected(f"La acción '{action}' necesita un elemento que exista en la página.")
    url_before, title_before = await session.url_and_title()
    in_viewport = None
    page = session.page
    navigations: list[Request] = []

    def on_request(request: Request) -> None:
        if request.is_navigation_request() and request.frame == page.main_frame:
            navigations.append(request)

    page.on("request", on_request)
    try:
        try:
            if handle is not None:
                visible, in_viewport = await _display_state(handle, reappear_s)
                if not visible:
                    raise ActionRejected(
                        "Ese elemento no está a la vista y así no se puede usar; repetirlo da el mismo rechazo. Haz"
                        " clic primero en el menú, pestaña o botón que lo muestra («lo muestra eN» en la vista), o"
                        " usa otro elemento visible que lleve al mismo lugar.")
            executed = now()
            await _execute(session, action, value, handle)
        except InvalidKeyError as error:
            raise ActionRejected(str(error))
        except PlaywrightError as error:
            raise ActionRejected(_browser_error(error))
        await _settle(session, navigations)
    finally:
        page.remove_listener("request", on_request)
    url_after, title_after = await session.url_and_title()
    try:
        screenshot = await session.screenshot()
    except PlaywrightError:
        screenshot = b""  # la acción ya ocurrió: el paso se conserva aunque no haya captura
    settled = now()
    return Step(
        action=action,
        value=value,
        target=target,
        url_before=url_before,
        title_before=title_before,
        url_after=url_after,
        title_after=title_after,
        in_viewport=in_viewport,
        screenshot=screenshot,
        decided_at=iso(decided),
        executed_at=iso(executed),
        settled_at=iso(settled),
        seconds_since_start=round((settled - started).total_seconds(), 2),
    )
