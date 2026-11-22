"""Contrato del catálogo: selección de objetivos, prominencia, complejidad y lectura de sus archivos."""

import json
import re
from dataclasses import asdict

import pytest

from shared import store
from shared.catalog import tasks
from shared.catalog.files import read_catalog, read_outline
from shared.catalog.goal import Goal, exclusion, instruction, instruction_goal_id, is_free_goal_id, routable, slugify
from shared.catalog.outline import Link, PageOutline, SiteOutline
from shared.catalog.prominence import complexity, link_prominence, prominence, route_prominence

START = "https://www.sitio.cl/"
HELP = "https://www.sitio.cl/ayuda/"
LOGIN = "https://www.sitio.cl/ingreso/"
HEIGHT = 768

OUTLINE = SiteOutline(START, "www.sitio.cl", "1024x768", [
    PageOutline(START, START, 0, [], [
        Link("Ayuda", HELP, "footer", True, 3000),
        Link("Ayuda", HELP, "nav", False, 0),
        Link("Ingresar", LOGIN, "nav", True, 20),
    ], [], [], False),
], [])


def _goal(goal_id: str, **changes) -> Goal:
    fields = {"id": goal_id, "host": "sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [HELP], "entry": None}
    return Goal(**{**fields, **changes})


def test_link_prominence_cut_offs():
    assert link_prominence(Link("a", START, "main", True, 700), HEIGHT) == "primary"
    assert link_prominence(Link("a", START, "main", True, 2000), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "nav", False, 0), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "main", True, 2400), HEIGHT) == "buried"
    assert link_prominence(Link("a", START, "footer", False, 0), HEIGHT) == "buried"


def test_goal_prominence_uses_the_most_prominent_occurrence_of_its_entry():
    assert prominence(_goal("a", entry=HELP), OUTLINE, HEIGHT) == "secondary"
    assert prominence(_goal("b", entry=LOGIN), OUTLINE, HEIGHT) == "primary"
    assert prominence(_goal("c"), OUTLINE, HEIGHT) == "buried"


def _route_step(href, in_viewport, changes_node=True):
    return {"target": {"href": href}, "in_viewport": in_viewport, "changes_node": changes_node}


def test_route_prominence_comes_from_the_first_element_used_on_the_start_page():
    scroll = {"target": None, "in_viewport": None, "changes_node": False}
    assert route_prominence([scroll, _route_step(HELP, True)], OUTLINE, HEIGHT) == "primary"
    assert route_prominence([_route_step(HELP, False), _route_step("x", True)], OUTLINE, HEIGHT) == "secondary"
    assert route_prominence([_route_step(None, True, False), _route_step(LOGIN, True)], OUTLINE, HEIGHT) == "secondary"
    assert route_prominence([_route_step(HELP + "baja", False)], OUTLINE, HEIGHT) == "buried"
    assert route_prominence([scroll], OUTLINE, HEIGHT) is None and route_prominence([], OUTLINE, HEIGHT) is None


def test_complexity_bands():
    assert [complexity(steps) for steps in (None, 5, 6, 10, 11)] == [None, "easy", "medium", "medium", "hard"]


def test_routable_order_buried_first_then_id_without_blocking_gates():
    goals = [
        _goal("z", prominence="buried"),
        _goal("a", prominence="primary"),
        _goal("b", prominence="buried"),
        _goal("m", prominence="secondary", gates=["side_effect"]),
        _goal("login", prominence="buried", gates=["login"]),
        _goal("grupo", prominence="buried", level="summary"),
        _goal("buscar", prominence="buried", level="subfunction"),
    ]
    assert [goal.id for goal in routable(goals, 10)] == ["b", "z", "m", "a"]
    assert [goal.id for goal in routable(goals, 2)] == ["b", "z"]
    assert len(routable(goals, None)) == 4
    assert [exclusion(goal) for goal in goals[3:6]] == [None, "barrera login", "nivel summary"]


def test_transact_routes_stop_before_submitting():
    assert instruction(_goal("a")) == "x"
    assert "sin hacerlo" in instruction(_goal("b", intent="transact"))
    assert instruction(_goal("c", intent="reach_page")).endswith("cita su título o encabezado principal.")


def test_catalog_files_are_read_with_current_rules(tmp_path):
    backend = store.LocalBackend(tmp_path)
    run = store.start_run(backend, store.cataloger(START), model=None)
    goal = {**asdict(_goal("baja", gates=["login"])), "instruction": "vieja", "exclusion": None, "retired": 1}
    backend.write_json(run.key.file("goals.json"), {"host": "sitio.cl", "issues": ["x"], "goals": [goal]})
    backend.write_json(run.key.file("outline.json"), asdict(OUTLINE))
    meta, goals, issues = read_catalog(backend, run.key)
    assert meta == {"host": "sitio.cl"} and issues == ["x"]
    assert (goals[0].instruction, goals[0].exclusion) == ("x", "barrera login")
    assert read_outline(backend, run.key) == OUTLINE


def test_a_task_is_a_goal_of_its_host(tmp_path, monkeypatch):
    (tmp_path / "sitio.cl").mkdir()
    (tmp_path / "sitio.cl" / "baja.json").write_text(json.dumps(
        {"id": "baja", "host": "sitio.cl", "start_url": START, "description": "Da de baja."}), encoding="utf-8")
    monkeypatch.setattr(tasks, "TASKS_DIR", tmp_path)
    assert tasks.available_tasks() == ["sitio.cl/baja"] and tasks.task_ids("sitio.cl") == {"baja"}
    assert tasks.load_task("sitio.cl/baja").ref == "sitio.cl/baja"
    assert tasks.load_task("sitio.cl/otra") is None and tasks.load_task("../sitio.cl/baja") is None


def test_free_goal_ids_are_reserved_stable_bounded_and_never_empty():
    assert slugify("  Exención de Contribuciones!") == "exencion-de-contribuciones"
    long = "Tienes 67 años: encuentra hasta cuándo puedes pedir la exención de contribuciones"
    goal_id = instruction_goal_id(long)
    assert goal_id.startswith("libre-tienes-67-anos-encuentra-") and len(goal_id) <= 55 and is_free_goal_id(goal_id)
    assert instruction_goal_id(f"  {long} ") == goal_id != instruction_goal_id(long + " Otra.")
    assert re.fullmatch(r"libre-[0-9a-f]{8}", instruction_goal_id("Найдите часы работы"))
    store.visitor("sitio.cl", goal_id)
    with pytest.raises(ValueError):
        instruction_goal_id("   ")


def test_tasks_with_the_free_prefix_are_ignored(tmp_path, monkeypatch):
    (tmp_path / "sitio.cl").mkdir()
    (tmp_path / "sitio.cl" / "libre-baja-0a1b2c3d.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tasks, "TASKS_DIR", tmp_path)
    assert tasks.available_tasks() == [] and tasks.load_task("sitio.cl/libre-baja-0a1b2c3d") is None


def test_las_tareas_del_repo_cargan_con_su_conocimiento():
    """Los campos de los exploradores con nivel de conocimiento son opcionales y no rompen load_task."""
    refs = tasks.available_tasks()
    assert refs
    for ref in refs:
        task = tasks.load_task(ref)
        assert task is not None and isinstance(task.terminos_oficiales, tuple)
