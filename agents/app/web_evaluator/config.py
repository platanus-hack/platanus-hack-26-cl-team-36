"""Configuración del evaluador web: modelos, límites de cada intento y navegador."""

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
