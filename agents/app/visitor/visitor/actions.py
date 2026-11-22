"""Ejecución de las acciones del toolset de computer use con mouse y teclado de Playwright.

Solo hay clic por coordenadas, teclado y scroll. Zoom y el resto de miembros que
no corresponden a una persona usando el navegador están desactivados en la
declaración del toolset; si el modelo igual los pide, se responde con error.
"""

import asyncio
from dataclasses import dataclass

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Page

from shared.browser.keys import BACK_KEYS, MODIFIERS, InvalidKeyError, translate_key
from shared.browser.session import PAGE_LOAD_TIMEOUT_MS, BrowserSession

DISABLED_MEMBERS = [
    "zoom",
    "right_click",
    "middle_click",
    "left_click_drag",
    "mouse_move",
    "left_mouse_down",
    "left_mouse_up",
    "cursor_position",
    "hold_key",
    "wait",
]

COMPUTER_TOOLSET = {
    "type": "computer_toolset_20260801",
    "configs": {member: {"enabled": False} for member in DISABLED_MEMBERS},
}

# Los modelos anteriores a Claude Opus 4.7 no aceptan el toolset: usan la herramienta `computer` de una pieza, con
# beta y el tamaño de la pantalla. La acción va en `input.action` y no se pueden desactivar miembros: si el modelo
# pide uno que no está en UI_ACTIONS, se responde con error, igual que con el toolset. Son los que la cuenta de AWS
# del proyecto puede usar en Bedrock (ver config.bedrock_model). Por modelo: (tipo de la herramienta, beta).
LEGACY_COMPUTER_TOOLS = {
    "claude-sonnet-4-6": ("computer_20251124", "computer-use-2025-11-24"),
    "claude-opus-4-6": ("computer_20251124", "computer-use-2025-11-24"),
    "claude-haiku-4-5": ("computer_20250124", "computer-use-2025-01-24"),
}


def legacy_computer(model: str) -> tuple[str, str] | None:
    """(tipo, beta) de la herramienta `computer` de `model`; None si usa el toolset."""
    return next((tool for name, tool in LEGACY_COMPUTER_TOOLS.items() if name in model), None)


def legacy_computer_tool(tool_type: str, width: int, height: int) -> dict:
    return {"type": tool_type, "name": "computer", "display_width_px": width, "display_height_px": height}


# `volver_a_nodo` no es del toolset: el harness la ofrece solo a los perfiles exploradores (ver harness.py).
VOLVER_A_NODO = "volver_a_nodo"
UI_ACTIONS = {"left_click", "double_click", "triple_click", "type", "key", "scroll", VOLVER_A_NODO}
CLICK_ACTIONS = {"left_click", "double_click", "triple_click"}

_CLICK_LABELS = {"left_click": "clic", "double_click": "doble clic", "triple_click": "triple clic"}
_SCROLL_VECTORS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


class UnavailableActionError(Exception):
    """El modelo pidió un miembro que no se implementa (zoom, arrastre, etc.)."""


class InvalidActionError(Exception):
    """Parámetros fuera de rango o incompletos."""


@dataclass
class ExecutedAction:
    kind: str
    coordinates: list[int] | None
    description: str
    went_back: bool = False


