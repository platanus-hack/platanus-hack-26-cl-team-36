"""Configuración del Visitante: modelos, límites de cada intento y AWS."""

import os
from pathlib import Path

# Modelos en local: los usuarios sintéticos navegan con Sonnet; el juez (solo con --judge) es Opus.
# En AWS (motor bedrock), los usuarios usan el modelo rápido y el juez el fuerte (shared.claude.engines.bedrock_model).
USER_MODEL = "claude-sonnet-5-5"
JUDGE_MODEL = "claude-opus-5-5"
USER_EFFORT = "medium"
JUDGE_EFFORT = "medium"
USER_MAX_TOKENS = 10_000
JUDGE_MAX_TOKENS = 8_000   # los 5.x pueden razonar antes del JSON

# Límites de cada intento.
MAX_STEPS = 15      # acciones ejecutadas en la página
MAX_SECONDS = 180   # tiempo total del intento, incluida la espera del modelo
MAX_TURNS = 40      # tope de seguridad de llamadas al modelo por intento

# Los perfiles exploradores prueban varios caminos y vuelven atrás: necesitan más presupuesto que el resto.
EXPLORADOR_MAX_ACCIONES = 30
# Con Haiku en esfuerzo medium y 4 exploradores en paralelo, cada acción toma 12 a 15 s (metro.cl, bibliotecanacional.cl):
# con 300 s se acababa el tiempo antes que las acciones.
EXPLORADOR_MAX_SEGUNDOS = 420
EXPLORADOR_MAX_TURNOS = 70
# Conjunto de exploradores que corre con `--exploradores` sin nombre (ver profiles.CONJUNTOS_EXPLORADORES): "base" son
# los 4 de siempre, uno por lugar de la página inicial (menú, buscador, pie, contenido); "conocimiento" son 8, esos 4
# lugares con dos niveles de conocimiento del tema (sin_contexto y conoce_tema, ver conocimiento.py).
# Desde el 2026-11-21 el estándar son los 8 (spike de exploradores con conocimiento, 2026-11-21).
CONJUNTO_EXPLORADORES = "conocimiento"

# Skills de Claude Code del repo (.claude/skills/): algunos perfiles cargan una en su prompt. La imagen del runtime
# chameleon las copia en la misma ruta; sin la carpeta (None), esos perfiles no corren.
# Desde agents/app/visitor/visitor/config.py, la raíz del repo está cuatro carpetas arriba.
_CARPETAS_ARRIBA = Path(__file__).resolve().parents
_SKILLS = _CARPETAS_ARRIBA[4] / ".claude" / "skills" if len(_CARPETAS_ARRIBA) > 4 else None
DIR_SKILLS: Path | None = _SKILLS if _SKILLS and _SKILLS.is_dir() else None

# Señales de error.
NO_EFFECT_THRESHOLD = 0.005  # fracción de píxeles que deben cambiar para que una acción "tenga efecto"

# AWS: el motor `bedrock`, el navegador `agentcore` y el Visitante desplegado en AgentCore Runtime.
# El proyecto vive en us-east-2 (ver infra/README.md).
AWS_REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"

# Haiku 4.5 responde 400 si la petición lleva `output_config.effort`: con él, el esfuerzo no se envía.
_SIN_ESFUERZO = ("claude-haiku-4-5",)


def accepts_effort(model: str) -> bool:
    return not any(name in model for name in _SIN_ESFUERZO)
