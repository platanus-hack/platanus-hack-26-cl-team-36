"""Escritura del catálogo: outline.json, goals.json y goals.md."""

import json
from dataclasses import asdict
from pathlib import Path

from shared.catalog.goal import Goal
from shared.catalog.outline import SiteOutline


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_outline(out_dir: Path, outline: SiteOutline) -> None:
    _write_json(out_dir / "outline.json", asdict(outline))


def _row(goal: Goal) -> str:
    cells = [f"`{goal.id}` {goal.description}", goal.level, goal.intent, goal.demand or "—",
             str(goal.estimated_steps or "—"), goal.prominence, ", ".join(goal.gates) or "—"]
    return "| " + " | ".join(cell.replace("|", "\\|") for cell in cells) + " |"


def goals_markdown(meta: dict, goals: list[Goal], issues: list[str]) -> str:
    header = ["| Objetivo | Nivel | Intención | Demanda | Pasos | Prominencia | Barreras |",
              "|---|---|---|---|---|---|---|"]
    lines = [f"# Objetivos de {meta['host']}", "",
             f"{len(goals)} objetivos de {meta['pages']} páginas · modelo {meta['model']} · catálogo US$ {meta['catalog_cost_usd']}"]
    groups = [goal for goal in goals if goal.level == "summary"] + [None]
    for summary in groups:
        children = [goal for goal in goals if goal.level != "summary" and goal.parent == (summary.id if summary else None)]
        title = f"{summary.description} (`{summary.id}`)" if summary else "Sin grupo"
        if summary or children:
            lines += ["", f"## {title}", "", *header, *(_row(goal) for goal in children)]
    if issues:
        lines += ["", "## Correcciones al catálogo del modelo", "", *(f"- {issue}" for issue in issues)]
    return "\n".join(lines) + "\n"


def write_catalog(out_dir: Path, meta: dict, goals: list[Goal], issues: list[str]) -> None:
    _write_json(out_dir / "goals.json", {**meta, "issues": issues, "goals": [asdict(goal) for goal in goals]})
    (out_dir / "goals.md").write_text(goals_markdown(meta, goals, issues), encoding="utf-8")
