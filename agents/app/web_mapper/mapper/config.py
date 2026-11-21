"""Configuración del Mapeador: modelo, límites de la exploración y viewports."""

from profiles import PROFILES, Profile

MODEL = "claude-opus-5-5"
EFFORT = "high"

# Límites de la exploración, más amplios que los de un usuario sintético.
MAX_STEPS = 40      # acciones ejecutadas en la página
MAX_SECONDS = 900   # tiempo total, incluida la espera del modelo
MAX_TURNS = 60      # llamadas al modelo

# Vista de la página que recibe el modelo.
MAX_ELEMENTS = 400
MAX_TEXT_CHARS = 12_000

# Viewports del Mapeador, tomados de los perfiles del evaluador que los usan.
VIEWPORTS: dict[str, Profile] = {"desktop": PROFILES["first_time"], "mobile": PROFILES["mobile"]}
