import json

from summary.site import write_summary
from tests.fixtures_site import START, goal, write_batch, write_catalog, write_json, write_route


def test_summary_from_files_on_disk(tmp_path):
    runs_dir = tmp_path / ".runs"
    goals = [goal("s-menos"), goal("s-igual"), goal("s-falla"), goal("s-login", gates=["login"]),
             goal("s-sin-tanda"), goal("s-sin-ruta"), goal("s-grupo", level="summary")]
    for item, steps in zip(goals[:3] + goals[4:5], (3, 2, 4, 5)):
        write_route(runs_dir, item, steps)
    write_batch(runs_dir, "s-menos", {"first_time": ("success", 2, 1.0, True), "hurried": ("failed", 6, 0.0, False)})
    write_batch(runs_dir, "s-menos", {"first_time": ("success", 9, 0.3, False)}, name="2025-01-01_00-00-00")
    write_batch(runs_dir, "s-igual", {"first_time": ("success", 2, 1.0, False)})
    write_batch(runs_dir, "s-falla", {"first_time": ("abandoned", 15, 0.0, False)})
    write_json(runs_dir / "s-menos" / "reference" / "desktop" / "proposed.json", {"status": "proposed"})
    catalog = write_catalog(tmp_path / ".runs" / "www.sitio.cl" / "goals", goals)

    markdown = write_summary(catalog, runs_dir).read_text(encoding="utf-8")
    summary = json.loads((catalog.parent / "summary.json").read_text(encoding="utf-8"))
    assert summary["totals"] == {"goals": 7, "mapped": 4, "verified": 4, "evaluated": 3, "runs": 4, "successes": 2,
                                 "success_rate": 0.5, "spl": 0.5, "beat_reference": 1, "proposals": 1}
    rows = {row["id"]: row for row in summary["goals"]}
    assert [rows[key]["fewer"] for key in ("s-menos", "s-igual", "s-falla")] == ["visitante", "igual", None]
    assert rows["s-menos"]["report"] == "../../s-menos/2026-01-01_00-00-00/report.md"
    assert {key: rows[key]["not_run"] for key in ("s-login", "s-sin-tanda", "s-sin-ruta", "s-grupo")} == {
        "s-login": "barrera login", "s-sin-tanda": "sin tanda (límite o error)",
        "s-sin-ruta": "sin ruta (límite o error)", "s-grupo": "nivel summary",
    }
    assert ("| `s-menos` Tarea s-menos. | user_goal | find_info | buried | easy | 3 (2 rutas) |"
            " first_time: success, 2 pasos; hurried: failed, 6 pasos | 1.00; 0.00 | visitante (propuesta proposed) |"
            " [reporte](../../s-menos/2026-01-01_00-00-00/report.md) |") in markdown
    assert "| `s-sin-ruta` Tarea s-sin-ruta. | sin ruta (límite o error) |" in markdown
    assert "Intentos con éxito: 2/4 (50%) · SPL: 0.50" in markdown


def test_a_verified_route_sets_prominence_and_complexity(tmp_path):
    runs_dir = tmp_path / ".runs"
    deep = {"target": {"href": START + "baja"}, "in_viewport": False, "changes_node": True}
    goals = [goal("s-ruta", prominence="primary"), goal("s-sin-verificar", prominence="primary"), goal("s-sin-ruta")]
    write_route(runs_dir, goals[0], min_steps=7, steps=[deep])
    write_route(runs_dir, goals[1], status="not_found", steps=[deep])
    catalog = write_catalog(tmp_path / "catalogo", goals, [{"text": "Baja", "href": START + "baja", "zone": "footer",
                                                             "visible": True, "top": 5000}])
    write_summary(catalog, runs_dir)
    rows = {row["id"]: row for row in json.loads((catalog.parent / "summary.json").read_text(encoding="utf-8"))["goals"]}
    assert [(rows[key]["prominence"], rows[key]["complexity"]) for key in rows] == [
        ("buried", "medium"), ("primary", None), ("buried", None)]


def test_con_tema_solo_cuenta_las_tandas_de_ese_tema(tmp_path):
    item = goal("s-a")
    write_route(tmp_path, item)
    write_batch(tmp_path, "s-a", {"first_time": ("abandoned", 9, None, False)})  # sin tema
    write_batch(tmp_path, "s-a", {"first_time": ("success", 3, None, False)}, name="2026-01-02_00-00-00")
    write_json(tmp_path / "s-a" / "2026-01-02_00-00-00" / "route_tree.json", {"tema": {"sha256": "abc123"}})
    catalog = write_catalog(tmp_path / "catalogo", [item])

    sin_tema = json.loads(write_summary(catalog, tmp_path).with_suffix(".json").read_text(encoding="utf-8"))
    con_tema = json.loads(write_summary(catalog, tmp_path, "abc123").with_suffix(".json").read_text(encoding="utf-8"))
    assert sin_tema["goals"][0]["runs"][0]["outcome"] == "abandoned"
    assert con_tema["goals"][0]["runs"][0]["outcome"] == "success" and con_tema["tema"] == "abc123"
    assert (catalog.parent / "summary-tema-abc123.md").is_file() and (catalog.parent / "summary.md").is_file()
