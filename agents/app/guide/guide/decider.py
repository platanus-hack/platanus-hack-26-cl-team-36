"""Decisión de cada turno de la exploración."""

from dataclasses import dataclass
from typing import Protocol

from shared.claude.caller import CACHE_POINT, Caller

from guide.prompts import DECISION_SCHEMA, TEXT_HEADING, TurnPrompt
from guide.quote import MIN_QUOTE_WORDS


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

    async def decide(self, prompt: TurnPrompt, screenshot: bytes) -> Decision: ...


class ClaudeDecider:
    """Una llamada independiente por turno: cada una lleva la tarea, la página y el historial, así el contexto no crece."""

    def __init__(self, system_prompt: str, caller: Caller):
        self.system_prompt = system_prompt
        self.caller = caller

    @property
    def usage(self) -> dict:
        return self.caller.usage

    @property
    def cost_usd(self) -> float:
        return self.caller.cost_usd

    async def decide(self, prompt: TurnPrompt, screenshot: bytes) -> Decision:
        # Mientras la página no cambia (scroll fallido, acción o cita rechazada) se repiten la vista y la captura.
        parts = [prompt.page, CACHE_POINT, screenshot, CACHE_POINT, prompt.history]
        output = (await self.caller.answer(self.system_prompt, DECISION_SCHEMA, parts)).output
        fields = {key: output.get(key) for key in Decision.__dataclass_fields__}
        return Decision(**{**fields, "reason": fields["reason"] or ""})


def scripted_decision(system_prompt: str, schema: dict, parts: list) -> dict:
    """La respuesta del motor guionizado: termina en la página inicial citando su primera frase de texto, o se rinde."""
    text = parts[0].split(TEXT_HEADING, 1)[-1]
    phrases = (line.strip() for line in text.splitlines() if not line.startswith("("))
    line = next((phrase for phrase in phrases if len(phrase.split()) >= MIN_QUOTE_WORDS), None)
    if line is None:
        return {"reason": "motor guionizado", "action": "give_up", "text": "respuesta guionizada, sin texto que citar"}
    return {"reason": "motor guionizado", "action": "done", "answer": line, "quote": line}
