"""Localizadores estables de un elemento: se registran al explorar y se resuelven al repetir la ruta.

Orden de preferencia: rol + nombre accesible, texto, href y, al final, una ruta CSS.
Solo se guardan los que, al registrarse, apuntan al mismo elemento que se usó.
"""

import json

from playwright.async_api import ElementHandle, Locator, Page

from mapper.page_view import Element

_MAX_MATCHES = 20

_CSS_PATH_JS = r"""
(el) => {
  if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
  const parts = [];
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = [...node.parentElement.children].filter((s) => s.tagName === node.tagName);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
  }
  return 'body > ' + parts.join(' > ');
}
"""


def _locator(page: Page, candidate: dict) -> Locator:
    if candidate["by"] == "role":
        return page.get_by_role(candidate["role"], name=candidate["value"], exact=True)
    if candidate["by"] == "text":
        return page.get_by_text(candidate["value"], exact=True)
    if candidate["by"] == "href":
        return page.locator(f"a[href={json.dumps(candidate['value'])}]")
    return page.locator(candidate["value"])


async def _position_of(locator: Locator, handle: ElementHandle) -> int | None:
    """Posición del elemento entre las coincidencias del localizador (o de un descendiente suyo)."""
    for index in range(min(await locator.count(), _MAX_MATCHES)):
        if await locator.nth(index).evaluate("(el, target) => target === el || target.contains(el)", handle):
            return index
    return None


async def record_locators(page: Page, handle: ElementHandle, element: Element) -> list[dict]:
    candidates: list[dict] = []
    if element.role and element.name:
        candidates.append({"by": "role", "role": element.role, "value": element.name})
    if element.text:
        candidates.append({"by": "text", "value": element.text})
    raw_href = await handle.get_attribute("href")
    if raw_href:
        candidates.append({"by": "href", "value": raw_href})
    candidates.append({"by": "css", "value": await handle.evaluate(_CSS_PATH_JS)})

    recorded = []
    for candidate in candidates:
        position = await _position_of(_locator(page, candidate), handle)
        if position is not None:
            recorded.append({**candidate, "nth": position})
    return recorded


async def resolve_locators(page: Page, locators: list[dict]) -> ElementHandle | None:
    """El elemento del primer localizador que todavía tiene la coincidencia registrada."""
    for candidate in locators:
        locator = _locator(page, candidate)
        if await locator.count() > candidate["nth"]:
            return await locator.nth(candidate["nth"]).element_handle()
    return None
