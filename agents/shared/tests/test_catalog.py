"""Contrato del catálogo: selección de objetivos, prominencia, complejidad y lectura de sus archivos."""

import json
import re
from dataclasses import asdict
from pathlib import Path

import pytest

from shared import store
from shared.catalog import tasks
from shared.catalog.files import read_catalog, read_outline
from shared.catalog.goal import (Goal, depth, exclusion, for_revision, instruction, instruction_goal_id, is_free_goal_id, leaves_site,
                                 routable, slugify)
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


def test_revision_prefers_prominent_goals_inside_the_site_without_gates():
    goals = [
        _goal("fuera", prominence="primary", entry="https://otro.cl/x"),
        _goal("escondido", prominence="buried", entry="/ayuda"),
        _goal("con-efecto", prominence="primary", gates=["side_effect"]),
        _goal("secundario", prominence="secondary", entry="https://pagos.sitio.cl/"),
        _goal("principal", prominence="primary"),
        _goal("login", prominence="primary", gates=["login"]),
    ]
    assert [leaves_site(goal) for goal in goals[:4]] == [True, False, False, False]
    assert [goal.id for goal in for_revision(goals, None)] == ["principal", "secundario", "escondido", "con-efecto", "fuera"]
    assert [goal.id for goal in routable(goals, None)][0] == "escondido"


def test_revision_selection_of_a_real_catalog_matches_the_projector():
    # backend/test/proyectora.test.js lee el mismo archivo y espera lo mismo.
    data = json.loads((Path(__file__).parent / "data" / "catalogo-metro.json").read_text())
    fields = Goal.__dataclass_fields__
    goals = [Goal(**{key: value for key, value in raw.items() if key in fields}) for raw in data["goals"]]
    assert [goal.id for goal in for_revision(goals, data["goals_max"])] == data["expected"]
    assert [goal.id for goal in for_revision(goals, None)] == data["expected_all"]
    for limit, expected in data["expected_by_limit"].items():
        assert [goal.id for goal in for_revision(goals, int(limit))] == expected


def test_depth_bands_from_estimated_steps_or_form():
    steps = [None, 1, 2, 3, 4, 5]
    assert [depth(_goal("a", estimated_steps=value)) for value in steps] == [None, "short", "short", "medium", "medium", "long"]
    assert depth(_goal("a", submits_form=True)) == depth(_goal("a", submits_form=True, estimated_steps=1)) == "long"


def test_revision_with_8_takes_4_long_2_medium_and_2_top():
    goals = [_goal(f"top-corto-{n}", demand="top", estimated_steps=1) for n in range(4)]
    goals += [_goal(f"medio-{n}", demand="common", estimated_steps=3) for n in range(3)]
    goals += [_goal(f"largo-{n}", demand="rare", estimated_steps=6) for n in range(5)]
    chosen = [goal.id for goal in for_revision(goals, 8)]
    assert chosen == ["top-corto-0", "top-corto-1", "medio-0", "medio-1", "largo-0", "largo-1", "largo-2", "largo-3"]


def test_revision_prefers_top_tasks_and_mixes_long_and_medium_ones():
    goals = [
        _goal("raro", demand="rare", prominence="primary", estimated_steps=1),
        _goal("top-corto", demand="top", estimated_steps=1),
        _goal("top-medio", demand="top", estimated_steps=3),
        _goal("comun-largo", demand="common", estimated_steps=7),
        _goal("raro-largo", demand="rare", submits_form=True),
        _goal("comun-corto", demand="common", estimated_steps=2),
        _goal("anterior"),
    ]
    order = ["top-corto", "top-medio", "comun-largo", "comun-corto", "anterior", "raro", "raro-largo"]
    assert [goal.id for goal in for_revision(goals, None)] == order
    # La mitad, largos: con 2, uno largo aunque sea menos demandado.
    assert [goal.id for goal in for_revision(goals, 2)] == ["top-corto", "comun-largo"]
    assert [goal.id for goal in for_revision(goals, 3)] == ["top-corto", "top-medio", "comun-largo"]
    # Tres largos y uno mediano: hay dos largos, así que el que falta lo completa el mediano y el resto, el orden.
    assert [goal.id for goal in for_revision(goals, 6)] == ["top-corto", "top-medio", "comun-largo", "comun-corto",
                                                           "anterior", "raro-largo"]


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
