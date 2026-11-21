"""Decisión de cada turno de la exploración."""

from dataclasses import dataclass
from typing import Protocol

from mapper.claude import ClaudeCaller
from mapper.prompts import DECISION_SCHEMA


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
    """Una llamada independiente por turno: cada una lleva la tarea, el historial y la página, así el contexto no crece."""

    def __init__(self, system_prompt: str, caller: ClaudeCaller):
        self.system_prompt = system_prompt
        self.caller = caller

    @property
    def usage(self) -> dict:
        return self.caller.usage

    @property
    def cost_usd(self) -> float:
        return self.caller.cost_usd

    async def decide(self, text: str, screenshot: bytes) -> Decision:
        output = await self.caller.ask(self.system_prompt, DECISION_SCHEMA, text, screenshot)
        return Decision(**{key: output.get(key) for key in Decision.__dataclass_fields__})
