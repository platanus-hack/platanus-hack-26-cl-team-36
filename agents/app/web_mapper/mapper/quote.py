"""Comprobación de que la cita que respalda la respuesta está en el texto de la página."""

import re
import unicodedata

_WRAPPING_QUOTES = "\"'«»“”‘’ "


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip().casefold()


def quote_in_text(quote: str, text: str) -> bool:
    """La cita, sin comillas alrededor y sin distinguir espacios ni mayúsculas, aparece en el texto."""
    needle = _normalize(quote.strip(_WRAPPING_QUOTES))
    return bool(needle) and needle in _normalize(text)
