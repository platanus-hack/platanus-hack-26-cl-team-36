"""Mapeador: encuentra la ruta de referencia de una tarea leyendo el DOM."""

import sys
from pathlib import Path

# Los módulos del evaluador son planos (`import config`): se importan desde su carpeta, sin copiarlos.
sys.path.append(str(Path(__file__).resolve().parents[2] / "web_evaluator"))
