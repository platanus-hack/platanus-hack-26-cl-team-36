import asyncio

from shared import store
from shared.catalog.goal import Goal

from visitor import catalog_run
from visitor.catalog_run import plan, run_planned

PROFILES = ["desktop"]
START = "https://www.sitio.cl/"


def goal(goal_id: str, exclusion: str | None = None, instruction: str | None = None) -> Goal:
    return Goal(id=goal_id, host="www.sitio.cl", start_url=START, description=f"Tarea {goal_id}.", expected_answer=None,
                level="user_goal", parent=None, intent="find_info", evidence=[START], entry=None,
                instruction=instruction or f"Tarea {goal_id}.", exclusion=exclusion)


def write_route(backend, item: Goal, status: str = "verified") -> store.RunKey:
    run = store.start_run(backend, store.guide(item.start_url, item.id, "desktop"), model="m")
    backend.write_json(run.key.file("route.json"), {"status": status, "start_url": item.start_url,
                                                    "instruction": item.instruction, "viewport": "desktop"})
    store.finish_run(backend, run, "succeeded")
    return run.key


def write_visit(backend, goal_id: str, instruction: str | None = None, status: str = "succeeded",
                tema: str | None = None, conjunto_exploradores: str | None = None) -> None:
    run = store.start_run(backend, store.visitor(START, goal_id), model="m")
    backend.write_json(run.key.file("route_tree.json"), {"url": START, "instruction": instruction or f"Tarea {goal_id}.",
                                                         "tema": {"sha256": tema} if tema else None,
                                                         "conjunto_exploradores": conjunto_exploradores})
    store.finish_run(backend, run, status)


def _skips(planned):
    return {item.goal.id: item.skip for item in planned}


def test_plan_runs_evaluable_goals_with_a_route_and_says_why_it_skips_the_rest(tmp_path):
    backend = store.LocalBackend(tmp_path)
    goals = [goal("s-a"), goal("s-login", "barrera login"), goal("s-sin-ruta"), goal("s-hecho"), goal("s-b"), goal("s-c")]
    for item in (goals[0], goals[3], goals[4], goals[5]):
        write_route(backend, item)
    write_route(backend, goal("s-sin-ruta"), status="unverified")
    write_visit(backend, "s-hecho")
    assert _skips(plan(backend, goals, PROFILES, [], 2, False)) == {
        "s-a": None, "s-login": "barrera login", "s-sin-ruta": "sin ruta verificada",
        "s-hecho": "ya evaluado (--rerun para repetirlo)", "s-b": None, "s-c": "límite",
    }
    assert _skips(plan(backend, goals, PROFILES, ["s-hecho"], None, True))["s-hecho"] is None
    assert _skips(plan(backend, goals, PROFILES, ["s-hecho"], None, True))["s-a"] == "no pedido"
    assert _skips(plan(backend, goals, ["mobile"], [], None, False))["s-a"] is None  # se mide con la de escritorio
    assert _skips(plan(backend, goals, ["explorador"], [], None, False))["s-a"] == "sin ruta verificada"


def test_a_visit_for_another_instruction_or_one_that_failed_does_not_count(tmp_path):
    backend = store.LocalBackend(tmp_path)
    for name in ("s-a", "s-b"):
        write_route(backend, goal(name))
    write_visit(backend, "s-a", instruction="Una tarea libre que reutilizó el id.")
    write_visit(backend, "s-b", status="failed")
    assert _skips(plan(backend, [goal("s-a"), goal("s-b")], PROFILES, [], None, False)) == {"s-a": None, "s-b": None}


def test_route_for_another_instruction_does_not_count(tmp_path):
    backend = store.LocalBackend(tmp_path)
    write_route(backend, goal("s-a"))
    assert _skips(plan(backend, [goal("s-a", instruction="Otra.")], PROFILES, [], None, False))["s-a"] == "sin ruta verificada"


def test_a_failing_batch_does_not_stop_the_rest_and_each_names_its_inputs(tmp_path, monkeypatch):
    calls = []

    async def fake_batch(backend, prefix, url, instruction, references, inputs, profile_keys):
        calls.append((prefix.goal, instruction, inputs, [key for key, _ in references.values()], profile_keys))
        if prefix.goal == "s-a":
            raise RuntimeError("se cayó")

    monkeypatch.setattr(catalog_run, "run_batch", fake_batch)
    backend = store.LocalBackend(tmp_path)
    catalog = store.cataloger(START).run("2026-01-01T00-00-00Z")
    goals = [goal("s-a"), goal("s-b", "nivel summary"), goal("s-c")]
    routes = [write_route(backend, item) for item in goals]
    planned = plan(backend, goals, PROFILES, [], None, False)
    asyncio.run(run_planned(backend, planned, catalog, profile_keys=PROFILES))
    assert calls == [("s-a", "Tarea s-a.", (catalog,), [routes[0]], PROFILES),
                     ("s-c", "Tarea s-c.", (catalog,), [routes[2]], PROFILES)]


def test_con_tema_no_se_salta_ni_se_mezcla_con_las_corridas_sin_tema(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    write_route(backend, item)
    write_visit(backend, "s-a")  # sin tema
    assert _skips(plan(backend, [item], PROFILES, [], None, False))["s-a"] == "ya evaluado (--rerun para repetirlo)"
    assert _skips(plan(backend, [item], PROFILES, [], None, False, tema="abc123"))["s-a"] is None

    write_visit(backend, "s-a", tema="abc123")
    assert _skips(plan(backend, [item], PROFILES, [], None, False, tema="abc123"))["s-a"] == (
        "ya evaluado (--rerun para repetirlo)"
    )
    assert _skips(plan(backend, [item], PROFILES, [], None, False, tema="otro"))["s-a"] is None


def test_con_un_conjunto_de_exploradores_no_se_salta_ni_se_mezcla_con_las_corridas_sin_el(tmp_path):
    backend = store.LocalBackend(tmp_path)
    item = goal("s-a")
    write_route(backend, item)
    write_visit(backend, "s-a", conjunto_exploradores="conocimiento")
    assert _skips(plan(backend, [item], PROFILES, [], None, False))["s-a"] is None
    assert _skips(plan(backend, [item], PROFILES, [], None, False, None, "conocimiento"))["s-a"] == (
        "ya evaluado (--rerun para repetirlo)"
    )
    assert _skips(plan(backend, [item], PROFILES, [], None, False, None, "base"))["s-a"] is None
