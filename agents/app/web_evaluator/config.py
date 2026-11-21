"""Configuración del evaluador web: modelos, límites de cada intento, navegador y AWS."""

import os
from pathlib import Path

# Modelos en local: los usuarios sintéticos navegan con Sonnet; el criterio y el veredicto los da Opus.
# En AWS se usa solo Haiku (BEDROCK_*_MODEL, más abajo).
USER_MODEL = "claude-sonnet-5-5"
JUDGE_MODEL = "claude-opus-5-5"
USER_EFFORT = "medium"
JUDGE_EFFORT = "medium"
USER_MAX_TOKENS = 10_000
# Cuánto se espera cada respuesta de `claude -p` (motor claude-code y juez) antes de darla por perdida.
CLAUDE_CODE_TIMEOUT_S = 180
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
# Conjunto de exploradores que corre con `--exploradores` sin nombre (ver profiles.CONJUNTOS_EXPLORADORES): "base" son
# los 4 de siempre, uno por lugar de la página inicial (menú, buscador, pie, contenido); "conocimiento" son 8, esos 4
# lugares con dos niveles de conocimiento del tema (sin_contexto y conoce_tema, ver conocimiento.py).
# Desde el 2026-11-21 el estándar son los 8 (ver .spikes/2026-11-21-exploradores-conocimiento.md).
CONJUNTO_EXPLORADORES = "conocimiento"

# Skills de Claude Code del repo (.claude/skills/): algunos perfiles cargan una en su prompt. La carpeta queda fuera
# de lo que se despliega en AgentCore, así que esos perfiles solo corren en local.
DIR_SKILLS = Path(__file__).resolve().parents[3] / ".claude" / "skills"

# Navegador.
LOCALE = "es-CL"
TIMEZONE = "America/Santiago"
PAGE_LOAD_TIMEOUT_MS = 30_000
PAGE_LOAD_ATTEMPTS = 2       # intentos de carga inicial antes de dar el intento por interrumpido

# Señales de error.
NO_EFFECT_THRESHOLD = 0.005  # fracción de píxeles que deben cambiar para que una acción "tenga efecto"

# AWS: el motor `bedrock`, el navegador `agentcore` y el evaluador desplegado en AgentCore Runtime.
# La cuenta de la hackatón solo permite us-east-2 (ver infra/README.md).
AWS_REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
# Claude en Amazon Bedrock por el endpoint bedrock-runtime, con el perfil de inferencia de EE.UU. (us.anthropic.claude-...).
# En us-east-2, Haiku 5.5 no está en bedrock-mantle ni se sirve solo en la región: AWS lo ofrece por perfiles que
# reparten entre regiones, y el de EE.UU. usa us-east-1, us-east-2 y us-west-2, las que la cuenta permite. Ver
# https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html
BEDROCK_MODEL_PREFIX = "us.anthropic."
# En AWS (motor bedrock, incluido AgentCore Runtime) solo se usa Haiku, para los usuarios y para el juez.
BEDROCK_USER_MODEL = "claude-haiku-5-5"
BEDROCK_JUDGE_MODEL = "claude-haiku-5-5"
AGENTCORE_RUNTIME_NAME = "web_evaluator"
AGENTCORE_BROWSER_VIEWPORT = {"width": 1280, "height": 800}   # la ventana; cada perfil fija su propia vista
AGENTCORE_BROWSER_TIMEOUT_SECONDS = 1800
