import asyncio
import json

from shared.catalog.goal import Goal

from visitor import catalog_run
from visitor.catalog_run import plan, run_planned

PROFILES = ["first_time"]
START = "https://www.sitio.cl/"


def goal(goal_id: str, exclusion: str | None = None, instruction: str | None = None) -> Goal:
    return Goal(id=goal_id, host="www.sitio.cl", start_url=START, description=f"Tarea {goal_id}.", expected_answer=None,
                level="user_goal", parent=None, intent="find_info", evidence=[START], entry=None,
                instruction=instruction or f"Tarea {goal_id}.", exclusion=exclusion)


def write_route(runs_dir, item: Goal, status: str = "verified") -> None:
    path = runs_dir / item.id / "reference" / "desktop" / "route.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"status": status, "start_url": item.start_url, "instruction": item.instruction,
                                "viewport": "desktop"}), encoding="utf-8")


def write_report(runs_dir, goal_id: str) -> None:
    batch = runs_dir / goal_id / "2026-01-01_00-00-00"
    batch.mkdir(parents=True)
    (batch / "report.md").write_text("# Reporte", encoding="utf-8")


def _skips(planned):
    return {item.goal.id: item.skip for item in planned}


def test_plan_runs_evaluable_goals_with_a_route_and_says_why_it_skips_the_rest(tmp_path):
    goals = [goal("s-a"), goal("s-login", "barrera login"), goal("s-sin-ruta"), goal("s-hecho"), goal("s-b"), goal("s-c")]
    for item in (goals[0], goals[3], goals[4], goals[5]):
        write_route(tmp_path, item)
    write_route(tmp_path, goal("s-sin-ruta"), status="unverified")
    write_report(tmp_path, "s-hecho")
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

    monkeypatch.setattr(catalog_run, "run_batch", fake_batch)
    goals = [goal("s-a"), goal("s-b", "nivel summary"), goal("s-c")]
    for item in goals:
        write_route(tmp_path, item)
    asyncio.run(run_planned(plan(goals, tmp_path, PROFILES, [], None, False), tmp_path, profile_keys=PROFILES))
    assert calls == [("s-a", "Tarea s-a.", tmp_path / "s-a", PROFILES), ("s-c", "Tarea s-c.", tmp_path / "s-c", PROFILES)]


def test_con_tema_no_se_salta_ni_se_mezcla_con_las_tandas_sin_tema(tmp_path):
    item = goal("s-a")
    write_route(tmp_path, item)
    write_report(tmp_path, "s-a")  # sin tema
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False))["s-a"] == "ya evaluado (--rerun para repetirlo)"
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False, tema="abc123"))["s-a"] is None

    tanda_con_tema = tmp_path / "s-a" / "2026-01-02_00-00-00"
    tanda_con_tema.mkdir()
    (tanda_con_tema / "report.md").write_text("# Reporte", encoding="utf-8")
    (tanda_con_tema / "route_tree.json").write_text(json.dumps({"tema": {"sha256": "abc123"}}), encoding="utf-8")
    assert _skips(plan([item], tmp_path, PROFILES, [], None, False, tema="abc123"))["s-a"] == (
        "ya evaluado (--rerun para repetirlo)"
    )
