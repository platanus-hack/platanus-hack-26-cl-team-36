"""Las tandas del Visitante de un objetivo, separadas por el tema con que corrieron."""

import json
from pathlib import Path


def tema_de_tanda(batch: Path) -> str | None:
    """El sha256 corto del tema con que corrió la tanda (route_tree.json, `tema`); None si fue sin tema."""
    try:
        tema = json.loads((batch / "route_tree.json").read_text(encoding="utf-8")).get("tema")
    except (OSError, ValueError):
        return None
    return tema.get("sha256") if isinstance(tema, dict) else None


def tandas_con_tema(goal_dir: Path, tema: str | None) -> list[Path]:
    """Las tandas terminadas del objetivo con ese tema (None = sin tema), de la más vieja a la más nueva.

    Con y sin tema van a la misma carpeta, así que se separan por lo que registró cada tanda.
    """
    return sorted(path.parent for path in goal_dir.glob("*/report.md") if tema_de_tanda(path.parent) == tema)
