"""Corridas de un sitio en el almacén como las dejan el Catalogador, la Guía y el Visitante."""

import json
from datetime import UTC, datetime

from shared import store

START = "https://www.sitio.cl/"
NOW = datetime(2026, 1, 1, tzinfo=UTC)


def publish(backend: store.Backend, prefix: store.RunPrefix, files: dict, moment: datetime = NOW,
            inputs: tuple[store.RunKey, ...] = ()) -> store.RunKey:
    """Una corrida terminada con `files`: nombre (o perfil/nombre) → JSON o texto."""
    run = store.start_run(backend, prefix, model="m", inputs=inputs, clock=lambda: moment)
    for name, data in files.items():
        path = run.workdir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
    store.finish_run(backend, run, "succeeded")
    return run.key


def goal(goal_id: str, **changes) -> dict:
    """Un objetivo de goals.json; `instruction` y `exclusion` se recalculan al leerlo."""
    return {"id": goal_id, "host": "sitio.cl", "start_url": START, "description": f"Tarea {goal_id}.",
            "expected_answer": None, "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [START],
            "entry": None, "prominence": "buried", **changes}


def write_catalog(backend: store.Backend, goals: list[dict], links: list[dict] | None = None) -> store.RunKey:
    outline = {
        "start_url": START, "host": "sitio.cl", "viewport": "1024x768", "failures": [],
        "pages": [{"url": START, "title": "Inicio", "depth": 0, "headings": [], "links": links or [], "forms": [],
                   "buttons": [], "captcha": False, "gates": []}],
    }
    return publish(backend, store.cataloger(START), {"outline.json": outline,
                                                    "goals.json": {"host": "sitio.cl", "issues": [], "goals": goals}})


def write_route(backend: store.Backend, item: dict, min_steps: int = 3, status: str = "verified", tried: int = 2,
                steps: list[dict] | None = None, inputs: tuple[store.RunKey, ...] = ()) -> store.RunKey:
    route = {
        "status": status, "start_url": item["start_url"], "instruction": item["description"], "viewport": "desktop",
        "totals": {"min_steps": min_steps, "actions": min_steps, "distinct_pages": 2},
        "nodes": ["a", "b"], "final_node": "b", "search": {"tried": tried}, "steps": steps or [],
    }
    return publish(backend, store.guide(START, item["id"], "desktop"), {"route.json": route}, inputs=inputs)


def write_batch(backend: store.Backend, goal_id: str, runs: dict[str, tuple[str, int, float | None, bool]],
                moment: datetime = NOW, proposals: bool = False, tema: str | None = None) -> store.RunKey:
    """`runs`: perfil → (resultado, pasos, eficiencia, beat_reference); `tema`: sha256 corto, si corrió con uno."""
    files: dict = {"report.md": "# Reporte", "route_tree.json": {"tema": {"sha256": tema} if tema else None}}
    rows = []
    for profile, (outcome, steps, efficiency, beat) in runs.items():
        files[f"{profile}/run.json"] = {"profile": profile, "steps": [{}] * steps, "verdict": {"outcome": outcome}}
        if efficiency is not None:
            rows.append({"profile": profile, "efficiency": efficiency, "beat_reference": beat})
    files["comparison.json"] = {"runs": rows}
    if proposals:
        files["proposals.json"] = [{"route": "x"}]
    return publish(backend, store.visitor(START, goal_id), files, moment)
