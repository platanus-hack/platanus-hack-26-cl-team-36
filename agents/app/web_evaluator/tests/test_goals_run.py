import asyncio

import goals_run
from goals_run import plan, run_planned
from tests.fixtures_site import goal, write_batch, write_route

PROFILES = ["first_time"]


def _skips(planned):
    return {item.goal["id"]: item.skip for item in planned}


def test_plan_runs_evaluable_goals_with_a_route_and_says_why_it_skips_the_rest(tmp_path):
    goals = [goal("s-a"), goal("s-login", "barrera login"), goal("s-sin-ruta"), goal("s-hecho"), goal("s-b"), goal("s-c")]
    for item in (goals[0], goals[3], goals[4], goals[5]):
        write_route(tmp_path, item)
    write_route(tmp_path, goal("s-sin-ruta"), status="unverified")
    write_batch(tmp_path, "s-hecho", {"first_time": ("success", 3, 1.0, False)})
    assert _skips(plan(goals, tmp_path, PROFILES, [], 2, False)) == {
        "s-a": None, "s-login": "barrera login", "s-sin-ruta": "sin ruta verificada",
        "s-hecho": "ya evaluado (--rerun para repetirlo)", "s-b": None, "s-c": "límite",
    }
    assert _skips(plan(goals, tmp_path, PROFILES, ["s-hecho"], None, True))["s-hecho"] is None
    assert _skips(plan(goals, tmp_path, PROFILES, ["s-hecho"], None, True))["s-a"] == "no pedido"
    assert _skips(plan(goals, tmp_path, ["mobile"], [], None, False))["s-a"] == "sin ruta verificada"


def test_route_for_another_instruction_does_not_count(tmp_path):
    write_route(tmp_path, goal("s-a"))
    assert _skips(plan([goal("s-a", instruction="Otra.")], tmp_path, PROFILES, [], None, False))["s-a"] == "sin ruta verificada"


def test_a_failing_batch_does_not_stop_the_rest(tmp_path, monkeypatch):
    calls = []

    async def fake_batch(**options):
        calls.append((options["task_id"], options["instruction"], options["output_dir"], options["profile_keys"]))
        if options["task_id"] == "s-a":
            raise RuntimeError("se cayó")

    monkeypatch.setattr(goals_run, "run_batch", fake_batch)
    goals = [goal("s-a"), goal("s-b", "nivel summary"), goal("s-c")]
    for item in goals:
        write_route(tmp_path, item)
    asyncio.run(run_planned(plan(goals, tmp_path, PROFILES, [], None, False), tmp_path, profile_keys=PROFILES))
    assert calls == [("s-a", "Tarea s-a.", tmp_path / "s-a", PROFILES), ("s-c", "Tarea s-c.", tmp_path / "s-c", PROFILES)]


def test_con_tema_no_se_salta_ni_se_mezcla_con_las_tandas_sin_tema(tmp_path):
    import json

    from site_summary import write_summary

    item = goal("s-a")
    write_route(tmp_path, item)
    write_batch(tmp_path, "s-a", {"first_time": ("abandoned", 9, None, False)})  # sin tema
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False))["s-a"] == "ya evaluado (--rerun para repetirlo)"
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False, tema="abc123"))["s-a"] is None

    write_batch(tmp_path, "s-a", {"first_time": ("success", 3, None, False)}, name="2026-01-02_00-00-00")
    tanda_con_tema = tmp_path / "s-a" / "2026-01-02_00-00-00"
    (tanda_con_tema / "route_tree.json").write_text(json.dumps({"tema": {"sha256": "abc123"}}), encoding="utf-8")
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False, tema="abc123"))["s-a"] == (
        "ya evaluado (--rerun para repetirlo)"
    )

    catalogo = tmp_path / "goals.json"
    catalogo.write_text(json.dumps({"host": "www.sitio.cl", "goals": [item]}), encoding="utf-8")
    sin_tema = json.loads(write_summary(catalogo, tmp_path).with_suffix(".json").read_text(encoding="utf-8"))
    con_tema = json.loads(write_summary(catalogo, tmp_path, "abc123").with_suffix(".json").read_text(encoding="utf-8"))
    assert sin_tema["goals"][0]["runs"][0]["outcome"] == "abandoned"
    assert con_tema["goals"][0]["runs"][0]["outcome"] == "success" and con_tema["tema"] == "abc123"
    assert (tmp_path / "summary-tema-abc123.md").is_file() and (tmp_path / "summary.md").is_file()
