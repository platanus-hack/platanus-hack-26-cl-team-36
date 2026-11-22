"""Motor del Claude Code local (`claude -p`) con la sesión de tu plan, sin clave de API.

Sin herramientas: solo puede responder un JSON con la acción.
"""

from pathlib import Path

from shared.claude.process import ClaudeCodeError, ClaudeCodeProcess

from visitor.turns import ActionRequest, ActionResult, AttemptEnded, Turn


def _structured_output(event: dict) -> dict:
    """Saca la salida estructurada de un evento `result`, o termina el intento si no la hay."""
    if event.get("is_error") or event.get("subtype") != "success":
        detail = event.get("result") or event.get("subtype") or "error desconocido"
        raise AttemptEnded("api_error", f"Claude Code: {str(detail)[:300]}")
    output = event.get("structured_output")
    if not isinstance(output, dict):
        raise AttemptEnded("no_response", "Claude Code no devolvió una respuesta estructurada.")
    return output


DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "expectation": {"type": "string", "description": "Una frase: qué esperas que pase con esta acción."},
        "action": {
            "type": "string",
            "enum": ["click", "double_click", "type", "key", "scroll", "volver_a_nodo", "done", "blocked", "give_up"],
        },
        "nodo": {"type": "string", "description": "Con volver_a_nodo: el id de una página ya vista (p1, p2...)."},
        "x": {"type": "integer", "description": "Coordenada horizontal en píxeles de la captura."},
        "y": {"type": "integer", "description": "Coordenada vertical en píxeles de la captura."},
        "text": {"type": "string", "description": "Texto a escribir, tecla a presionar o mensaje final."},
        "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
        "amount": {"type": "integer", "description": "Cantidad de pasos de la rueda del mouse (1 a 10)."},
    },
    "required": ["expectation", "action"],
    "additionalProperties": False,
}

# Acción final del modelo -> motivo de fin del intento.
_FINAL_ACTIONS = {"done": "done", "blocked": "blocked", "give_up": "gave_up"}


def decision_to_turn(decision: dict, turn_number: int) -> Turn:
    """Convierte la decisión JSON del modelo en pedidos equivalentes a los del toolset."""
    action = decision.get("action", "")
    expectation = (decision.get("expectation") or "").strip()
    text = decision.get("text")
    if action in _FINAL_ACTIONS:
        return Turn(final=(_FINAL_ACTIONS[action], (text or expectation).strip()))

    coordinate = [decision["x"], decision["y"]] if "x" in decision and "y" in decision else None
    if action in ("click", "double_click"):
        name = "left_click" if action == "click" else "double_click"
        action_input = {"coordinate": coordinate} if coordinate else {}
    elif action == "type":
        name, action_input = "type", {"text": text or ""}
    elif action == "key":
        name, action_input = "key", {"text": text or ""}
    elif action == "volver_a_nodo":
        name, action_input = "volver_a_nodo", {"nodo": (decision.get("nodo") or text or "").strip()}
    elif action == "scroll":
        name = "scroll"
        action_input = {
            "scroll_direction": decision.get("direction") or "down",
            "scroll_amount": decision.get("amount") or 3,
        }
        if coordinate:
            action_input["coordinate"] = coordinate
    else:
        name, action_input = action or "unknown", {}
    requests = []
    if expectation:
        requests.append(ActionRequest(f"e{turn_number}", "expectation", {"sentence": expectation}, False))
    requests.append(ActionRequest(f"a{turn_number}", name, action_input, True))
    return Turn(requests=requests)


class ClaudeCodeEngine:
    name = "claude-code"

    def __init__(self, model: str, effort: str, cwd: Path):
        self.model = model
        self.effort = effort
        self.cwd = cwd
        self.process: ClaudeCodeProcess | None = None
        self.turns = 0
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
                      "cache_creation_input_tokens": 0, "equivalent_cost_usd": 0.0}

    async def start(self, system_prompt: str, first_message: str, screenshot: bytes, log_dir: Path) -> None:
        self.process = await ClaudeCodeProcess.open(
            system_prompt, self.model, self.effort, DECISION_SCHEMA, self.cwd, log_dir / "claude_code.log"
        )
        await self.process.send(first_message, screenshot)

    async def decide(self) -> Turn:
        try:
            event = await self.process.wait_for_result()
        except ClaudeCodeError as error:
            raise AttemptEnded("api_error", str(error))
        usage = event.get("usage") or {}
        for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
            self.usage[key] += usage.get(key) or 0
        self.usage["equivalent_cost_usd"] = round(self.process.cost_usd, 4)
        self.turns += 1
        return decision_to_turn(_structured_output(event), self.turns)

    async def respond(self, results: list[ActionResult], screenshot: bytes) -> None:
        parts = []
        for result in results:
            if result.request.name == "expectation" and not result.is_error:
                continue
            if result.is_error:
                parts.append(f"Error: {result.text}")
            else:  # "OK", o "OK. Te quedan N acciones..." si el perfil recibe su presupuesto (ver harness.py)
                parts.append("Acción ejecutada." + result.text.removeprefix("OK"))
        text = " ".join(parts) + "\nEsta es la pantalla ahora. ¿Cuál es tu siguiente acción?"
        await self.process.send(text.strip(), screenshot)

    async def close(self) -> None:
        if self.process:
            await self.process.close()


async def claude_code_json(
    system_prompt: str, text: str, image: bytes, schema: dict, model: str, effort: str, cwd: Path
) -> dict:
    """Llamada única a Claude Code con salida JSON validada contra `schema`."""
    process = await ClaudeCodeProcess.open(system_prompt, model, effort, schema, cwd, cwd / "claude_code_judge.log")
    try:
        await process.send(text, image)
        event = await process.wait_for_result()
    finally:
        await process.close()
    return _structured_output(event)
