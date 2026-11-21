"""Archivos de un sitio en disco como los dejan el Mapeador y el evaluador, para el plan y el resumen."""

import json
from pathlib import Path

START = "https://www.sitio.cl/"


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def goal(goal_id: str, exclusion: str | None = None, **changes) -> dict:
    return {"id": goal_id, "start_url": START, "description": f"Tarea {goal_id}.", "instruction": f"Tarea {goal_id}.",
            "level": "user_goal", "intent": "find_info", "prominence": "buried", "complexity": "easy",
            "exclusion": exclusion, **changes}


def write_route(runs_dir: Path, item: dict, min_steps: int = 3, status: str = "verified", tried: int = 2) -> None:
    write_json(runs_dir / item["id"] / "reference" / "desktop" / "route.json", {
        "status": status, "start_url": item["start_url"], "instruction": item["instruction"],
        "evaluator_profiles": ["first_time", "hurried"], "totals": {"min_steps": min_steps, "distinct_pages": 2},
        "nodes": ["a", "b"], "final_node": "b", "search": {"tried": tried},
    })


def write_batch(runs_dir: Path, goal_id: str, runs: dict[str, tuple[str, int, float | None, bool]],
                name: str = "2026-01-01_00-00-00") -> None:
    """`runs`: perfil → (resultado, pasos, eficiencia, beat_reference)."""
    batch = runs_dir / goal_id / name
    rows = []
    for profile, (outcome, steps, efficiency, beat) in runs.items():
        write_json(batch / profile / "run.json", {"profile": profile, "steps": [{}] * steps, "verdict": {"outcome": outcome}})
        if efficiency is not None:
            rows.append({"profile": profile, "efficiency": efficiency, "beat_reference": beat})
    write_json(batch / "reference_comparison.json", {"runs": rows})
    (batch / "report.md").write_text("# Reporte", encoding="utf-8")
