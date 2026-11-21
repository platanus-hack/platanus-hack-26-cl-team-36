"""Configuración del diseñador: modelos, viewports, rutas y umbrales de las métricas."""

from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[3]
REPO_DIR = AGENTS_DIR.parent
RUNS_DIR = AGENTS_DIR / ".runs" / "diseno"
SKILL_POR_DEFECTO = REPO_DIR / ".claude" / "skills" / "disenar-tema" / "SKILL.md"
RUBRICA_JUEZ = Path(__file__).with_name("rubrica_juez.md")
RUBRICA_PAR = Path(__file__).with_name("rubrica_par.md")

# Modelos. El tema lo diseña Haiku (el de la extensión); el juez es un modelo más fuerte.
MODELO = "claude-haiku-5-5"
ESFUERZO = "medium"  # en low, Haiku 5.5 corta antes y se salta revisiones
MODELO_JUEZ = "claude-sonnet-5-5"
ESFUERZO_JUEZ = "medium"

# Viewports: el modelo y el juez ven el de escritorio; el móvil se mide y se captura después.
ESCRITORIO = {"width": 1280, "height": 800}
MOVIL = {"width": 390, "height": 844}
LOCALE = "es-CL"
TIMEZONE = "America/Santiago"

# Navegador.
CARGA_TIMEOUT_MS = 30_000
ESPERA_RED_MS = 5_000       # espera a networkidle, sin fallar si el sitio nunca se calma
ESPERA_TEMA_S = 0.6         # tras aplicar o quitar el tema, antes de medir y capturar

# Mapa de la página que recibe el modelo.
MAPA_MAX_CARACTERES = 14_000

# Métricas.
MAX_MUESTRAS_TEXTO = 600    # nodos de texto muestreados para el contraste
MAX_ELEMENTOS = 4_000       # elementos visibles que se siguen para contar los que el tema oculta
UMBRAL_IDENTICA = 0.005     # fracción de píxeles distintos bajo la cual "sin mi-tema" cuenta como idéntica

# Generaciones simultáneas (cada una abre dos contextos del navegador y llama a Claude).
CONCURRENCIA = 3
