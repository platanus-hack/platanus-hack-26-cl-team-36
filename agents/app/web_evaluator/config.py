"""Configuración del evaluador web: modelos, límites de cada intento, navegador y AWS."""

import os

# Modelos: los usuarios sintéticos navegan con Sonnet; el criterio y el veredicto los da Opus.
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
BEDROCK_MODEL_PREFIX = "anthropic."   # Claude en Amazon Bedrock (endpoint bedrock-mantle): anthropic.claude-...
AGENTCORE_RUNTIME_NAME = "web_evaluator"
AGENTCORE_BROWSER_VIEWPORT = {"width": 1280, "height": 800}   # la ventana; cada perfil fija su propia vista
AGENTCORE_BROWSER_TIMEOUT_SECONDS = 1800
