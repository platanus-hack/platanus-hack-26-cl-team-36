"""Configuración del Catalogador: modelo y topes del recorrido del sitio."""

from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[3]
RUNS_DIR = AGENTS_DIR / ".runs"
TASKS_DIR = AGENTS_DIR / "tasks"

MODEL = "claude-opus-5-5"
EFFORT = "high"

MAX_PAGES = 30
MAX_DEPTH = 2
CRAWL_DELAY_S = 2.0         # pausa entre páginas
CRAWL_RETRY_DELAY_S = 8.0
