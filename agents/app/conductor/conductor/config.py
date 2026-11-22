"""Valores por defecto y variables de entorno del conductor."""

import os
from pathlib import Path

GOALS_MAX = 3
RUNS = 1
CONCURRENCY = 2

INVOKER_VAR = "CONDUCTOR_INVOKER"           # local (por defecto) o agentcore
RUNTIME_ARN_VAR = "CONDUCTOR_RUNTIME_ARN"   # con agentcore: el runtime que corre cada etapa
POLL_VAR = "CONDUCTOR_POLL_S"               # con agentcore: cada cuánto se lee el manifiesto de la etapa
TIMEOUT_VAR = "CONDUCTOR_TIMEOUT_{stage}_S"  # tiempo máximo de cada etapa: CATALOG, GUIDE, VISITOR, IMPROVER

INVOKERS = ("local", "agentcore")
POLL_S = 10.0
# Segundos: el catálogo y la mejora abren una página; la Guía explora y verifica; el Visitante corre sus intentos.
TIMEOUTS_S = {"catalog": 900.0, "guide": 1200.0, "visitor": 1800.0, "improver": 900.0}

APPS_DIR = Path(__file__).resolve().parents[2]
"""`agents/app/`: con el invocador local, cada etapa corre en su carpeta."""


def _positive(name: str, default: float) -> float:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        number = float(value)
    except ValueError:
        number = 0
    if number <= 0:
        raise ValueError(f"{name} debe ser un número de segundos mayor que 0: {value!r}")
    return number


def timeouts() -> dict[str, float]:
    return {stage: _positive(TIMEOUT_VAR.format(stage=stage.upper()), default) for stage, default in TIMEOUTS_S.items()}


def poll_s() -> float:
    return _positive(POLL_VAR, POLL_S)
