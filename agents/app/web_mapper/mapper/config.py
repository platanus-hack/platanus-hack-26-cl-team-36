"""Configuración del Mapeador: modelo, límites de la exploración y viewports."""

from pathlib import Path

from profiles import PROFILES, Profile

AGENTS_DIR = Path(__file__).resolve().parents[3]
RUNS_DIR = AGENTS_DIR / ".runs"
TASKS_DIR = AGENTS_DIR / "tasks"

MODEL = "claude-opus-5-5"
EFFORT = "high"

# Límites de la exploración.
MAX_STEPS = 40      # acciones ejecutadas en la página
MAX_SECONDS = 900   # tiempo total, incluida la espera del modelo
MAX_TURNS = 60      # llamadas al modelo
REAPPEAR_S = 30     # espera a un elemento que estaba a la vista y se ocultó, como la diapositiva de un carrusel
TRIAL_REAPPEAR_S = 5  # la misma espera al probar quitar un paso: quitarlo suele dejar oculto al siguiente
EXTRA_ROUTES = 1    # exploraciones más que piden una ruta más corta que la primera verificada

# Vista de la página que recibe el modelo.
MAX_ELEMENTS = 400
MAX_TEXT_CHARS = 12_000

# Esquema del sitio para descubrir objetivos.
MAX_PAGES = 30
MAX_DEPTH = 2
CRAWL_DELAY_S = 2.0         # pausa entre páginas
CRAWL_RETRY_DELAY_S = 8.0
ROUTE_CONCURRENCY = 2       # rutas del catálogo mapeadas a la vez

# Viewports, tomados de perfiles del evaluador.
VIEWPORTS: dict[str, Profile] = {"desktop": PROFILES["first_time"], "mobile": PROFILES["mobile"]}
