"""Teclas al estilo xdotool ("ctrl+a", "Return") traducidas al formato de Playwright."""

import re

_KEY_NAMES = {
    "return": "Enter", "enter": "Enter", "kp_enter": "Enter",
    "tab": "Tab", "escape": "Escape", "esc": "Escape",
    "backspace": "Backspace", "back_space": "Backspace",
    "delete": "Delete", "del": "Delete", "insert": "Insert",
    "space": "Space",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "arrowup": "ArrowUp", "arrowdown": "ArrowDown", "arrowleft": "ArrowLeft", "arrowright": "ArrowRight",
    "page_up": "PageUp", "pageup": "PageUp", "prior": "PageUp",
    "page_down": "PageDown", "pagedown": "PageDown", "next": "PageDown",
    "home": "Home", "end": "End",
}
MODIFIERS = {
    "ctrl": "Control", "control": "Control",
    "alt": "Alt", "option": "Alt",
    "shift": "Shift",
    "super": "Meta", "cmd": "Meta", "command": "Meta", "meta": "Meta", "win": "Meta",
}
BACK_KEYS = {"Alt+ArrowLeft", "Meta+[", "BrowserBack", "XF86Back"}


class InvalidKeyError(ValueError):
    """La tecla está vacía."""


def translate_key(combo: str) -> str:
    parts = [part.strip() for part in combo.split("+") if part.strip()]
    if not parts:
        raise InvalidKeyError("La tecla está vacía.")
    translated = []
    for part in parts:
        lower = part.lower()
        if lower in MODIFIERS:
            translated.append(MODIFIERS[lower])
        elif lower in _KEY_NAMES:
            translated.append(_KEY_NAMES[lower])
        elif re.fullmatch(r"f\d{1,2}", lower):
            translated.append(lower.upper())
        else:
            translated.append(part)
    return "+".join(translated)


def is_back_key(combo: str) -> bool:
    return translate_key(combo) in BACK_KEYS
