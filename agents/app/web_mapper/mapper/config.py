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

# Vista de la página que recibe el modelo.
MAX_ELEMENTS = 400
MAX_TEXT_CHARS = 12_000

# Esquema del sitio para descubrir objetivos.
MAX_PAGES = 30
MAX_DEPTH = 2
CRAWL_DELAY_S = 2.0         # entre páginas: algunos sitios responden 404 a pedidos seguidos
CRAWL_RETRY_DELAY_S = 8.0
ROUTE_CONCURRENCY = 2       # rutas del catálogo mapeadas a la vez

# Viewports, tomados de perfiles del evaluador.
VIEWPORTS: dict[str, Profile] = {"desktop": PROFILES["first_time"], "mobile": PROFILES["mobile"]}
