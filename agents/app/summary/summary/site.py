"""Una corrida de summary: summary.json y summary.md del último catálogo del sitio."""

import json

import posixpath

from shared import store
from shared.catalog.files import read_catalog, read_outline

from summary.markdown import summary_markdown
from summary.rows import goal_row, totals


def write_summary(backend: store.Backend, url: str, tema: str | None = None) -> store.RunKey:
    """Escribe el resumen del último catálogo de `url` y devuelve su corrida.

    Con `tema` (sha256 corto), solo cuenta las tandas con ese tema; summary.json lo registra en `tema`.
    """
    catalog = store.latest_run(backend, store.cataloger(url))
    if catalog is None:
        raise LookupError(f"no hay catálogo de {url}")
    meta, goals, _ = read_catalog(backend, catalog)
    outline = read_outline(backend, catalog)
    rows, inputs = [], [catalog]
    for goal in goals:
        row, used = goal_row(backend, goal, outline, tema)
        rows.append(row)
        inputs += used
    with store.running(backend, store.summary(url), model=None, inputs=inputs) as run:
        for row in rows:
            row["report"] = row["report"] and posixpath.relpath(row["report"], str(run.key))
        total = totals(rows)
        (run.workdir / "summary.json").write_text(
            json.dumps({"host": meta["host"], "tema": tema, "totals": total, "goals": rows}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (run.workdir / "summary.md").write_text(summary_markdown(meta["host"], rows, total), encoding="utf-8")
    return run.key
