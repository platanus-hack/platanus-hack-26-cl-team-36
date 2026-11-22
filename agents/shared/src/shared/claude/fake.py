"""Motor guionizado: respuestas deterministas, sin Claude, para probar un agente de punta a punta.

Cada respuesta sale, en orden, del guion (`script`), del `responder` del agente o, si ninguno responde, del esquema.
"""

from collections.abc import Callable

from shared.claude.caller import Answer, Caller, Part

# (system_prompt, schema, parts) -> la salida, o None para que responda el esquema.
Responder = Callable[[str, dict, list[Part]], dict | None]

FAKE_TEXT = "respuesta guionizada"


def from_schema(schema: dict):
    """El valor más simple que cumple `schema`: el primer `enum`, null si se acepta, y solo las claves requeridas."""
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = "null" if "null" in kind else kind[0]
    if kind == "object":
        properties = schema.get("properties") or {}
        return {key: from_schema(properties.get(key, {})) for key in schema.get("required", [])}
    return {"array": [], "string": FAKE_TEXT, "integer": schema.get("minimum", 0), "number": schema.get("minimum", 0),
            "boolean": False, "null": None}.get(kind)


class FakeCaller(Caller):
    engine = "el motor guionizado"

    def __init__(self, model: str, effort: str, responder: Responder | None = None, script: list[dict] | None = None):
        super().__init__(model, effort)
        self.responder = responder
        self.script = list(script or [])
        self.calls: list[dict] = []

    async def _answer(self, system_prompt: str, schema: dict, parts: list[Part]) -> Answer:
        self.calls.append({"system_prompt": system_prompt, "schema": schema, "parts": parts})
        output = self.script.pop(0) if self.script else None
        if output is None and self.responder:
            output = self.responder(system_prompt, schema, parts)
        return Answer(from_schema(schema) if output is None else output, {"input_tokens": 0, "output_tokens": 0})
