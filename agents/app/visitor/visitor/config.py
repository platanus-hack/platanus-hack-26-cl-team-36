"""Configuración del Visitante: modelos, límites de cada intento y AWS."""

import os
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[3]
RUNS_DIR = AGENTS_DIR / ".runs"
TASKS_DIR = AGENTS_DIR / "tasks"

# Modelos en local: los usuarios sintéticos navegan con Sonnet; el criterio y el veredicto los da Opus.
# En AWS se usa solo Sonnet 4.6 (BEDROCK_*_MODEL, más abajo).
USER_MODEL = "claude-sonnet-5-5"
JUDGE_MODEL = "claude-opus-5-5"
USER_EFFORT = "medium"
JUDGE_EFFORT = "medium"
USER_MAX_TOKENS = 10_000
JUDGE_MAX_TOKENS = 4_000

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

# Skills de Claude Code del repo (.claude/skills/): algunos perfiles cargan una en su prompt. La carpeta queda fuera
# de la imagen de AgentCore, así que ahí no hay skills (None) y esos perfiles solo corren en local.
_SKILLS = AGENTS_DIR.parent / ".claude" / "skills"
DIR_SKILLS: Path | None = _SKILLS if _SKILLS.is_dir() else None

# Señales de error.
NO_EFFECT_THRESHOLD = 0.005  # fracción de píxeles que deben cambiar para que una acción "tenga efecto"

# AWS: el motor `bedrock`, el navegador `agentcore` y el Visitante desplegado en AgentCore Runtime.
# El proyecto vive en us-east-2 (ver infra/README.md).
AWS_REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
# Claude en Amazon Bedrock por el endpoint bedrock-runtime, con el perfil de inferencia de EE.UU. (us.anthropic.claude-...),
# que reparte entre us-east-1, us-east-2 y us-west-2.
BEDROCK_MODEL_PREFIX = "us.anthropic."
# En AWS (motor bedrock, incluido AgentCore Runtime) solo se usa Sonnet 4.6, para los usuarios y para el juez. La cuenta
# del proyecto no tiene acceso a Claude Opus 4.7 ni a los modelos posteriores (Bedrock responde "is not available for
# this account" y solo AWS puede habilitarlos), así que el motor usa la herramienta de computer use anterior al toolset
# (ver actions.LEGACY_COMPUTER_MODELS). Sonnet 4.6 no acepta el esfuerzo `xhigh`.
BEDROCK_USER_MODEL = "claude-sonnet-4-6"
BEDROCK_JUDGE_MODEL = "claude-sonnet-4-6"
AGENTCORE_RUNTIME_NAME = "web_evaluator_image"   # en infra/agentcore/agentcore.json
AGENTCORE_BROWSER_VIEWPORT = {"width": 1280, "height": 800}   # la ventana; cada perfil fija su propia vista
AGENTCORE_BROWSER_TIMEOUT_SECONDS = 1800
