"""Contrato del catálogo: selección de objetivos, prominencia, complejidad y lectura de sus archivos."""

import json
from dataclasses import asdict

from shared.catalog.files import read_catalog, read_outline
from shared.catalog.goal import Goal, exclusion, instruction, routable
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
    fields = {"id": goal_id, "host": "www.sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [HELP], "entry": None}
    return Goal(**{**fields, **changes})


def test_link_prominence_cut_offs():
    assert link_prominence(Link("a", START, "main", True, 700), HEIGHT) == "primary"
    assert link_prominence(Link("a", START, "main", True, 2000), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "nav", False, 0), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "main", True, 2400), HEIGHT) == "buried"
    assert link_prominence(Link("a", START, "footer", False, 0), HEIGHT) == "buried"


def test_goal_prominence_uses_the_most_prominent_occurrence_of_its_entry():
    assert prominence(_goal("sitio-a", entry=HELP), OUTLINE, HEIGHT) == "secondary"
    assert prominence(_goal("sitio-b", entry=LOGIN), OUTLINE, HEIGHT) == "primary"
    assert prominence(_goal("sitio-c"), OUTLINE, HEIGHT) == "buried"


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
        _goal("sitio-z", prominence="buried"),
        _goal("sitio-a", prominence="primary"),
        _goal("sitio-b", prominence="buried"),
        _goal("sitio-m", prominence="secondary", gates=["side_effect"]),
        _goal("sitio-login", prominence="buried", gates=["login"]),
        _goal("sitio-grupo", prominence="buried", level="summary"),
        _goal("sitio-buscar", prominence="buried", level="subfunction"),
    ]
    assert [goal.id for goal in routable(goals, 10)] == ["sitio-b", "sitio-z", "sitio-m", "sitio-a"]
    assert [goal.id for goal in routable(goals, 2)] == ["sitio-b", "sitio-z"]
    assert len(routable(goals, None)) == 4
    assert [exclusion(goal) for goal in goals[3:6]] == [None, "barrera login", "nivel summary"]


def test_transact_routes_stop_before_submitting():
    assert instruction(_goal("sitio-a")) == "x"
    assert "sin hacerlo" in instruction(_goal("sitio-b", intent="transact"))
    assert instruction(_goal("sitio-c", intent="reach_page")).endswith("cita su título o encabezado principal.")


def test_catalog_files_are_read_with_current_rules(tmp_path):
    goal = {**asdict(_goal("sitio-baja", gates=["login"])), "instruction": "vieja", "exclusion": None, "retired": 1}
    (tmp_path / "goals.json").write_text(json.dumps({"host": "www.sitio.cl", "issues": ["x"], "goals": [goal]}),
                                         encoding="utf-8")
    (tmp_path / "outline.json").write_text(json.dumps(asdict(OUTLINE)), encoding="utf-8")
    meta, goals, issues = read_catalog(tmp_path / "goals.json")
    assert meta == {"host": "www.sitio.cl"} and issues == ["x"]
    assert (goals[0].instruction, goals[0].exclusion) == ("x", "barrera login")
    assert read_outline(tmp_path / "outline.json") == OUTLINE
