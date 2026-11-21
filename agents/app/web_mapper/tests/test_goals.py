"""Catálogo sin Claude: validación de lo que propone el modelo, reglas deterministas y selección de rutas."""

import argparse
import asyncio
import json
from contextlib import asynccontextmanager

import pytest

from mapper import config, goal_routes, goals_command, reference
from mapper.catalog import propose_goals, render_outline, system_prompt
from mapper.goal_routes import resume_routes, route_path, route_summary
from mapper.goal_rules import (
    complexity, gates, id_prefix, link_prominence, page_gates, prominence, route_prominence, validate,
)
from mapper.goals import Goal, exclusion, instruction, routable
from mapper.goals_output import goals_markdown, read_catalog, write_catalog
from mapper.outline import Field, Form, Link, PageOutline, SiteOutline

START = "https://www.sitio.cl/"
HELP = "https://www.sitio.cl/ayuda/"
LOGIN = "https://www.sitio.cl/ingreso/"
FORM = "https://www.sitio.cl/te-llamamos/"
HEIGHT = 768


def _page(url: str, links: list[Link], gates: list[str] | None = None) -> PageOutline:
    return PageOutline(url, url, 0, [], links, [], [], False, gates or [])


OUTLINE = SiteOutline(START, "www.sitio.cl", "1024x768", [
    _page(START, [
        Link("Ayuda", HELP, "footer", True, 3000),
        Link("Ayuda", HELP, "nav", False, 0),
        Link("Ingresar", LOGIN, "nav", True, 20),
    ]),
    _page(HELP, [Link("Ingresar", LOGIN, "nav", True, 20), Link("Baja", HELP + "baja", "main", True, 400)]),
    _page(LOGIN, [], ["login"]),
    _page(FORM, [], ["personal_data"]),
], [])


def _raw(goal_id: str, **changes) -> dict:
    return {"id": goal_id, "description": "Encuentra algo.", "level": "user_goal", "parent": None,
            "intent": "find_info", "evidence": [HELP], "entry": HELP, **changes}


