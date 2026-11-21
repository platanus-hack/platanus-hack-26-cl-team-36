"""Mapeador: encuentra la ruta de referencia de una tarea leyendo el DOM."""

import sys
from pathlib import Path

# Módulos planos del evaluador (`import browser`), importados desde su carpeta.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "web_evaluator"))
