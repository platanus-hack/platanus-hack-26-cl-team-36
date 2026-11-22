"""Configuración del diseñador: modelos, viewports, rutas y umbrales de las métricas."""

import os
from pathlib import Path

from shared.browser.viewports import SCREENS

AGENTS_DIR = Path(__file__).resolve().parents[3]
REPO_DIR = AGENTS_DIR.parent
RUNS_DIR = AGENTS_DIR / ".runs" / "diseno"
# En la imagen Docker (contexto `agents/`) el skill no está en `.claude/`: se copia y se indica con esta variable.
SKILL_VAR = "WEB_DESIGNER_SKILL"
SKILL_POR_DEFECTO = Path(os.environ.get(SKILL_VAR) or REPO_DIR / ".claude" / "skills" / "disenar-tema" / "SKILL.md")
RUBRICA_JUEZ = Path(__file__).with_name("rubrica_juez.md")
RUBRICA_PAR = Path(__file__).with_name("rubrica_par.md")

# Modelos. El tema lo diseña Haiku (el de la extensión); el juez es un modelo más fuerte.
MODELO = "claude-haiku-5-5"
ESFUERZO = "medium"  # en low, Haiku 5.5 corta antes y se salta revisiones
MODELO_JUEZ = "claude-sonnet-5-5"
ESFUERZO_JUEZ = "medium"
TIMEOUT_MODELO_S = 240      # una llamada a `claude -p` (diseño o juez) que tarda más se mata y cuenta como error

# Viewports: el modelo y el juez ven el de escritorio; el móvil se mide y se captura después.
ESCRITORIO = {"width": 1280, "height": 800}
MOVIL = {"width": 390, "height": 844}
# La mejora de una revisión diseña en el escritorio de la Guía y el Visitante: lo que no vieron, el tema debe mostrarlo.
REVISION = {"width": SCREENS["desktop"].width, "height": SCREENS["desktop"].height}
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

# Etapa de mejora de una revisión (`--revision`): gustos fijos; la tarea es el objetivo que peor resultó.
GUSTOS_MEJORA = ("Legible y con buen contraste, sin distracciones; que lo que lleva a la tarea se destaque y se"
                 " encuentre a la primera.")
MAX_GOALS_SIN_CORRIDAS = 10   # objetivos del catálogo en el resumen si ninguno tiene ruta ni visitas en la revisión
MAX_PASOS_RUTA = 12
MAX_VISITAS = 5
MAX_TEXTO = 200
