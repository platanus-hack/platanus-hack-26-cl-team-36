"""Viewports en los que corren los agentes, con las claves de `shared.store.keys.Viewport`."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Screen:
    viewport: str
    width: int
    height: int
    mobile: bool


SCREENS: dict[str, Screen] = {
    "desktop": Screen("desktop", 1024, 768, False),
    "mobile": Screen("mobile", 390, 844, True),
}
