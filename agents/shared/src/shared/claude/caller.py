"""Llamadas independientes a Claude con salida JSON, sumando tokens y costo. `ClaudeCaller` es el Claude Code local."""

import asyncio
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from shared.claude.process import DEFAULT_TIMEOUT_S, ClaudeCodeError, ClaudeCodeProcess, content_blocks

USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


class CachePoint:
    """Marca en `parts`: el prefijo hasta aquí queda en la caché de prompts del motor que la soporta."""


CACHE_POINT = CachePoint()

Part = str | bytes | CachePoint


class ClaudeCallError(Exception):
    """Claude no devolvió una salida estructurada."""


@dataclass
class Answer:
    output: dict | None
    usage: dict = field(default_factory=dict)
    cost_usd: float = 0.0
    detail: str = ""     # por qué no hay `output`


class Caller:
    """La interfaz que ven los agentes; cada motor implementa `_answer`."""

    engine = ""
    caches_prompts = False   # si no, las marcas `CACHE_POINT` se quitan antes de llamar al motor

    def __init__(self, model: str, effort: str):
        self.model = model
        self.effort = effort
        self.usage = dict.fromkeys(USAGE_KEYS, 0)
        self.cost_usd = 0.0

    async def ask(self, system_prompt: str, schema: dict, text: str, image: bytes | None = None) -> dict:
        return (await self.answer(system_prompt, schema, [text] if image is None else [text, image])).output

    async def answer(self, system_prompt: str, schema: dict, parts: list[Part]) -> Answer:
        """`parts` alterna texto e imágenes PNG; la respuesta lleva el uso de esta llamada."""
        if not self.caches_prompts:
            parts = [part for part in parts if not isinstance(part, CachePoint)]
        answer = await self._answer(system_prompt, schema, parts)
        for key in USAGE_KEYS:
            self.usage[key] += answer.usage.get(key) or 0
        self.cost_usd += answer.cost_usd
        if not isinstance(answer.output, dict):
            raise ClaudeCallError(f"{self.engine} no devolvió una respuesta estructurada: {answer.detail[:300]}")
        # Ni el JSON leído del texto ni la herramienta de Bedrock garantizan el esquema.
        missing = [key for key in schema.get("required", []) if key not in answer.output]
        if missing:
            raise ClaudeCallError(f"{self.engine} respondió sin {', '.join(missing)}")
        return answer

    async def _answer(self, system_prompt: str, schema: dict, parts: list[Part]) -> Answer:
        raise NotImplementedError


def tolerant_json(text) -> dict | None:
    """Un objeto JSON dentro de un texto, aunque venga envuelto en un bloque ```json; None si no hay."""
    if not isinstance(text, str):
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text[text.find("{"): text.rfind("}") + 1]
    try:
        data = json.loads(candidate)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


class ClaudeCaller(Caller):
    """Un `claude -p` por llamada. Si no entrega el resultado en `timeout_s`, se mata el proceso."""

    engine = "Claude Code"

    def __init__(self, model: str, effort: str, cwd: Path, log_path: Path, timeout_s: float = DEFAULT_TIMEOUT_S):
        super().__init__(model, effort)
        self.cwd = cwd
        self.log_path = log_path
        self.timeout_s = timeout_s

    async def _answer(self, system_prompt: str, schema: dict, parts: list[Part]) -> Answer:
        process = await ClaudeCodeProcess.open(system_prompt, self.model, self.effort, schema, self.cwd, self.log_path)

        async def converse() -> dict:
            await process.send_content(content_blocks(parts))
            # El único tope es el `wait_for` de abajo, que además mata el proceso.
            return await process.wait_for_result(timeout_s=math.inf)

        try:
            event = await asyncio.wait_for(converse(), timeout=self.timeout_s)
        except TimeoutError as error:
            _kill(process)
            raise ClaudeCallError(f"claude no respondió en {self.timeout_s:g} s; se detuvo el proceso") from error
        except ClaudeCodeError as error:
            raise ClaudeCallError(str(error)) from error
        finally:
            await process.close()
        output = event.get("structured_output")
        if not isinstance(output, dict) and not event.get("is_error"):
            output = tolerant_json(event.get("result"))
        if event.get("is_error") or event.get("subtype", "success") != "success":
            output = None
        detail = str(event.get("result") or event.get("subtype") or "sin detalle")
        return Answer(output, event.get("usage") or {}, event.get("total_cost_usd") or 0.0, detail)


def _kill(process: ClaudeCodeProcess) -> None:
    try:
        process.process.kill()
    except ProcessLookupError:
        pass
