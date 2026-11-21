"""Comprobación de que la cita que respalda la respuesta está en la página y de si se ve sin scroll."""

import re
import unicodedata

from playwright.async_api import Page

_WRAPPING_QUOTES = "\"'«»“”‘’ "

# El elemento más profundo cuyo texto contiene la cita, y si su caja toca el viewport.
_QUOTE_ON_SCREEN_JS = r"""
(needle) => {
  const norm = (s) => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!document.body || !norm(document.body.innerText).includes(needle)) return false;
  let holder = document.body;
  for (let deeper = true; deeper;) {
    deeper = false;
    for (const child of holder.children) {
      if (norm(child.innerText).includes(needle)) { holder = child; deeper = true; break; }
    }
  }
  const box = holder.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}
"""


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip().casefold()


def quote_in_text(quote: str, text: str) -> bool:
    """La cita, sin comillas alrededor y sin distinguir espacios ni mayúsculas, aparece en el texto."""
    needle = _normalize(quote.strip(_WRAPPING_QUOTES))
    return bool(needle) and needle in _normalize(text)


async def quote_on_screen(page: Page, quote: str) -> bool:
    """Si la cita está dentro del viewport, como la vería quien solo mira la captura final."""
    needle = _normalize(quote.strip(_WRAPPING_QUOTES))
    return bool(needle) and await page.evaluate(_QUOTE_ON_SCREEN_JS, needle)
