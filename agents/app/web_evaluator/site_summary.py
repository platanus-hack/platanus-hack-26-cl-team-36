"""Resumen de un sitio: cada objetivo del catálogo con su ruta del Mapeador y su última tanda, leídos de disco."""

import json
import os
import statistics
from pathlib import Path


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _route(goal_dir: Path, goal: dict) -> dict | None:
    """La ruta de esta instrucción: una verificada si hay, si no la primera."""
    routes = [route for path in sorted(goal_dir.glob("reference/*/route.json")) if (route := _read(path))
              and (route.get("start_url"), route.get("instruction")) == (goal["start_url"], goal["instruction"])]
    return next((route for route in routes if route.get("status") == "verified"), routes[0] if routes else None)


def _latest_batch(goal_dir: Path) -> Path | None:
    batches = sorted(path.parent for path in goal_dir.glob("*/report.md"))
    return batches[-1] if batches else None


def _runs(batch: Path) -> list[dict]:
    comparison = _read(batch / "reference_comparison.json") or {"runs": []}
    compared = {row["profile"]: row for row in comparison["runs"]}
    runs = []
    for path in sorted(batch.glob("*/run.json")):
        run = _read(path)
        if run and run.get("verdict"):
            row = compared.get(run["profile"], {})
            runs.append({"profile": run["profile"], "outcome": run["verdict"].get("outcome"), "steps": len(run["steps"]),
                         "efficiency": row.get("efficiency"), "beat_reference": row.get("beat_reference", False)})
    return runs


def _fewer(route: dict | None, runs: list[dict]) -> str | None:
    """Quién necesitó menos pasos: el Mapeador (pasos mínimos) o el mejor intento con éxito."""
    successes = [run["steps"] for run in runs if run["outcome"] == "success"]
    if not route or route.get("status") != "verified" or not successes:
        return None
    best, reference = min(successes), route["totals"]["min_steps"]
    return "igual" if best == reference else ("evaluador" if best < reference else "mapeador")


def _not_run(goal: dict, route: dict | None) -> str:
    if goal.get("exclusion"):
        return goal["exclusion"]
    if route is None:
        return "sin ruta (límite o error)"
    if route.get("status") != "verified":
        return f"ruta {route.get('status')}"
    return "sin tanda (límite o error)"


def goal_row(goal: dict, runs_dir: Path, summary_dir: Path) -> dict:
    goal_dir = runs_dir / goal["id"]
    route = _route(goal_dir, goal)
    batch = _latest_batch(goal_dir)
    runs = _runs(batch) if batch else []
    proposals = [proposal["status"] for path in goal_dir.glob("reference/*/proposed.json") if (proposal := _read(path))]
    return {
        **{key: goal.get(key) for key in ("id", "description", "level", "intent", "prominence", "complexity")},
        "route_status": route.get("status") if route else None,
        "min_steps": route["totals"]["min_steps"] if route and route.get("status") == "verified" else None,
        "routes_tried": (route.get("search") or {}).get("tried", 1) if route else None,
        "runs": runs,
        "fewer": _fewer(route, runs),
        "proposal": proposals[0] if proposals else None,
        "report": os.path.relpath(batch / "report.md", summary_dir) if batch else None,
        "not_run": None if runs else _not_run(goal, route),
    }


def totals(rows: list[dict]) -> dict:
    runs = [run for row in rows for run in row["runs"]]
    compared = [run["efficiency"] for run in runs if run["efficiency"] is not None]
    successes = sum(run["outcome"] == "success" for run in runs)
    return {
        "goals": len(rows),
        "mapped": sum(row["route_status"] is not None for row in rows),
        "verified": sum(row["route_status"] == "verified" for row in rows),
        "evaluated": sum(bool(row["runs"]) for row in rows),
        "runs": len(runs),
        "successes": successes,
        "success_rate": round(successes / len(runs), 2) if runs else None,
        "spl": round(statistics.mean(compared), 2) if compared else None,
        "beat_reference": sum(run["beat_reference"] for run in runs),
        "proposals": sum(row["proposal"] is not None for row in rows),
    }


def _cell(value) -> str:
    return "—" if value is None or value == "" else str(value).replace("|", "\\|").replace("\n", " ")


def _row_line(row: dict) -> str:
    mapper = f"{row['min_steps']} ({row['routes_tried']} rutas)" if row["min_steps"] is not None else row["route_status"]
    runs = "; ".join(f"{run['profile']}: {run['outcome']}, {run['steps']} pasos" for run in row["runs"])
    efficiency = "; ".join(f"{run['efficiency']:.2f}" for run in row["runs"] if run["efficiency"] is not None)
    fewer = row["fewer"] + (f" (propuesta {row['proposal']})" if row["proposal"] else "") if row["fewer"] else None
    cells = [f"`{row['id']}` {row['description']}", row["level"], row["intent"], row["prominence"], row["complexity"],
             mapper, runs, efficiency, fewer, f"[reporte]({row['report']})" if row["report"] else None]
    return "| " + " | ".join(_cell(cell) for cell in cells) + " |"


def summary_markdown(host: str, rows: list[dict], total: dict) -> str:
    rate = f"{total['successes']}/{total['runs']}" + (f" ({total['success_rate']:.0%})" if total["runs"] else "")
    spl = f"{total['spl']:.2f}" if total["spl"] is not None else "—"
    lines = [
        f"# Resumen de {host}",
        "",
        f"- Objetivos: {total['goals']} · con ruta: {total['mapped']} · verificadas: {total['verified']}"
        f" · evaluados: {total['evaluated']}",
        f"- Intentos con éxito: {rate} · SPL: {spl}",
        f"- Intentos con menos pasos que la referencia: {total['beat_reference']} · propuestas: {total['proposals']}",
        "",
        "| Objetivo | Nivel | Intención | Prominencia | Complejidad | Mapeador (pasos mínimos) | Evaluador | Eficiencia"
        " | Menos pasos | Reporte |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *(_row_line(row) for row in rows if row["not_run"] is None),
    ]
    skipped = [row for row in rows if row["not_run"]]
    if skipped:
        lines += ["", "## Sin evaluar", "", "| Objetivo | Motivo |", "|---|---|",
                  *(f"| `{row['id']}` {_cell(row['description'])} | {row['not_run']} |" for row in skipped)]
    return "\n".join(lines) + "\n"


def write_summary(catalog_path: Path, runs_dir: Path) -> Path:
    """Escribe summary.json y summary.md junto al catálogo y devuelve la ruta de summary.md."""
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    summary_dir = catalog_path.parent
    rows = [goal_row(goal, runs_dir, summary_dir) for goal in catalog["goals"]]
    total = totals(rows)
    (summary_dir / "summary.json").write_text(
        json.dumps({"host": catalog["host"], "totals": total, "goals": rows}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (summary_dir / "summary.md").write_text(summary_markdown(catalog["host"], rows, total), encoding="utf-8")
    return summary_dir / "summary.md"
