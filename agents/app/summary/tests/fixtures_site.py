"""Archivos de un sitio en disco como los dejan el Catalogador, la Guía y el Visitante."""

import json
from pathlib import Path

START = "https://www.sitio.cl/"


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def goal(goal_id: str, **changes) -> dict:
    """Un objetivo de goals.json; `instruction` y `exclusion` se recalculan al leerlo."""
    return {"id": goal_id, "host": "www.sitio.cl", "start_url": START, "description": f"Tarea {goal_id}.",
            "expected_answer": None, "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [START],
            "entry": None, "prominence": "buried", **changes}


def write_catalog(catalog_dir: Path, goals: list[dict], links: list[dict] | None = None) -> Path:
    write_json(catalog_dir / "outline.json", {
        "start_url": START, "host": "www.sitio.cl", "viewport": "1024x768", "failures": [],
        "pages": [{"url": START, "title": "Inicio", "depth": 0, "headings": [], "links": links or [], "forms": [],
                   "buttons": [], "captcha": False, "gates": []}],
    })
    write_json(catalog_dir / "goals.json", {"host": "www.sitio.cl", "issues": [], "goals": goals})
    return catalog_dir / "goals.json"


def write_route(runs_dir: Path, item: dict, min_steps: int = 3, status: str = "verified", tried: int = 2,
                steps: list[dict] | None = None) -> None:
    write_json(runs_dir / item["id"] / "reference" / "desktop" / "route.json", {
        "status": status, "start_url": item["start_url"], "instruction": item["description"], "viewport": "desktop",
        "totals": {"min_steps": min_steps, "actions": min_steps, "distinct_pages": 2},
        "nodes": ["a", "b"], "final_node": "b", "search": {"tried": tried}, "steps": steps or [],
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
