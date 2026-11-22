"""Configuración de la Guía: modelo y límites de la exploración."""

MODEL = "claude-opus-5-5"
EFFORT = "high"

# Límites de la exploración.
MAX_STEPS = 40      # acciones ejecutadas en la página
MAX_SECONDS = 900   # tiempo total, incluida la espera del modelo
MAX_TURNS = 60      # llamadas al modelo
REAPPEAR_S = 30     # espera a un elemento que estaba a la vista y se ocultó, como la diapositiva de un carrusel
TRIAL_REAPPEAR_S = 5  # la misma espera al probar quitar un paso: quitarlo suele dejar oculto al siguiente
EXTRA_ROUTES = 1    # exploraciones más que piden una ruta más corta que la primera verificada
REVISION_EXTRA_ROUTES = 0  # en una revisión, en AWS con Haiku y 50 llamadas/min

# Vista de la página que recibe el modelo.
MAX_ELEMENTS = 400
MAX_TEXT_CHARS = 12_000

ROUTE_CONCURRENCY = 2       # rutas de un catálogo mapeadas a la vez
