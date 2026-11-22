"""Pedidos del modelo (expectativa y acción), sus resultados y el fin de un intento.

Un motor recibe capturas y devuelve pedidos; el ciclo del usuario los ejecuta y le devuelve los resultados con una
captura nueva.
"""

from dataclasses import dataclass, field


class AttemptEnded(Exception):
    """Termina el intento con un motivo (done, gave_up, step_limit, api_error...) y un mensaje."""

    def __init__(self, reason: str, message: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.message = message


@dataclass
class ActionRequest:
    """Un pedido del modelo. Los campos siguen a los bloques tool_use de la API."""

    id: str
    name: str            # "expectation" o un miembro del toolset (left_click, type, key, scroll...)
    input: dict
    is_computer: bool


@dataclass
class Turn:
    requests: list[ActionRequest] = field(default_factory=list)
    final: tuple[str, str] | None = None   # (motivo, mensaje)


@dataclass
class ActionResult:
    request: ActionRequest
    text: str
    is_error: bool = False
    image: bytes | None = None
