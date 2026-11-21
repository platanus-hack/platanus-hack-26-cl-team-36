"""Motores de decisión del usuario sintético.

Un motor recibe capturas y devuelve pedidos (expectativa + acción). El ciclo del
agente ejecuta los pedidos y le devuelve los resultados con una captura nueva.

- ClaudeCodeEngine: usa el Claude Code local (`claude -p`) con la sesión de tu plan,
  sin clave de API. Sin herramientas: solo puede responder un JSON con la acción.
- ApiEngine: usa la API de Anthropic con la herramienta de computer use
  (requiere ANTHROPIC_API_KEY).
"""

import asyncio
import base64
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import config
from actions import COMPUTER_TOOLSET


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


def png_image_block(png: bytes) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(png).decode()},
    }


# ---------------------------------------------------------------------------
# Claude Code local
# ---------------------------------------------------------------------------

class ClaudeCodeError(Exception):
    pass


class ClaudeCodeProcess:
    """Sesión persistente de `claude -p` con entrada y salida en stream-json."""

    def __init__(self, process: asyncio.subprocess.Process, log_file):
        self.process = process
        self.log_file = log_file
        self.cost_usd = 0.0

    @classmethod
    async def open(cls, system_prompt: str, model: str, effort: str, schema: dict, cwd: Path, log_path: Path):
        command = [
            "claude", "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--model", model,
            "--effort", effort,
            "--tools", "",                  # sin herramientas: no puede leer archivos, ni la web, ni ejecutar nada
            "--strict-mcp-config",          # sin servidores MCP
            "--disable-slash-commands",     # sin skills
            "--setting-sources", "",        # sin hooks ni configuraciones del usuario
            "--no-session-persistence",
            "--system-prompt", system_prompt,
            "--json-schema", json.dumps(schema),
        ]
        log_file = open(log_path, "a", encoding="utf-8")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=log_file,
            cwd=cwd,
            limit=64 * 1024 * 1024,
        )
        return cls(process, log_file)

    async def send(self, text: str, image: bytes | None = None) -> None:
        content: list[dict] = [{"type": "text", "text": text}]
        if image is not None:
            content.append(png_image_block(image))
        message = {"type": "user", "message": {"role": "user", "content": content}}
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()

    async def wait_for_result(self) -> dict:
        while True:
            line = await self.process.stdout.readline()
            if not line:
                raise ClaudeCodeError(f"claude terminó inesperadamente (código {self.process.returncode})")
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "result":
                self.cost_usd = event.get("total_cost_usd") or self.cost_usd
                return event

    async def close(self) -> None:
        try:
            if self.process.stdin and not self.process.stdin.is_closing():
                self.process.stdin.close()
            await asyncio.wait_for(self.process.wait(), timeout=10)
        except (TimeoutError, ProcessLookupError, BrokenPipeError, ConnectionResetError):
            try:
                self.process.kill()
            except ProcessLookupError:
                pass
        finally:
            self.log_file.close()


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


# ---------------------------------------------------------------------------
# API de Anthropic con computer use
# ---------------------------------------------------------------------------

EXPECTATION_TOOL = {
    "name": "expectation",
    "description": (
        "Declara en una sola frase qué esperas que pase con tu próxima acción. "
        "Llámala inmediatamente antes de cada acción de computer (clic, escribir, tecla o scroll)."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {"sentence": {"type": "string", "description": "Qué esperas ver después de la acción."}},
        "required": ["sentence"],
        "additionalProperties": False,
    },
}

_FINAL_TEXT_PATTERN = re.compile(
    r"^\s*(TERMINADO|BLOQUEADO|ME RINDO)\s*:\s*(.*)$", re.IGNORECASE | re.MULTILINE | re.DOTALL
)
_FINAL_TEXT_REASONS = {"terminado": "done", "bloqueado": "blocked", "me rindo": "gave_up"}


def _with_cache_breakpoint(messages: list[dict]) -> list[dict]:
    """Una copia de los mensajes con el punto de caché en el último bloque, sin tocar el historial.

    Equivale a la caché automática (`cache_control` de nivel superior), que Bedrock no acepta por bedrock-runtime.
    Solo se marca el último mensaje: los anteriores se leen de la caché y no gastan puntos (el máximo es 4).
    """
    *earlier, last = messages
    *blocks, final = last["content"]
    return [*earlier, {**last, "content": [*blocks, {**final, "cache_control": {"type": "ephemeral"}}]}]


class ApiEngine:
    name = "api"

    def __init__(self, client, model: str, effort: str):
        self.client = client
        self.model = model
        self.effort = effort
        self.tools = [COMPUTER_TOOLSET, EXPECTATION_TOOL]
        self.messages: list[dict] = []
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}

    async def start(self, system_prompt: str, first_message: str, screenshot: bytes, log_dir: Path) -> None:
        self.system_prompt = system_prompt
        self.messages = [{"role": "user", "content": [{"type": "text", "text": first_message}, png_image_block(screenshot)]}]

    async def decide(self) -> Turn:
        import anthropic

        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=config.USER_MAX_TOKENS,
                system=self.system_prompt,
                tools=self.tools,
                messages=_with_cache_breakpoint(self.messages),
                output_config={"effort": self.effort},
            )
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as error:
            raise AttemptEnded("api_error", str(error)[:300])
        for key in self.usage:
            self.usage[key] += getattr(response.usage, key, 0) or 0
        self.messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "refusal":
            raise AttemptEnded("refusal", getattr(response.stop_details, "explanation", None) or "")
        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if not tool_uses:
            text = "\n".join(block.text for block in response.content if block.type == "text").strip()
            match = _FINAL_TEXT_PATTERN.search(text)
            if match:
                return Turn(final=(_FINAL_TEXT_REASONS[match.group(1).lower()], match.group(2).strip()))
            return Turn(final=("done", text))
        if response.stop_reason == "max_tokens":
            raise AttemptEnded("no_response", "La respuesta del modelo se cortó por max_tokens.")
        return Turn(requests=[
            ActionRequest(block.id, block.name, block.input or {}, getattr(block, "toolset_name", None) == "computer")
            for block in tool_uses
        ])

    async def respond(self, results: list[ActionResult], screenshot: bytes) -> None:
        blocks = []
        for result in results:
            block: dict = {"type": "tool_result", "tool_use_id": result.request.id}
            if result.request.is_computer:
                block["toolset_name"] = "computer"
            block["content"] = [png_image_block(result.image)] if result.image else result.text
            if result.is_error:
                block["is_error"] = True
            blocks.append(block)
        # La captura más reciente va adjunta al último resultado del turno.
        last_block = blocks[-1]
        if not isinstance(last_block["content"], list):
            last_block["content"] = [{"type": "text", "text": last_block["content"]}, png_image_block(screenshot)]
        self.messages.append({"role": "user", "content": blocks})

    async def close(self) -> None:
        pass
