"""Decisión de cada turno con el Claude Code local, una llamada independiente por turno."""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from engines import ClaudeCodeError, ClaudeCodeProcess

from mapper.prompts import DECISION_SCHEMA

_USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


class DeciderError(Exception):
    """El modelo no devolvió una decisión."""


@dataclass
class Decision:
    reason: str
    action: str
    ref: str | None = None
    text: str | None = None
    answer: str | None = None
    quote: str | None = None


class Decider(Protocol):
    usage: dict
    cost_usd: float

    async def decide(self, text: str, screenshot: bytes) -> Decision: ...


class ClaudeDecider:
    """Cada turno lleva la tarea, el historial y la página completa, así el contexto no crece con la exploración."""

    def __init__(self, system_prompt: str, model: str, effort: str, cwd: Path, log_path: Path):
        self.system_prompt = system_prompt
        self.model = model
        self.effort = effort
        self.cwd = cwd
        self.log_path = log_path
        self.usage = dict.fromkeys(_USAGE_KEYS, 0)
        self.cost_usd = 0.0

    async def decide(self, text: str, screenshot: bytes) -> Decision:
        process = await ClaudeCodeProcess.open(
            self.system_prompt, self.model, self.effort, DECISION_SCHEMA, self.cwd, self.log_path
        )
        try:
            await process.send(text, screenshot)
            event = await process.wait_for_result()
        except ClaudeCodeError as error:
            raise DeciderError(str(error))
        finally:
            await process.close()
        self._add_usage(event)
        output = event.get("structured_output")
        if event.get("is_error") or not isinstance(output, dict):
            raise DeciderError(f"Claude Code no devolvió una decisión: {str(event.get('result'))[:300]}")
        return Decision(**{key: output.get(key) for key in Decision.__dataclass_fields__})

    def _add_usage(self, event: dict) -> None:
        usage = event.get("usage") or {}
        for key in _USAGE_KEYS:
            self.usage[key] += usage.get(key) or 0
        self.cost_usd += event.get("total_cost_usd") or 0.0
