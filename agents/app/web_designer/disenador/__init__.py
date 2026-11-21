"""Diseñador: genera un tema con un skill de Claude y lo mide sobre la página real."""

import sys
from pathlib import Path

# Módulos planos del evaluador (`import browser`, `import engines`), importados desde su carpeta.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "web_evaluator"))
