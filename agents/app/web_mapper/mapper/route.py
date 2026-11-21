"""Pasos de una ruta, destilación de la exploración y totales comparables con el evaluador."""

from dataclasses import dataclass, field

from route_tree import node_key

# Acciones de UI del evaluador que necesita una persona que solo ve la pantalla para hacer cada acción.
UI_ACTIONS_PER_ACTION = {"click": 1, "fill": 2, "select": 2, "press": 1, "back": 1}


@dataclass
class Target:
    tag: str
    role: str | None
    name: str
    text: str
    href: str | None
    locators: list[dict]


@dataclass
class Step:
    action: str              # click | fill | select | press | back
    value: str | None        # texto escrito, opción elegida o tecla
    target: Target | None
    url_before: str
    title_before: str
    url_after: str
    title_after: str
    in_viewport: bool | None  # si el elemento estaba en pantalla al actuar; None sin elemento
    screenshot: bytes = field(default=b"", repr=False)

    @property
    def label(self) -> str:
        what = (self.target.name or self.target.text) if self.target else self.value
        return f"{self.action} «{what}»" if what else self.action

    @property
    def node_before(self) -> str:
        return node_key(self.url_before, self.title_before)

    @property
    def node_after(self) -> str:
        return node_key(self.url_after, self.title_after)

    @property
    def changes_node(self) -> bool:
        return self.node_before != self.node_after

    @property
    def scrolls_needed(self) -> int:
        """Quien solo ve la pantalla necesita al menos un scroll para llegar a un elemento fuera de ella."""
        return 1 if self.in_viewport is False else 0

    @property
    def ui_actions(self) -> int:
        return UI_ACTIONS_PER_ACTION[self.action] + self.scrolls_needed


def distill(steps: list[Step]) -> list[Step]:
    """Corta cada vuelta que regresa a un nodo ya visitado; conserva las acciones dentro de una página.

    Al volver a un nodo, la ruta se recorta hasta donde se salió de él, con lo hecho allí antes de salir.
    """
    route: list[Step] = []
    departures: dict[str, int] = {}  # nodo -> largo de la ruta al salir de él
    for step in steps:
        if step.changes_node and step.node_after in departures:
            cut = departures[step.node_after]
            del route[cut:]
            departures = {node: length for node, length in departures.items() if length < cut}
            continue
        if step.changes_node:
            departures[step.node_before] = len(route)
        route.append(step)
    return route


def route_nodes(steps: list[Step], start_node: str) -> list[str]:
    """Nodos distintos de la ruta, en orden, desde el inicial."""
    return list(dict.fromkeys([start_node, *(step.node_after for step in steps)]))


def totals(steps: list[Step], start_node: str, quote_scrolls: int) -> dict:
    """`quote_scrolls`: 1 si al final hay que desplazarse para tener la cita en pantalla."""
    return {
        "actions": len(steps),
        "estimated_scrolls": sum(step.scrolls_needed for step in steps),
        "quote_scrolls": quote_scrolls,
        "min_steps": sum(step.ui_actions for step in steps) + quote_scrolls,
        "distinct_pages": len(route_nodes(steps, start_node)),
    }
