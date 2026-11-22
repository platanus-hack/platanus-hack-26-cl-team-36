from datetime import timedelta

from shared import store

from summary.site import write_summary
from tests.fixtures_site import NOW, START, goal, write_batch, write_catalog, write_route


def _summary(backend: store.Backend) -> tuple[store.RunKey, dict, str]:
    run = write_summary(backend, START)
    return run, backend.read_json(run.file("summary.json")), backend.read_text(run.file("summary.md"))


def test_summary_from_the_latest_runs_names_its_inputs(tmp_path):
    backend = store.LocalBackend(tmp_path)
    goals = [goal("s-menos"), goal("s-igual"), goal("s-falla"), goal("s-login", gates=["login"]),
             goal("s-sin-tanda"), goal("s-sin-ruta"), goal("s-grupo", level="summary")]
    catalog = write_catalog(backend, goals)
    for item, steps in zip(goals[:3] + goals[4:5], (3, 2, 4, 5)):
        write_route(backend, item, steps)
    write_batch(backend, "s-menos", {"first_time": ("success", 9, 0.3, False)}, NOW - timedelta(days=1))
    latest = write_batch(backend, "s-menos", {"first_time": ("success", 2, 1.0, True), "hurried": ("failed", 6, 0.0, False)},
                         proposals=True)
    write_batch(backend, "s-igual", {"first_time": ("success", 2, 1.0, False)})
    write_batch(backend, "s-falla", {"first_time": ("abandoned", 15, 0.0, False)})

    run, summary, markdown = _summary(backend)
    assert summary["totals"] == {"goals": 7, "mapped": 4, "verified": 4, "evaluated": 3, "runs": 4, "successes": 2,
                                 "interrupted": 0, "success_rate": 0.5, "spl": 0.5, "beat_reference": 1, "proposals": 1}
    rows = {row["id"]: row for row in summary["goals"]}
    assert [rows[key]["fewer"] for key in ("s-menos", "s-igual", "s-falla")] == ["visitante", "igual", None]
    report = f"../../visitor/s-menos/{latest.run_id}/report.md"
    assert rows["s-menos"]["report"] == report
    assert {key: rows[key]["not_run"] for key in ("s-login", "s-sin-tanda", "s-sin-ruta", "s-grupo")} == {
        "s-login": "barrera login", "s-sin-tanda": "sin tanda (límite o error)",
        "s-sin-ruta": "sin ruta (límite o error)", "s-grupo": "nivel summary",
    }
    assert ("| `s-menos` Tarea s-menos. | user_goal | find_info | buried | easy | 3 (2 rutas) |"
            " first_time: success, 2 pasos; hurried: failed, 6 pasos | 1.00; 0.00 | visitante (propuesta proposed) |"
            f" [reporte]({report}) |") in markdown
    assert "| `s-sin-ruta` Tarea s-sin-ruta. | sin ruta (límite o error) |" in markdown
    assert "Intentos con éxito: 2/4 (50%) · interrumpidos: 0 · SPL: 0.50" in markdown
    inputs = store.read_manifest(backend, run).inputs
    assert inputs[0] == str(catalog) and str(latest) in inputs and len(inputs) == 1 + 4 + 3


def test_a_verified_route_sets_prominence_and_complexity_and_adoption_is_promoted(tmp_path):
    backend = store.LocalBackend(tmp_path)
    deep = {"target": {"href": START + "baja"}, "in_viewport": False, "changes_node": True}
    goals = [goal("s-ruta", prominence="primary"), goal("s-sin-verificar", prominence="primary"), goal("s-sin-ruta")]
    write_catalog(backend, goals, [{"text": "Baja", "href": START + "baja", "zone": "footer", "visible": True,
                                    "top": 5000}])
    visit = write_batch(backend, "s-ruta", {"first_time": ("success", 4, 1.0, False)}, NOW - timedelta(days=1))
    write_route(backend, goals[0], min_steps=7, steps=[deep], inputs=(visit,))
    write_route(backend, goals[1], status="not_found", steps=[deep])
    rows = {row["id"]: row for row in _summary(backend)[1]["goals"]}
    assert [(rows[key]["prominence"], rows[key]["complexity"]) for key in rows] == [
        ("buried", "medium"), ("primary", None), ("buried", None)]
    assert rows["s-ruta"]["proposal"] == "promoted"


def test_con_tema_solo_cuenta_las_tandas_de_ese_tema(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    write_catalog(backend, [item])
    write_route(backend, item, 3)
    write_batch(backend, "s-a", {"first_time": ("abandoned", 9, None, False)}, NOW - timedelta(days=1))
    write_batch(backend, "s-a", {"first_time": ("success", 3, None, False)}, tema="abc123")

    sin_tema = backend.read_json(write_summary(backend, START).file("summary.json"))
    con_tema = backend.read_json(write_summary(backend, START, "abc123").file("summary.json"))
    assert sin_tema["goals"][0]["runs"][0]["outcome"] == "abandoned" and sin_tema["tema"] is None
    assert con_tema["goals"][0]["runs"][0]["outcome"] == "success" and con_tema["tema"] == "abc123"


def test_las_tandas_de_exploradores_no_son_la_vigente_del_resumen(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    write_catalog(backend, [item])
    write_route(backend, item, 3)
    write_batch(backend, "s-a", {"first_time": ("abandoned", 9, None, False)}, NOW - timedelta(days=1))
    write_batch(backend, "s-a", {"explorador": ("success", 3, None, False)}, conjunto_exploradores="base")

    resumen = backend.read_json(write_summary(backend, START).file("summary.json"))
    assert [run["outcome"] for run in resumen["goals"][0]["runs"]] == ["abandoned"]


def test_interrupted_attempts_do_not_count_as_failures(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    write_catalog(backend, [item])
    write_route(backend, item)
    write_batch(backend, "s-a", {"first_time": ("success", 3, 1.0, False), "mobile": ("interrupted", 1, None, False)})
    _, summary, markdown = _summary(backend)
    assert {key: summary["totals"][key] for key in ("runs", "interrupted", "successes", "success_rate", "spl")} == {
        "runs": 1, "interrupted": 1, "successes": 1, "success_rate": 1.0, "spl": 1.0}
    assert "mobile: interrupted, 1 pasos" in markdown and "Intentos con éxito: 1/1 (100%) · interrumpidos: 1" in markdown


def test_routes_of_both_viewports_are_inputs_and_another_instruction_does_not_hide_them(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    catalog = write_catalog(backend, [item])
    desktop = write_route(backend, item)
    mobile = write_route(backend, item, viewport="mobile")
    write_route(backend, item, instruction="Una tarea libre con el mismo id.", moment=NOW + timedelta(hours=1))
    run, summary, _ = _summary(backend)
    assert summary["goals"][0]["route_status"] == "verified"
    assert store.read_manifest(backend, run).inputs == (str(catalog), str(desktop), str(mobile))
