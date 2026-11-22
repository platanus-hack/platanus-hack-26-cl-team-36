"""Claude en Amazon Bedrock por bedrock-runtime, con las credenciales de AWS del entorno.

La salida estructurada es una herramienta forzada cuyo `input_schema` es el esquema pedido: así responde Haiku 4.5,
que no tiene `output_config.format` en Bedrock.
"""

import asyncio
import functools
import json
import random
from pathlib import Path

from shared import aws
from shared.claude.caller import Answer, CachePoint, Caller, ClaudeCallError, Part
from shared.claude.process import DEFAULT_TIMEOUT_S, content_blocks

MAX_TOKENS = 16_000
ANSWER_TOOL = "responder"
# La cuota de la cuenta es de 50 requests/min: ante un rechazo se espera 2, 4, 8… s (hasta 60) con jitter.
RETRYABLE_CODES = {"ThrottlingException", "ServiceUnavailableException", "InternalServerException",
                   "ModelNotReadyException"}
MAX_ATTEMPTS = 8
BACKOFF_BASE_S = 2.0
BACKOFF_MAX_S = 60.0
MAX_CACHE_POINTS = 4    # el máximo de bloques con `cache_control` por request


@functools.cache
def bedrock_client(region: str, read_timeout_s: float):
    import boto3
    from botocore.config import Config

    # Los reintentos los hace `BedrockCaller`, con su propio backoff.
    config = Config(read_timeout=read_timeout_s, retries={"mode": "standard", "total_max_attempts": 1})
    return boto3.client("bedrock-runtime", region_name=region, config=config)


def error_code(error: Exception) -> str | None:
    response = getattr(error, "response", None)
    return (response.get("Error") or {}).get("Code") if isinstance(response, dict) else None


def backoff_s(attempt: int) -> float:
    return min(BACKOFF_MAX_S, BACKOFF_BASE_S * 2 ** attempt) * (0.5 + random.random() / 2)


def cached_content(parts: list[Part]) -> list[dict]:
    """Los bloques del mensaje, con `cache_control` en el bloque anterior a cada `CACHE_POINT`."""
    if sum(isinstance(part, CachePoint) for part in parts) > MAX_CACHE_POINTS:
        raise ValueError(f"Bedrock acepta hasta {MAX_CACHE_POINTS} puntos de caché")
    blocks: list[dict] = []
    for part in parts:
        if isinstance(part, CachePoint):
            blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral"}}
        else:
            blocks.extend(content_blocks([part]))
    return blocks


class BedrockCaller(Caller):
    engine = "Bedrock"
    caches_prompts = True

    def __init__(self, model: str, effort: str, log_path: Path, client=None, timeout_s: float = DEFAULT_TIMEOUT_S,
                 sleep=asyncio.sleep):
        super().__init__(model, effort)  # `effort` queda registrado: Haiku 4.5 no lo acepta y no se envía
        self.log_path = log_path
        self.client = client or bedrock_client(aws.region(), timeout_s)
        self.sleep = sleep

    def _body(self, system_prompt: str, schema: dict, parts: list[Part]) -> str:
        return json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "messages": [{"role": "user", "content": cached_content(parts)}],
            "tools": [{"name": ANSWER_TOOL, "description": "Entrega la respuesta pedida.", "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": ANSWER_TOOL},
        })

    async def _answer(self, system_prompt: str, schema: dict, parts: list[Part]) -> Answer:
        body = self._body(system_prompt, schema, parts)
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = await asyncio.to_thread(
                    self.client.invoke_model, modelId=self.model, body=body,
                    contentType="application/json", accept="application/json",
                )
                break
            except Exception as error:
                code = error_code(error)
                self._log({"error": code or type(error).__name__, "attempt": attempt + 1, "detail": str(error)[:300]})
                if code not in RETRYABLE_CODES or attempt == MAX_ATTEMPTS - 1:
                    raise ClaudeCallError(f"Bedrock respondió con error: {code or type(error).__name__}: {error}"[:400]) from error
                await self.sleep(backoff_s(attempt))
        data = json.loads(response["body"].read())
        self._log({"model": self.model, "stop_reason": data.get("stop_reason"), "usage": data.get("usage")})
        output = next((block.get("input") for block in data.get("content") or []
                       if block.get("type") == "tool_use" and block.get("name") == ANSWER_TOOL), None)
        if data.get("stop_reason") != "tool_use":
            output = None   # cortada por `max_tokens`, la entrada de la herramienta viene incompleta
        return Answer(output, data.get("usage") or {}, 0.0, f"stop_reason {data.get('stop_reason')}")

    def _log(self, entry: dict) -> None:
        with open(self.log_path, "a", encoding="utf-8") as log:
            log.write(json.dumps({"engine": "bedrock", **entry}, ensure_ascii=False) + "\n")
