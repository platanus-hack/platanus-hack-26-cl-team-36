"""Ejecución de una acción sobre un elemento, solo como la haría una persona, y registro del paso."""

from playwright.async_api import ElementHandle
from playwright.async_api import Error as PlaywrightError

from actions import InvalidActionError, translate_key
from browser import BrowserSession
from mapper.page_view import is_displayable, is_in_viewport
from mapper.route import Step, Target

ELEMENT_ACTIONS = {"click", "fill", "select"}
_ACTION_TIMEOUT_MS = 5_000


class ActionRejected(Exception):
    """La acción no se puede hacer; el mensaje es para el modelo."""


async def _execute(session: BrowserSession, action: str, value: str | None, handle: ElementHandle | None) -> None:
    page = session.page
    if action == "click":
        if session.profile.mobile:
            await handle.tap(timeout=_ACTION_TIMEOUT_MS)
        else:
            await handle.click(timeout=_ACTION_TIMEOUT_MS)
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
    else:
        raise ActionRejected(f"La acción '{action}' no existe.")


async def perform_step(
    session: BrowserSession, action: str, value: str | None, handle: ElementHandle | None, target: Target | None
) -> Step:
    """Hace la acción, espera a que la página reaccione y devuelve el paso con lo observado antes y después."""
    if action in ELEMENT_ACTIONS and handle is None:
        raise ActionRejected(f"La acción '{action}' necesita un elemento que exista en la página.")
    url_before, title_before = await session.url_and_title()
    in_viewport = None
    try:
        if handle is not None:
            if not await is_displayable(handle):
                raise ActionRejected("Ese elemento no está a la vista: primero abre el menú o control que lo muestra.")
            in_viewport = await is_in_viewport(handle)
        await _execute(session, action, value, handle)
    except InvalidActionError as error:
        raise ActionRejected(str(error))
    except PlaywrightError as error:
        raise ActionRejected(f"El navegador no pudo hacer la acción: {error.message.splitlines()[0]}")
    await session.wait_until_settled()
    url_after, title_after = await session.url_and_title()
    return Step(
        action=action,
        value=value,
        target=target,
        url_before=url_before,
        title_before=title_before,
        url_after=url_after,
        title_after=title_after,
        in_viewport=in_viewport,
        screenshot=await session.screenshot(),
    )
