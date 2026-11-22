"""Selector del motor de Claude por `AGENTS_ENGINE`: `claude-code` (por defecto), `bedrock` o `fake`.

Con `bedrock`, el modelo es `AGENTS_MODEL` (por defecto Haiku 4.5): los modelos 5.x no responden en la cuenta de AWS.
"""

import os
from pathlib import Path

from shared.claude.caller import Caller, ClaudeCaller
from shared.claude.fake import FakeCaller, Responder
from shared.claude.process import DEFAULT_TIMEOUT_S

ENGINE_VAR = "AGENTS_ENGINE"
MODEL_VAR = "AGENTS_MODEL"
ENGINES = ("claude-code", "bedrock", "fake")
DEFAULT_ENGINE = "claude-code"
DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"


class UnknownEngine(ValueError):
    pass


def engine() -> str:
    name = os.environ.get(ENGINE_VAR) or DEFAULT_ENGINE
    if name not in ENGINES:
        raise UnknownEngine(f"{ENGINE_VAR}={name} no es un motor: usa {', '.join(ENGINES)}")
    return name


def needs_claude_cli() -> bool:
    return engine() == "claude-code"


def model_for(model: str) -> str:
    """El modelo que de verdad se usa: con `bedrock`, el de `AGENTS_MODEL` en vez de `model`."""
    if engine() == "bedrock":
        return os.environ.get(MODEL_VAR) or DEFAULT_BEDROCK_MODEL
    return model


def make_caller(model: str, effort: str, cwd: Path, log_path: Path, timeout_s: float = DEFAULT_TIMEOUT_S,
                fake: Responder | None = None) -> Caller:
    """`cwd` es la carpeta vacía de Claude Code; `fake`, las respuestas del agente para el motor guionizado."""
    name, model = engine(), model_for(model)
    if name == "bedrock":
        from shared.claude.bedrock import BedrockCaller

        return BedrockCaller(model, effort, log_path, timeout_s=timeout_s)
    if name == "fake":
        return FakeCaller(model, effort, fake)
    return ClaudeCaller(model, effort, cwd, log_path, timeout_s)
