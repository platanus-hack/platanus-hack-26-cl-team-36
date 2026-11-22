"""Pasos de una ruta, destilación de la exploración y totales comparables con el Visitante."""

from dataclasses import dataclass, field

from shared.nodes.urls import node_key

# Acciones de UI del Visitante por acción (escribir o elegir = clic + tecleo).
UI_ACTIONS_PER_ACTION = {"click": 1, "fill": 2, "select": 2, "press": 1, "back": 1, "scroll": 1}


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
    action: str              # click | fill | select | press | back | scroll
    value: str | None        # texto escrito, opción elegida, tecla o dirección del scroll
    target: Target | None
    url_before: str
    title_before: str
    url_after: str
    title_after: str
    in_viewport: bool | None  # si el elemento estaba en pantalla al actuar; None sin elemento
    screenshot: bytes = field(default=b"", repr=False)
    # Como en los pasos del Visitante: hora ISO con zona y segundos desde el inicio de la exploración o repetición.
    decided_at: str = ""     # el modelo pidió la acción; vacío al repetir una ruta
    executed_at: str = ""
    settled_at: str = ""
    seconds_since_start: float = 0.0  # hasta settled_at

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


def distill(steps: list[Step], keep_steps_before_leaving: bool = False) -> list[Step]:
    """Corta cada vuelta que regresa a un nodo ya visitado; conserva las acciones dentro de una página.

    Al volver a un nodo, la ruta se recorta hasta donde se llegó a él: volver por un enlace recarga la página y lo
    hecho allí se repite. Con `keep_steps_before_leaving` se recorta hasta donde se salió, para cuando volver atrás
    conserva el estado de la página.
    """
    route: list[Step] = []
    marks: dict[str, int] = {steps[0].node_before: 0} if steps and not keep_steps_before_leaving else {}
    for step in steps:
        if step.changes_node and step.node_after in marks:
            cut = marks[step.node_after]
            del route[cut:]
            marks = {node: length for node, length in marks.items()
                     if length < cut or (node == step.node_after and not keep_steps_before_leaving)}
            continue
        if step.changes_node and keep_steps_before_leaving:
            marks[step.node_before] = len(route)
        route.append(step)
        if step.changes_node and not keep_steps_before_leaving:
            marks[step.node_after] = len(route)
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
