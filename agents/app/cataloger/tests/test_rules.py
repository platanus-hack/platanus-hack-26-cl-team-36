"""Catálogo sin Claude: validación de lo que propone el modelo y reglas deterministas."""

import asyncio
from contextlib import asynccontextmanager

import pytest

from shared.catalog.files import read_catalog
from shared.catalog.goal import Goal, instruction
from shared.catalog.outline import Field, Form, Link, PageOutline, SiteOutline

from cataloger import command, config
from cataloger.output import goals_markdown, write_catalog
from cataloger.propose import propose_goals, render_outline, system_prompt
from cataloger.rules import gates, id_prefix, page_gates, validate
from main import build_parser

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


def test_gates_come_from_own_evidence_pages_and_transact():
    assert gates(_goal("sitio-a", evidence=[START, LOGIN]), OUTLINE) == ["login"]
    assert gates(_goal("sitio-b", evidence=[START, HELP], intent="transact"), OUTLINE) == ["side_effect"]
    assert gates(_goal("sitio-c", evidence=[HELP]), OUTLINE) == []
    assert gates(_goal("sitio-d", evidence=[FORM]), OUTLINE) == []
    assert gates(_goal("sitio-e", evidence=[FORM], intent="transact"), OUTLINE) == ["personal_data", "side_effect"]
    assert gates(_goal("sitio-f", evidence=[FORM], submits_form=True), OUTLINE) == ["personal_data"]
    assert gates(_goal("sitio-g", evidence=[FORM], intent="reach_page"), OUTLINE) == []


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


def _run_catalog(monkeypatch, outline, *options):
    @asynccontextmanager
    async def fake_browser(cdp_url):
        yield None

    async def fake_crawl(*args):
        return outline

    async def no_model(*args):
        raise AssertionError("no se debe llamar al modelo")

    monkeypatch.setattr(command, "open_browser", fake_browser)
    monkeypatch.setattr(command, "crawl", fake_crawl)
    monkeypatch.setattr(command, "propose_goals", no_model)
    parser = build_parser()
    command.run(parser, parser.parse_args(["--url", START, *options]))


def test_start_page_that_fails_stops_before_the_model_and_keeps_other_files(tmp_path, monkeypatch):
    out_dir = tmp_path / "salida"
    out_dir.mkdir()
    (out_dir / "notas.txt").write_text("mías", encoding="utf-8")
    (out_dir / "goals.json").write_text("{}", encoding="utf-8")
    failed = SiteOutline(START, "www.sitio.cl", "1024x768", [], [f"{START}: HTTP 503"])
    with pytest.raises(SystemExit, match="HTTP 503"):
        _run_catalog(monkeypatch, failed, "--output", str(out_dir), "--rerun")
    assert sorted(path.name for path in out_dir.iterdir()) == ["notas.txt", "outline.json"]


def test_existing_catalog_is_kept_without_rerun(tmp_path, monkeypatch, capsys):
    out_dir = tmp_path / "salida"
    out_dir.mkdir()
    (out_dir / "goals.json").write_text("{}", encoding="utf-8")
    _run_catalog(monkeypatch, OUTLINE, "--output", str(out_dir))
    assert "--rerun" in capsys.readouterr().out and (out_dir / "goals.json").read_text(encoding="utf-8") == "{}"


def test_catalog_round_trip_fills_the_evaluation_fields(tmp_path):
    goal = _goal("sitio-baja", intent="transact", gates=["side_effect"])
    write_catalog(tmp_path, {"host": "www.sitio.cl", "pages": 1, "model": "m", "catalog_cost_usd": 0}, [goal], ["x"])
    meta, goals, issues = read_catalog(tmp_path / "goals.json")
    assert meta["host"] == "www.sitio.cl" and issues == ["x"]
    assert goals[0].instruction == instruction(goal) and goals[0].exclusion is None
