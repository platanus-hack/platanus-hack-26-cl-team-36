"""Escritura de summary.json y summary.md junto al catálogo."""

import json
from pathlib import Path

from shared.catalog.files import read_catalog, read_outline

from summary.markdown import summary_markdown
from summary.rows import goal_row, totals


def write_summary(catalog_path: Path, runs_dir: Path, tema: str | None = None) -> Path:
    """Escribe el resumen del catálogo y devuelve la ruta de summary.md.

    Con `tema` (sha256 corto), solo cuenta las tandas con ese tema y escribe summary-tema-<sha>.{json,md}.
    """
    meta, goals, _ = read_catalog(catalog_path)
    summary_dir = catalog_path.parent
    outline = read_outline(summary_dir / "outline.json")
    rows = [goal_row(goal, outline, runs_dir, summary_dir, tema) for goal in goals]
    total = totals(rows)
    name = f"summary-tema-{tema}" if tema else "summary"
    (summary_dir / f"{name}.json").write_text(
        json.dumps({"host": meta["host"], "tema": tema, "totals": total, "goals": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (summary_dir / f"{name}.md").write_text(summary_markdown(meta["host"], rows, total), encoding="utf-8")
    return summary_dir / f"{name}.md"