def _goal(goal_id: str, **changes) -> Goal:
    fields = {"id": goal_id, "host": "www.sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [HELP], "entry": None}
    return Goal(**{**fields, **changes})


def test_validation_repairs_or_drops_invalid_goals_and_says_why():
    goals, issues = validate([
        _raw("sitio-gestionar", level="summary", entry=None),
        _raw("baja", parent="sitio-gestionar"),
        _raw("sitio-baja"),
        _raw("sitio-raro", level="epic"),
        _raw("sitio-inventado", evidence=["https://www.sitio.cl/no-existe/"]),
        _raw("sitio-entrada", entry="https://www.sitio.cl/oculto/", evidence=["https://sitio.cl/ayuda"]),
        _raw("sitio-huerfano", parent="sitio-baja"),
    ], OUTLINE)
    assert [goal.id for goal in goals] == ["sitio-gestionar", "sitio-baja", "sitio-entrada", "sitio-huerfano"]
    assert goals[1].parent == "sitio-gestionar"
    assert goals[2].entry is None and goals[2].evidence == [HELP]
    assert goals[3].parent is None
    assert len(issues) == 6
    assert all(any(goal_id in issue for issue in issues)
               for goal_id in ("baja", "sitio-raro", "sitio-inventado", "sitio-entrada", "sitio-huerfano"))


def test_parent_is_normalised_like_the_id_and_summaries_do_not_nest():
    goals, issues = validate([
        _raw("gestionar", level="summary", entry=None, parent="sitio-otro-grupo"),
        _raw("sitio-otro-grupo", level="summary", entry=None, parent="gestionar"),
        _raw("sitio-baja", parent="gestionar"),
    ], OUTLINE, reserved=set())
    assert [(goal.id, goal.parent) for goal in goals] == [
        ("sitio-gestionar", None), ("sitio-otro-grupo", None), ("sitio-baja", "sitio-gestionar"),
    ]
    assert sum("un summary no tiene padre" in issue for issue in issues) == 2


def test_ids_of_existing_tasks_are_renamed(tmp_path, monkeypatch):
    (tmp_path / "sitio-grupo.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(config, "TASKS_DIR", tmp_path)
    goals, issues = validate([
        _raw("sitio-grupo", level="summary", entry=None),
        _raw("sitio-grupo-2", parent="sitio-grupo"),
        _raw("sitio-baja", parent="grupo"),
    ], OUTLINE)
    assert [(goal.id, goal.parent) for goal in goals] == [
        ("sitio-grupo-3", None), ("sitio-grupo-2", "sitio-grupo-3"), ("sitio-baja", "sitio-grupo-3"),
    ]
    assert any("agents/tasks/" in issue and "sitio-grupo-3" in issue for issue in issues)
    assert '"sitio-horario-sucursal"' in system_prompt("sitio") and "baja-fibra" not in system_prompt("sitio")


def test_personal_data_signal_ignores_search_boxes_selects_and_names_of_things():
    def signals(*fields):
        return page_gates(PageOutline(START, "x", 0, [], [], [Form("get", "main", list(fields))], [], False))

    assert signals(Field("Nombre completo", "text", "")) == ["personal_data"]
    assert signals(Field("nombre_cliente", "text", "")) == ["personal_data"]
    assert signals(Field("Correo", "email", "")) == ["personal_data"]
    assert signals(Field("Nombre de la empresa", "text", "")) == []
    assert signals(Field("Buscar por nombre del trámite", "text", "")) == []
    assert signals(Field("Clave", "text", "new-password")) == ["login"]
    assert signals(Field("Nombre", "search", "")) == []
    assert signals(Field("Dirección regional", "select", "")) == []
    assert page_gates(PageOutline(START, "x", 0, [], [], [Form("post", "footer", [Field("RUT", "text", "")])], [], True)) \
        == ["bot_check"]


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


def test_verified_route_replaces_the_entry_prominence(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AGENTS_DIR", tmp_path)
    (tmp_path / "route.json").write_text(json.dumps({"steps": [_route_step(HELP + "baja", False)]}), encoding="utf-8")
    verified = _goal("sitio-a", prominence="primary", reference_route={"status": "verified", "route": "route.json"})
    unverified = _goal("sitio-b", prominence="primary", reference_route={"status": "not_found", "route": "route.json"})
    goals_command._update_prominence([verified, unverified], OUTLINE, HEIGHT)
    assert (verified.prominence, unverified.prominence) == ("buried", "primary")


def test_gates_come_from_own_evidence_pages_and_transact():
    assert gates(_goal("sitio-a", evidence=[START, LOGIN]), OUTLINE) == ["login"]
    assert gates(_goal("sitio-b", evidence=[START, HELP], intent="transact"), OUTLINE) == ["side_effect"]
    assert gates(_goal("sitio-c", evidence=[HELP]), OUTLINE) == []
    assert gates(_goal("sitio-d", evidence=[FORM]), OUTLINE) == []
    assert gates(_goal("sitio-e", evidence=[FORM], intent="transact"), OUTLINE) == ["personal_data", "side_effect"]
    assert gates(_goal("sitio-f", evidence=[FORM], submits_form=True), OUTLINE) == ["personal_data"]
    assert gates(_goal("sitio-g", evidence=[FORM], intent="reach_page"), OUTLINE) == []


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


def test_outline_text_lists_each_link_once_and_the_page_gates():
    text = render_outline(OUTLINE)
    assert text.count(f"Ingresar → {LOGIN}") == 1 and "Barreras: login" in text
    assert f"PÁGINA 2 (profundidad 0): «{HELP}» {HELP}" in text


def test_catalog_with_a_scripted_model():
    class ScriptedCaller:
        async def ask(self, system_prompt, schema, text, image=None):
            assert '"sitio-"' in system_prompt and "PÁGINA 1" in text
            return {"goals": [_raw("sitio-baja", intent="transact", submits_form=True), _raw("sitio-baja")]}

    raw = asyncio.run(propose_goals(ScriptedCaller(), OUTLINE, id_prefix(OUTLINE.host)))
    goals, issues = validate(raw, OUTLINE)
    assert [(goal.intent, goal.submits_form) for goal in goals] == [("transact", True)] and "repetido" in issues[0]


def test_markdown_groups_goals_under_their_summary():
    goals = [_goal("sitio-grupo", level="summary", description="Gestiona tu servicio"),
             _goal("sitio-baja", parent="sitio-grupo", gates=["side_effect"]), _goal("sitio-suelto")]
    markdown = goals_markdown({"host": "www.sitio.cl", "pages": 3, "model": "m", "catalog_cost_usd": 0.1}, goals, ["x"])
    grouped, loose = markdown.split("## Sin grupo")
    assert "Gestiona tu servicio (`sitio-grupo`)" in grouped and "`sitio-baja`" in grouped and "side_effect" in grouped
    assert "`sitio-suelto`" in loose and "- x" in loose


def test_transact_routes_stop_before_submitting_and_route_summary_shape():
    assert instruction(_goal("sitio-a")) == "x"
    assert "sin hacerlo" in instruction(_goal("sitio-b", intent="transact"))
    assert instruction(_goal("sitio-c", intent="reach_page")).endswith("cita su título o encabezado principal.")
    document = {"status": "verified", "totals": {"min_steps": 6, "actions": 4, "distinct_pages": 3},
                "nodes": ["a", "b", "c"], "final_node": "c"}
    assert route_summary(document, config.RUNS_DIR / "x" / "route.json") == {
        "status": "verified", "steps": 6, "actions": 4, "pages": 3, "nodes": ["a", "b", "c"], "key_nodes": ["c"],
        "route": ".runs/x/route.json",
    }
    assert route_summary({**document, "status": "not_found"}, config.RUNS_DIR / "x" / "route.json") == {
        "status": "not_found", "steps": None, "actions": None, "pages": None, "nodes": None, "key_nodes": None,
        "route": ".runs/x/route.json",
    }


def test_a_failed_goal_route_does_not_stop_the_others(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AGENTS_DIR", tmp_path)
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")

    async def fake_map_reference(browser, mapping, decider):
        if mapping.task_id == "sitio-roto":
            raise RuntimeError("se cayó")
        return {"status": "verified", "answer": "Llama al 103",
                "totals": {"min_steps": 7, "actions": 5, "distinct_pages": 2},
                "nodes": ["a", "b"], "final_node": "b"}

    monkeypatch.setattr(reference, "map_reference", fake_map_reference)
    goals = [_goal("sitio-info"), _goal("sitio-roto"), _goal("sitio-pagina", intent="reach_page")]
    asyncio.run(goal_routes.map_goal_routes(None, goals, "m", "low", tmp_path, 0))
    info, broken, page = goals
    assert info.reference_route["steps"] == 7 and info.expected_answer == "Llama al 103"
    assert info.complexity == "easy"  # por las 5 acciones, sin los scrolls de min_steps
    assert broken.reference_route is None and broken.complexity is None
    assert page.reference_route["route"] == ".runs/sitio-pagina/reference/desktop/route.json"
    assert page.expected_answer is None


def _run_goals(monkeypatch, tmp_path, outline, *options):
    @asynccontextmanager
    async def fake_runtime(cdp_url):
        yield None, tmp_path

    async def fake_crawl(*args):
        return outline

    async def no_model(*args):
        raise AssertionError("no se debe llamar al modelo")

    monkeypatch.setattr(goals_command, "runtime", fake_runtime)
    monkeypatch.setattr(goals_command, "crawl", fake_crawl)
    monkeypatch.setattr(goals_command, "propose_goals", no_model)
    parser = argparse.ArgumentParser()
    goals_command.add_parser(parser.add_subparsers())
    args = parser.parse_args(["goals", "--url", START, *options])
    args.model, args.effort, args.cdp_url = "m", "low", None
    goals_command.run(parser, args)


def test_start_page_that_fails_stops_before_the_model_and_keeps_other_files(tmp_path, monkeypatch):
    out_dir = tmp_path / "salida"
    out_dir.mkdir()
    (out_dir / "notas.txt").write_text("mías", encoding="utf-8")
    (out_dir / "goals.json").write_text("{}", encoding="utf-8")
    failed = SiteOutline(START, "www.sitio.cl", "1024x768", [], [f"{START}: HTTP 503"])
    with pytest.raises(SystemExit, match="HTTP 503"):
        _run_goals(monkeypatch, tmp_path, failed, "--output", str(out_dir), "--rerun")
    assert sorted(path.name for path in out_dir.iterdir()) == ["notas.txt", "outline.json"]


def test_negative_routes_are_rejected(tmp_path, monkeypatch, capsys):
    with pytest.raises(SystemExit) as exit_info:
        _run_goals(monkeypatch, tmp_path, OUTLINE, "--routes", "-1", "--output", str(tmp_path / "salida"))
    assert exit_info.value.code == 2 and "--routes" in capsys.readouterr().err
    assert not (tmp_path / "salida").exists()


def test_catalog_round_trip_fills_the_evaluation_fields(tmp_path):
    goal = _goal("sitio-baja", intent="transact", gates=["side_effect"])
    write_catalog(tmp_path, {"host": "www.sitio.cl", "pages": 1, "model": "m", "catalog_cost_usd": 0}, [goal], ["x"])
    meta, goals, issues = read_catalog(tmp_path / "goals.json")
    assert meta["host"] == "www.sitio.cl" and issues == ["x"]
    assert goals[0].instruction == instruction(goal) and goals[0].exclusion is None


def test_resume_takes_verified_routes_for_the_same_instruction(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AGENTS_DIR", tmp_path)
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")
    done, changed, unverified, missing = (_goal(f"sitio-{name}", instruction="x") for name in ("a", "b", "c", "d"))
    route = {"status": "verified", "instruction": "x", "answer": "Sí.",
             "totals": {"min_steps": 3, "actions": 2, "distinct_pages": 2},
             "nodes": ["a", "b"], "final_node": "b"}
    for goal, changes in ((done, {}), (changed, {"instruction": "otra"}), (unverified, {"status": "unverified"})):
        route_path(goal).parent.mkdir(parents=True)
        route_path(goal).write_text(json.dumps({**route, **changes}), encoding="utf-8")
    assert resume_routes([done, changed, unverified, missing]) == [changed, unverified, missing]
    assert done.reference_route["steps"] == 3 and done.complexity == "easy" and done.expected_answer == "Sí."


def test_verified_routes_count_toward_the_route_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AGENTS_DIR", tmp_path)
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")
    goals = [_goal(f"sitio-{name}", instruction="x", prominence=prominence) for name, prominence in
             (("a", "buried"), ("b", "buried"), ("c", "primary"), ("d", "primary"))]
    route_path(goals[2]).parent.mkdir(parents=True)
    route_path(goals[2]).write_text(json.dumps({
        "status": "verified", "instruction": "x", "answer": "", "totals": {"min_steps": 1, "actions": 1, "distinct_pages": 1},
        "nodes": ["a"], "final_node": "a"}), encoding="utf-8")
    assert [goal.id for goal in goals_command._pending_routes(goals, 2, False)] == ["sitio-a"]
    assert [goal.id for goal in goals_command._pending_routes(goals, None, False)] == ["sitio-a", "sitio-b", "sitio-d"]
    assert [goal.id for goal in goals_command._pending_routes(goals, 2, True)] == ["sitio-a", "sitio-b"]
