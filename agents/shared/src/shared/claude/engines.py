"""Selector del motor de Claude por `AGENTS_ENGINE`: `claude-code` (por defecto), `bedrock` o `fake`.

Con `bedrock` hay dos roles: `AGENTS_MODEL`, el rápido (por defecto Haiku 5.5), y `AGENTS_MODEL_FUERTE`, para las llamadas
que lo ameritan (por defecto Sonnet 5.5, o `AGENTS_MODEL` si solo se fijó ese). La Guía tiene el suyo, `AGENTS_MODEL_GUIA`
(por defecto Opus 5.5, o `AGENTS_MODEL`): corre una vez por goal y fija la ruta de referencia, así que conviene que no
falle; los Visitantes siguen en el rápido, que es el que se pierde como una persona. En una cuenta donde los 5.x no
responden basta `AGENTS_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0`.
"""

import os
from pathlib import Path

from shared.claude.caller import Caller, ClaudeCaller
from shared.claude.fake import FakeCaller, Responder
from shared.claude.process import DEFAULT_TIMEOUT_S

ENGINE_VAR = "AGENTS_ENGINE"
MODEL_VAR = "AGENTS_MODEL"
STRONG_MODEL_VAR = "AGENTS_MODEL_FUERTE"
GUIDE_MODEL_VAR = "AGENTS_MODEL_GUIA"
ENGINES = ("claude-code", "bedrock", "fake")
DEFAULT_ENGINE = "claude-code"
DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-haiku-5-5"
DEFAULT_BEDROCK_STRONG_MODEL = "us.anthropic.claude-sonnet-5-5"
DEFAULT_BEDROCK_GUIDE_MODEL = "us.anthropic.claude-opus-5-5"


class UnknownEngine(ValueError):
    pass


def engine() -> str:
    name = os.environ.get(ENGINE_VAR) or DEFAULT_ENGINE
    if name not in ENGINES:
        raise UnknownEngine(f"{ENGINE_VAR}={name} no es un motor: usa {', '.join(ENGINES)}")
    return name


def needs_claude_cli() -> bool:
    return engine() == "claude-code"


def bedrock_model(strong: bool = False, guide: bool = False) -> str:
    fast = os.environ.get(MODEL_VAR)
    if guide:
        return os.environ.get(GUIDE_MODEL_VAR) or fast or DEFAULT_BEDROCK_GUIDE_MODEL
    if strong:
        return os.environ.get(STRONG_MODEL_VAR) or fast or DEFAULT_BEDROCK_STRONG_MODEL
    return fast or DEFAULT_BEDROCK_MODEL


def model_for(model: str, strong: bool = False, guide: bool = False) -> str:
    """El modelo que de verdad se usa: con `bedrock`, el del rol en vez de `model`, salvo que ya sea de Bedrock."""
    if engine() == "bedrock" and "anthropic." not in model:
        return bedrock_model(strong, guide)
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
