import json

from site_summary import write_summary
from tests.fixtures_site import goal, write_batch, write_json, write_route


def test_summary_from_files_on_disk(tmp_path):
    runs_dir = tmp_path / ".runs"
    goals = [goal("s-menos"), goal("s-igual"), goal("s-falla"), goal("s-login", "barrera login", level="user_goal"),
             goal("s-sin-tanda"), goal("s-sin-ruta"), goal("s-grupo", "nivel summary", level="summary")]
    for item, steps in zip(goals[:3] + goals[4:5], (3, 2, 4, 5)):
        write_route(runs_dir, item, steps)
    write_batch(runs_dir, "s-menos", {"first_time": ("success", 2, 1.0, True), "hurried": ("failed", 6, 0.0, False)})
    write_batch(runs_dir, "s-menos", {"first_time": ("success", 9, 0.3, False)}, name="2025-01-01_00-00-00")
    write_batch(runs_dir, "s-igual", {"first_time": ("success", 2, 1.0, False)})
    write_batch(runs_dir, "s-falla", {"first_time": ("abandoned", 15, 0.0, False)})
    write_json(runs_dir / "s-menos" / "reference" / "desktop" / "proposed.json", {"status": "proposed"})
    catalog = tmp_path / ".runs" / "www.sitio.cl" / "goals" / "goals.json"
    write_json(catalog, {"host": "www.sitio.cl", "goals": goals})

    markdown = write_summary(catalog, runs_dir).read_text(encoding="utf-8")
    summary = json.loads((catalog.parent / "summary.json").read_text(encoding="utf-8"))
    assert summary["totals"] == {"goals": 7, "mapped": 4, "verified": 4, "evaluated": 3, "runs": 4, "successes": 2,
                                 "success_rate": 0.5, "spl": 0.5, "beat_reference": 1, "proposals": 1}
    rows = {row["id"]: row for row in summary["goals"]}
    assert [rows[key]["fewer"] for key in ("s-menos", "s-igual", "s-falla")] == ["evaluador", "igual", None]
    assert rows["s-menos"]["report"] == "../../s-menos/2026-01-01_00-00-00/report.md"
    assert {key: rows[key]["not_run"] for key in ("s-login", "s-sin-tanda", "s-sin-ruta", "s-grupo")} == {
        "s-login": "barrera login", "s-sin-tanda": "sin tanda (límite o error)",
        "s-sin-ruta": "sin ruta (límite o error)", "s-grupo": "nivel summary",
    }
    assert ("| `s-menos` Tarea s-menos. | user_goal | find_info | buried | easy | 3 (2 rutas) |"
            " first_time: success, 2 pasos; hurried: failed, 6 pasos | 1.00; 0.00 | evaluador (propuesta proposed) |"
            " [reporte](../../s-menos/2026-01-01_00-00-00/report.md) |") in markdown
    assert "| `s-sin-ruta` Tarea s-sin-ruta. | sin ruta (límite o error) |" in markdown
    assert "Intentos con éxito: 2/4 (50%) · SPL: 0.50" in markdown
