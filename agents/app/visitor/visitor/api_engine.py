"""Motor de la API de Anthropic con la herramienta de computer use (ANTHROPIC_API_KEY o Bedrock)."""

import re
import struct
from pathlib import Path

from shared.claude.process import png_image_block

from visitor import config
from visitor.actions import COMPUTER_TOOLSET, LEGACY_COMPUTER_BETA, legacy_computer_tool, uses_legacy_computer_tool
from visitor.turns import ActionRequest, ActionResult, AttemptEnded, Turn

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


def png_size(png: bytes) -> tuple[int, int]:
    """Ancho y alto de un PNG, leídos de su cabecera (IHDR)."""
    width, height = struct.unpack(">II", png[16:24])
    return width, height


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
        self.legacy_computer = uses_legacy_computer_tool(model)  # herramienta `computer` en vez del toolset
        self.tools = [COMPUTER_TOOLSET, EXPECTATION_TOOL]
        self.messages: list[dict] = []
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}

    async def start(self, system_prompt: str, first_message: str, screenshot: bytes, log_dir: Path) -> None:
        self.system_prompt = system_prompt
        self.messages = [{"role": "user", "content": [{"type": "text", "text": first_message}, png_image_block(screenshot)]}]
        if self.legacy_computer:
            # Las capturas son del viewport a escala 1:1: su tamaño es el de la pantalla del perfil.
            self.tools = [legacy_computer_tool(*png_size(screenshot)), EXPECTATION_TOOL]

    async def decide(self) -> Turn:
        import anthropic

        request = {
            "model": self.model,
            "max_tokens": config.USER_MAX_TOKENS,
            "system": self.system_prompt,
            "tools": self.tools,
            "messages": _with_cache_breakpoint(self.messages),
            "output_config": {"effort": self.effort},
        }
        try:
            if self.legacy_computer:
                response = await self.client.beta.messages.create(**request, betas=[LEGACY_COMPUTER_BETA])
            else:
                response = await self.client.messages.create(**request)
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
        return Turn(requests=[self._action_request(block) for block in tool_uses])

    def _action_request(self, block) -> ActionRequest:
        if self.legacy_computer and block.name == "computer":
            action_input = dict(block.input or {})
            return ActionRequest(block.id, action_input.pop("action", ""), action_input, True)
        return ActionRequest(block.id, block.name, block.input or {}, getattr(block, "toolset_name", None) == "computer")

    async def respond(self, results: list[ActionResult], screenshot: bytes) -> None:
        blocks = []
        for result in results:
            block: dict = {"type": "tool_result", "tool_use_id": result.request.id}
            if result.request.is_computer and not self.legacy_computer:
                block["toolset_name"] = "computer"
            if result.is_error:
                # Un resultado con error solo puede llevar texto: Claude Sonnet 4.6 responde 400 si lleva una imagen.
                block["content"], block["is_error"] = result.text, True
            else:
                block["content"] = [png_image_block(result.image)] if result.image else result.text
            blocks.append(block)
        # La captura más reciente va adjunta al último resultado del turno o, si ese resultado es un error, después
        # de los resultados, como un bloque más del mismo mensaje.
        last_block = blocks[-1]
        if last_block.get("is_error"):
            blocks.append(png_image_block(screenshot))
        elif not isinstance(last_block["content"], list):
            last_block["content"] = [{"type": "text", "text": last_block["content"]}, png_image_block(screenshot)]
        self.messages.append({"role": "user", "content": blocks})

    async def close(self) -> None:
        pass
