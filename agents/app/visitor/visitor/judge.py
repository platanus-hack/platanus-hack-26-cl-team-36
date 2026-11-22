"""Criterio de éxito (al inicio) y veredicto final (al terminar cada intento), con Opus.

El juez puede correr por el Claude Code local (`ClaudeCodeJudge`) o por la API (`ApiJudge`).
"""

import json
from pathlib import Path

from shared.claude.process import png_image_block

from visitor import config
from visitor.claude_code_engine import claude_code_json
from visitor.turns import AttemptEnded

OUTCOMES = ("success", "failed", "abandoned")

_CRITERIA_SCHEMA = {
    "type": "object",
    "properties": {
        "criterion": {"type": "string"},
        "evidence": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["criterion", "evidence"],
    "additionalProperties": False,
}

_VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "outcome": {"type": "string", "enum": list(OUTCOMES)},
        "justification": {"type": "string"},
    },
    "required": ["outcome", "justification"],
    "additionalProperties": False,
}

_CRITERIA_SYSTEM_PROMPT = """Defines criterios de éxito para pruebas de usabilidad de sitios web.
Recibes una tarea y la captura de la página inicial del sitio. Propón un criterio de éxito que se pueda verificar mirando SOLO una captura de pantalla final (sin URL ni código): qué debe verse en pantalla cuando la tarea está cumplida. El criterio debe servir tanto en escritorio como en móvil.
Si la tarea pide comparar o elegir el valor extremo (por ejemplo, "el más barato"), NO exijas que se vean todas las opciones a la vez: una captura de un carrusel o de una lista larga no las muestra todas. Exige en cambio que se vea el dato que responde la tarea (la opción elegida con su valor visible, por ejemplo su precio) junto a su nombre.
Responde en español: "criterion" en una o dos frases, y "evidence" con 2 a 4 elementos visibles concretos que lo confirmarían."""

_VERDICT_SYSTEM_PROMPT = """Juzgas el resultado de un intento de un usuario sintético en una prueba de usabilidad.
Recibes la tarea, el criterio de éxito, cómo terminó el intento y la última captura de pantalla. Juzga principalmente por la captura: la declaración del usuario no prueba nada por sí sola.
- "success": la captura muestra evidencia que cumple el criterio.
- "failed": el usuario terminó en un estado equivocado (creyó cumplir la tarea pero la captura no cumple el criterio, o la pantalla muestra un error).
- "abandoned": el usuario se detuvo, se rindió, quedó bloqueado o se le acabaron los pasos o el tiempo sin cumplir el criterio.
Criterio de consistencia: si la captura muestra el dato que responde la tarea y coincide con lo que declaró el usuario en su mensaje final, es "success", aunque no se vean todas las opciones de una comparación. No descartes una respuesta por falta de elementos que el criterio no pedía. Si el dato no aparece ni en la captura ni en el mensaje, es "failed".
Responde en español con "outcome" y una "justification" de una sola frase."""


class ClaudeCodeJudge:
    name = "claude-code"

    def __init__(self, cwd: Path, model: str = config.JUDGE_MODEL, effort: str = config.JUDGE_EFFORT):
        self.cwd = cwd
        self.model = model
        self.effort = effort

    async def ask_json(self, system_prompt: str, text: str, image: bytes, schema: dict) -> dict:
        try:
            return await claude_code_json(system_prompt, text, image, schema, self.model, self.effort, self.cwd)
        except AttemptEnded as ended:
            raise RuntimeError(ended.message or ended.reason)


class ApiJudge:
    name = "api"

    def __init__(
        self, client, model: str = config.JUDGE_MODEL, effort: str = config.JUDGE_EFFORT, fallbacks: bool = True
    ):
        self.client = client
        self.model = model
        self.effort = effort
        # Bedrock no tiene el parámetro `fallbacks`: ahí una negativa del modelo queda como error del juez.
        self.fallbacks = fallbacks

    async def ask_json(self, system_prompt: str, text: str, image: bytes, schema: dict) -> dict:
        request = {
            "model": self.model,
            "max_tokens": config.JUDGE_MAX_TOKENS,
            "system": system_prompt,
            "messages": [{"role": "user", "content": [{"type": "text", "text": text}, png_image_block(image)]}],
            "output_config": {"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
        }
        if self.fallbacks:
            response = await self.client.beta.messages.create(
                **request, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
            )
        else:
            response = await self.client.messages.create(**request)
        if response.stop_reason == "refusal":
            raise RuntimeError(getattr(response.stop_details, "explanation", None) or "el modelo se negó")
        response_text = next((block.text for block in response.content if block.type == "text"), None)
        if response_text is None:
            raise RuntimeError(f"Respuesta sin texto (stop_reason={response.stop_reason})")
        return json.loads(response_text)


async def propose_criteria(judge, instruction: str, start_screenshot: bytes) -> dict:
    text = f"Tarea: {instruction}\n\nCaptura de la página inicial del sitio:"
    return await judge.ask_json(_CRITERIA_SYSTEM_PROMPT, text, start_screenshot, _CRITERIA_SCHEMA)


_END_REASON_DESCRIPTIONS = {
    "done": "El usuario declaró que terminó la tarea.",
    "blocked": "El usuario se detuvo porque el sitio le pedía algo que no puede hacer (iniciar sesión, pagar, datos personales).",
    "gave_up": "El usuario se rindió.",
    "step_limit": "Se agotaron las acciones disponibles.",
    "time_limit": "Se agotó el tiempo disponible.",
}


async def judge_run(
    judge, instruction: str, criteria: dict, final_screenshot: bytes, end_reason: str, final_message: str
) -> dict:
    how_it_ended = _END_REASON_DESCRIPTIONS.get(end_reason, "El intento se interrumpió.")
    if final_message:
        how_it_ended += f' Su mensaje final fue: "{final_message}"'
    evidence = "\n".join(f"- {item}" for item in criteria.get("evidence", []))
    text = (
        f"Tarea: {instruction}\n\nCriterio de éxito: {criteria['criterion']}\n"
        f"Evidencias esperadas:\n{evidence}\n\nCómo terminó: {how_it_ended}\n\nÚltima captura de pantalla:"
    )
    return await judge.ask_json(_VERDICT_SYSTEM_PROMPT, text, final_screenshot, _VERDICT_SCHEMA)
