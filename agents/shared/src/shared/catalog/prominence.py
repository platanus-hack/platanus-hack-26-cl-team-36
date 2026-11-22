"""Prominencia de un objetivo en la página inicial y complejidad de su ruta de referencia."""

from shared.catalog.goal import Goal
from shared.catalog.outline import Link, SiteOutline

_SCREENS_FOR_SECONDARY = 3   # NN/g: el 81 % del tiempo de lectura ocurre en las tres primeras pantallas


def link_prominence(link: Link, viewport_height: int) -> str:
    """`primary`: en la primera pantalla. `secondary`: en un menú del encabezado o a tres pantallas o menos. Si no, `buried`."""
    if link.visible and link.top < viewport_height:
        return "primary"
    if (not link.visible and link.zone == "nav") or (link.visible and link.top < _SCREENS_FOR_SECONDARY * viewport_height):
        return "secondary"
    return "buried"


def prominence(goal: Goal, outline: SiteOutline, viewport_height: int) -> str:
    """Por la aparición más destacada de su entrada en la página inicial; sin entrada, `buried`."""
    found = [link_prominence(link, viewport_height) for link in outline.pages[0].links if link.href == goal.entry]
    for level in ("primary", "secondary"):
        if level in found:
            return level
    return "buried"


def route_prominence(steps: list[dict], outline: SiteOutline, viewport_height: int) -> str | None:
    """Por el primer elemento de la ruta en la página inicial (pasos de route.json); None si no usa ninguno.

    `primary` si es el que sale de la página y estaba en pantalla; si no, los cortes de `link_prominence` sobre el
    enlace que sale, sin pasar de `secondary`.
    """
    used: list[dict] = []
    for step in steps:
        if step["target"]:
            used.append(step)
        if step["changes_node"]:
            break
    if not used:
        return None
    if len(used) == 1 and used[0]["in_viewport"]:
        return "primary"
    href = used[-1]["target"]["href"]
    found = {link_prominence(link, viewport_height) for link in outline.pages[0].links if href and link.href == href}
    return "secondary" if found & {"primary", "secondary"} else "buried"


def complexity(actions: int | None) -> str | None:
    """Bandas de Online-Mind2Web sobre las acciones de la ruta de referencia, sin scrolls: ≤5, 6–10, ≥11."""
    if actions is None:
        return None
    return "easy" if actions <= 5 else ("medium" if actions <= 10 else "hard")
