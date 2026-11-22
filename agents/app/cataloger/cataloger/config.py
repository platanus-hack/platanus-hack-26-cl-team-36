"""Configuración del Catalogador: modelo y topes del recorrido del sitio."""

MODEL = "claude-opus-5-5"
EFFORT = "high"

MAX_PAGES = 30
MAX_DEPTH = 2
CRAWL_DELAY_S = 2.0         # pausa entre páginas
CRAWL_RETRY_DELAY_S = 8.0
