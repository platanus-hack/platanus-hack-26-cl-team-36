"""Motor guionizado (`--engine fake`, o AGENTS_ENGINE=fake): un usuario determinista, sin Claude, para probar la etapa
de punta a punta.

Repite los pasos de la ruta de la Guía con las mismas acciones que un usuario de verdad (clic en coordenadas, escribir,
teclas, scroll), ubicando cada elemento en la página con los localizadores que la Guía registró, y al final declara que
terminó. Sin ruta, declara que terminó en la página inicial. Si no encuentra un elemento, se rinde.
"""

import json

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Locator, Page

from visitor.turns import ActionRequest, Turn

NAME = "fake"


def _locators(step: dict) -> list[dict]:
    """Los localizadores de la Guía y, si no trae, el href o el texto del elemento."""
    target = step.get("target") or {}
    fallback = [{"by": "href", "value": target["href"], "nth": 0}] if target.get("href") else []
    fallback += [{"by": "text", "value": target["text"], "nth": 0}] if target.get("text") else []
    return list(step.get("locators") or []) + fallback


def _locator(page: Page, candidate: dict) -> Locator:
    if candidate["by"] == "role":
        return page.get_by_role(candidate["role"], name=candidate["value"], exact=True)
    if candidate["by"] == "text":
        return page.get_by_text(candidate["value"], exact=True)
    if candidate["by"] == "href":
        return page.locator(f"a[href={json.dumps(candidate['value'])}]")
    return page.locator(candidate["value"])


class RouteEngine:
    name = NAME
    model = NAME

    def __init__(self, route: dict | None):
        self.steps = list((route or {}).get("steps") or [])
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self.session = None
        self._ids = 0

    def attach(self, session) -> None:
        """La sesión del navegador del intento: solo para ubicar elementos, como los ve el usuario en la captura."""
        self.session = session

    async def start(self, system_prompt: str, first_message: str, screenshot: bytes, log_dir) -> None:
        pass

    async def respond(self, results, screenshot: bytes) -> None:
        pass

    async def close(self) -> None:
        pass

    async def decide(self) -> Turn:
        if not self.steps:
            return Turn(final=("done", "Seguí la ruta de la Guía hasta su última página."))
        step = self.steps.pop(0)
        actions = await self._actions(step)
        if actions is None:
            return Turn(final=("gave_up", f"No encontré «{step.get('label') or step.get('action')}» en la pantalla."))
        expectation = ("expectation", {"sentence": f"Paso {step.get('number')} de la ruta: {step.get('label')}."}, False)
        return Turn(requests=[self._request(*item) for item in (expectation, *actions)])

    def _request(self, name: str, action_input: dict, is_computer: bool = True) -> ActionRequest:
        self._ids += 1
        return ActionRequest(f"f{self._ids}", name, action_input, is_computer)

    async def _actions(self, step: dict) -> list[tuple[str, dict]] | None:
        action, value = step.get("action"), step.get("value")
        if action == "press":
            return [("key", {"text": value or "Enter"})]
        if action == "back":
            return [("key", {"text": "alt+Left"})]
        if action == "scroll":
            return [("scroll", {"scroll_direction": value if value in ("up", "down") else "down", "scroll_amount": 5})]
        if action not in ("click", "fill"):
            return None  # `select` y otras: el usuario guionizado no las sabe hacer
        point = await self._point(step)
        if point is None:
            return None
        click = ("left_click", {"coordinate": list(point)})
        return [click] if action == "click" else [click, ("type", {"text": value or ""})]

    async def _point(self, step: dict) -> tuple[int, int] | None:
        """El centro del elemento en la pantalla; lo trae a la vista si hace falta."""
        page = self.session.page
        for candidate in _locators(step):
            try:
                locator = _locator(page, candidate)
                if await locator.count() <= candidate.get("nth", 0):
                    continue
                element = locator.nth(candidate.get("nth", 0))
                await element.scroll_into_view_if_needed(timeout=2_000)
                box = await element.bounding_box()
            except PlaywrightError:
                continue
            if box:
                return int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] / 2)
        return None