class Executor:
    def __init__(self, session: BrowserSession):
        self.session = session
        self.last_position: tuple[int, int] | None = None

    def resolve_coordinate(self, value) -> tuple[int, int]:
        if value is None:
            if self.last_position is None:
                raise InvalidActionError("Falta la coordenada.")
            return self.last_position
        try:
            x, y = int(round(value[0])), int(round(value[1]))
        except (TypeError, ValueError, IndexError):
            raise InvalidActionError(f"Coordenada inválida: {value!r}")
        width, height = self.session.screen.width, self.session.screen.height
        if not (0 <= x < width and 0 <= y < height):
            raise InvalidActionError(f"La coordenada ({x}, {y}) está fuera de la pantalla de {width}x{height}.")
        return x, y

    @staticmethod
    def _parse_modifiers(text: str | None) -> list[str]:
        if not text:
            return []
        return [MODIFIERS.get(m.strip().lower(), m.strip()) for m in text.split("+") if m.strip()]

    async def execute(self, name: str, action_input: dict) -> ExecutedAction:
        if name not in UI_ACTIONS:
            raise UnavailableActionError(f"La acción '{name}' no está disponible en este entorno.")
        page = self.session.page
        try:
            if name in CLICK_ACTIONS:
                return await self._click(page, name, action_input)
            if name == "type":
                text = action_input.get("text") or ""
                await page.keyboard.type(text, delay=15)
                return ExecutedAction("type", None, f"escribir «{text}»")
            if name == "key":
                return await self._press_key(page, action_input)
            if name == VOLVER_A_NODO:
                return await self._volver_a_nodo(page, action_input)
            return await self._scroll(page, action_input)
        except PlaywrightError as error:
            raise InvalidActionError(f"El navegador no pudo ejecutar la acción: {error.message.splitlines()[0]}")

    async def _click(self, page: Page, name: str, action_input: dict) -> ExecutedAction:
        x, y = self.resolve_coordinate(action_input.get("coordinate"))
        modifiers = self._parse_modifiers(action_input.get("text"))
        for modifier in modifiers:
            await page.keyboard.down(modifier)
        try:
            if name == "left_click":
                if self.session.screen.mobile and not modifiers:
                    await page.touchscreen.tap(x, y)
                else:
                    await page.mouse.click(x, y)
            elif name == "double_click":
                await page.mouse.dblclick(x, y)
            else:
                await page.mouse.click(x, y, click_count=3)
        finally:
            for modifier in reversed(modifiers):
                await page.keyboard.up(modifier)
        self.last_position = (x, y)
        return ExecutedAction(name, [x, y], f"{_CLICK_LABELS[name]} en ({x}, {y})")

    async def _press_key(self, page: Page, action_input: dict) -> ExecutedAction:
        combo = action_input.get("text") or ""
        try:
            key = translate_key(combo)
        except InvalidKeyError as error:
            raise InvalidActionError(str(error))
        if key in BACK_KEYS:
            await page.go_back(wait_until="domcontentloaded", timeout=10_000)
            return ExecutedAction("key", None, "atrás", went_back=True)
        repetitions = max(1, min(100, int(action_input.get("repeat") or 1)))
        for _ in range(repetitions):
            await page.keyboard.press(key)
        suffix = f" x{repetitions}" if repetitions > 1 else ""
        return ExecutedAction("key", None, f"tecla {combo}{suffix}")

    async def _volver_a_nodo(self, page: Page, action_input: dict) -> ExecutedAction:
        """Reabre una página ya vista en este intento, como elegirla en el historial del navegador."""
        url = action_input.get("url")
        if not url:
            raise InvalidActionError("Falta la página a la que volver.")
        await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT_MS)
        titulo = action_input.get("titulo") or action_input.get("nodo") or url
        return ExecutedAction(VOLVER_A_NODO, None, f"volver a «{titulo}»", went_back=True)

    async def _scroll(self, page: Page, action_input: dict) -> ExecutedAction:
        direction = action_input.get("scroll_direction")
        if direction not in _SCROLL_VECTORS:
            raise InvalidActionError(f"Dirección de scroll inválida: {direction!r}")
        amount = max(1, min(20, int(action_input.get("scroll_amount") or 3)))
        if action_input.get("coordinate") is not None:
            x, y = self.resolve_coordinate(action_input["coordinate"])
        else:
            x, y = self.last_position or (self.session.screen.width // 2, self.session.screen.height // 2)
        await page.mouse.move(x, y)
        dx, dy = _SCROLL_VECTORS[direction]
        await page.mouse.wheel(dx * amount * 100, dy * amount * 100)
        await asyncio.sleep(0.3)
        return ExecutedAction("scroll", [x, y], f"scroll {direction} x{amount}")
