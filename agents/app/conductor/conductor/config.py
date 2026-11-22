"""Valores por defecto y variables de entorno del conductor."""

import os
from pathlib import Path

# Lo que recorre una revisión que no pide opciones (la API manda solo url y revision). Cada objetivo lleva sus
# usuarios del Visitante todos a la vez: `arana` (visitor/profiles.py) son 30 por objetivo, 24 de ellos exploradores,
# y RUNS los multiplica. Con 8 objetivos a la vez son hasta 240 sesiones de navegador por revisión (ver README).
GOALS_MAX = int(os.environ.get("CONDUCTOR_GOALS_MAX") or 8)
# Perfiles o un conjunto con nombre del Visitante; CONDUCTOR_CONJUNTO es lo mismo, por claridad al pedir un conjunto.
PROFILES = os.environ.get("CONDUCTOR_PROFILES") or os.environ.get("CONDUCTOR_CONJUNTO") or "arana"
RUNS = int(os.environ.get("CONDUCTOR_RUNS") or 1)
CONCURRENCY = int(os.environ.get("CONDUCTOR_CONCURRENCY") or 8)   # objetivos a la vez

INVOKER_VAR = "CONDUCTOR_INVOKER"           # local (por defecto) o agentcore
RUNTIME_ARN_VAR = "CONDUCTOR_RUNTIME_ARN"   # con agentcore: el runtime que corre cada etapa
POLL_VAR = "CONDUCTOR_POLL_S"               # con agentcore: el tope de la espera entre lecturas del manifiesto
GRACE_VAR = "CONDUCTOR_IMPROVER_GRACE_S"    # tras el primer Visitante exitoso, cuánto se espera a los demás objetivos
TIMEOUT_VAR = "CONDUCTOR_TIMEOUT_{stage}_S"  # tiempo máximo de cada etapa: CATALOG, GUIDE, VISITOR, IMPROVER

INVOKERS = ("local", "agentcore")
POLL_S = 5.0
POLL_FIRST_S = 1.0
POLL_GROWTH = 1.5
# Un Visitante de `arana` tarda de 4 a 8 min y los objetivos terminan con minutos de diferencia: con menos margen la
# mejora parte sin la mayoría de las tandas y la Propuesta de esas tandas queda vacía.
IMPROVER_GRACE_S = 600.0
# Segundos: el catálogo y la mejora abren una página; la Guía explora y verifica; el Visitante corre sus intentos.
TIMEOUTS_S = {"catalog": 900.0, "guide": 1200.0, "visitor": 1800.0, "improver": 900.0}

APPS_DIR = Path(__file__).resolve().parents[2]
"""`agents/app/`: con el invocador local, cada etapa corre en su carpeta."""


def _seconds(name: str, default: float, zero: bool = False) -> float:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        number = float(value)
    except ValueError:
        number = -1
    if number < 0 or (number == 0 and not zero):
        raise ValueError(f"{name} debe ser un número de segundos mayor{' o igual' if zero else ''} que 0: {value!r}")
    return number


def timeouts() -> dict[str, float]:
    return {stage: _seconds(TIMEOUT_VAR.format(stage=stage.upper()), default) for stage, default in TIMEOUTS_S.items()}


def poll_s() -> float:
    return _seconds(POLL_VAR, POLL_S)


def improver_grace_s() -> float:
    return _seconds(GRACE_VAR, IMPROVER_GRACE_S, zero=True)
