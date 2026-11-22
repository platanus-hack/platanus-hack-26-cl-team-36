"""Catálogo sin Claude: validación de lo que propone el modelo y reglas deterministas."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from shared.catalog.files import read_catalog, read_outline
from shared.catalog.goal import Goal, for_revision, instruction
from shared.catalog import tasks
from shared.catalog.outline import Field, Form, Link, PageOutline, SiteOutline
from shared.claude.fake import FakeCaller
from shared import store

from cataloger import command
from cataloger.output import goals_markdown, write_catalog
from cataloger.propose import SYSTEM_PROMPT, propose_goals, render_outline, scripted_catalog
from cataloger.rules import classify, gates, login_reason, page_gates, validate
from main import build_parser

START = "https://www.sitio.cl/"
HELP = "https://www.sitio.cl/ayuda/"
LOGIN = "https://www.sitio.cl/ingreso/"
FORM = "https://www.sitio.cl/te-llamamos/"
HEIGHT = 768


def _page(url: str, links: list[Link], gates: list[str] | None = None) -> PageOutline:
    return PageOutline(url, url, 0, [], links, [], [], False, gates or [])


OUTLINE = SiteOutline(START, "sitio.cl", "1024x768", [
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
    fields = {"id": goal_id, "host": "sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [HELP], "entry": None}
    return Goal(**{**fields, **changes})


def test_validation_repairs_or_drops_invalid_goals_and_says_why():
    goals, issues = validate([
        _raw("gestionar", level="summary", entry=None),
        _raw("Baja", parent="gestionar"),
        _raw("baja"),
        _raw("raro", level="epic"),
        _raw("inventado", evidence=["https://www.sitio.cl/no-existe/"]),
        _raw("entrada", entry="https://www.sitio.cl/oculto/", evidence=["https://sitio.cl/ayuda"]),
        _raw("huerfano", parent="baja"),
    ], OUTLINE)
    assert [goal.id for goal in goals] == ["gestionar", "baja", "entrada", "huerfano"]
    assert goals[1].parent == "gestionar"
    assert goals[2].entry is None and goals[2].evidence == [HELP]
    assert goals[3].parent is None
    assert len(issues) == 5
    assert all(any(goal_id in issue for issue in issues)
               for goal_id in ("baja", "raro", "inventado", "entrada", "huerfano"))


def test_one_page_catalog_takes_that_page_as_evidence_when_the_model_cites_a_link_destination():
    # Caso real de dt.gob.cl: Haiku citó como evidencia los destinos de los enlaces de la única página.
    start = "https://www.dt.gob.cl/portal/1626/w3-channel.html"
    workers = "https://www.dt.gob.cl/portal/1626/w3-propertyvalue-26864.html"
    one_page = SiteOutline(start, "dt.gob.cl", "1024x768", [_page(start, [Link("Trabajadores", workers, "nav", True, 170)])], [])
    goals, issues = validate([_raw("servicios-trabajadores", evidence=[workers], entry=workers)], one_page, reserved=set())
    assert [(goal.evidence, goal.entry) for goal in goals] == [([start], workers)] and not issues


def test_demand_and_estimated_steps_are_kept_when_valid_and_top_tasks_are_capped():
    goals, issues = validate([
        *(_raw(f"t{number}", demand="top", estimated_steps=number) for number in range(1, 8)),
        _raw("raro", demand="urgente", estimated_steps=0),
        _raw("anterior"),
    ], OUTLINE, reserved=set())
    assert [goal.demand for goal in goals] == ["top"] * 6 + ["common", None, None]
    assert [goal.estimated_steps for goal in goals] == [1, 2, 3, 4, 5, 6, 7, None, None]
    assert issues == ["t7: ya hay 6 tareas principales; queda common"]


def test_the_free_goal_prefix_is_reserved():
    goals, issues = validate([_raw("libre-baja-0a1b2c3d"), _raw("baja")], OUTLINE, reserved=set())
    assert [goal.id for goal in goals] == ["baja"] and "libre-" in issues[0]


def test_parent_is_normalised_like_the_id_and_summaries_do_not_nest():
    goals, issues = validate([
        _raw("Gestionar", level="summary", entry=None, parent="Otro grupo"),
        _raw("otro-grupo", level="summary", entry=None, parent="gestionar"),
        _raw("baja", parent="GESTIONAR"),
    ], OUTLINE, reserved=set())
    assert [(goal.id, goal.parent) for goal in goals] == [
        ("gestionar", None), ("otro-grupo", None), ("baja", "gestionar"),
    ]
    assert sum("un summary no tiene padre" in issue for issue in issues) == 2


def test_ids_of_tasks_of_the_same_host_are_renamed(tmp_path, monkeypatch):
    (tmp_path / "sitio.cl").mkdir()
    (tmp_path / "sitio.cl" / "grupo.json").write_text("{}", encoding="utf-8")
    (tmp_path / "otro.cl").mkdir()
    (tmp_path / "otro.cl" / "baja.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(tasks, "TASKS_DIR", tmp_path)
    goals, issues = validate([
        _raw("grupo", level="summary", entry=None),
        _raw("grupo-2", parent="grupo"),
        _raw("baja", parent="grupo"),
    ], OUTLINE)
    assert [(goal.id, goal.parent) for goal in goals] == [
        ("grupo-3", None), ("grupo-2", "grupo-3"), ("baja", "grupo-3"),
    ]
    assert any("agents/tasks/" in issue and "grupo-3" in issue for issue in issues)
    assert '"horario-sucursal"' in SYSTEM_PROMPT and "baja-fibra" not in SYSTEM_PROMPT


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
    assert gates(_goal("a", evidence=[START, LOGIN]), OUTLINE) == ["login"]
    assert gates(_goal("b", evidence=[START, HELP], intent="transact"), OUTLINE) == ["side_effect"]
    assert gates(_goal("c", evidence=[HELP]), OUTLINE) == []
    assert gates(_goal("d", evidence=[FORM]), OUTLINE) == []
    assert gates(_goal("e", evidence=[FORM], intent="transact"), OUTLINE) == ["personal_data", "side_effect"]
    assert gates(_goal("f", evidence=[FORM], submits_form=True), OUTLINE) == ["personal_data"]
    assert gates(_goal("g", evidence=[FORM], intent="reach_page"), OUTLINE) == []


def test_start_page_gates_only_block_goals_that_stay_on_it():
    # Con --pages 1 toda evidencia es la página inicial: un login en ella no debe excluir lo que sale de ahí.
    one_page = SiteOutline(START, "sitio.cl", "1024x768", [_page(START, OUTLINE.pages[0].links, ["login"])], [])
    assert gates(_goal("telefono", evidence=[START], entry=HELP), one_page) == []
    assert gates(_goal("ingresar", evidence=[START]), one_page) == ["login"]


def test_login_reason_from_auth_hosts_paths_or_own_data_and_not_from_public_pages():
    def reason(description="Encuentra algo.", entry=None):
        return login_reason(_goal("a", description=description, entry=entry))

    assert "ucampus.uchile.cl" in reason(entry="https://ucampus.uchile.cl/")
    assert "mi.uchile.cl" in reason(entry="https://mi.uchile.cl/correo_223")
    assert "/cuenta/login.php" in reason(entry="/cuenta/login.php")
    assert reason("Consulta tus notas del semestre.") and reason("Matricúlate para el próximo período.")
    assert reason("Accede a tu cuenta personal Mi SII.")
    assert reason("Encuentra las fechas del proceso de matrícula.") is None
    assert reason("Encuentra cómo dar de baja tu servicio de Internet Fibra.") is None
    assert reason(entry="https://uchile.cl/portal/presentacion/campus") is None
    assert reason(entry="https://www.metro.cl/el-viaje/estado-red") is None


def test_model_login_and_the_rule_correcting_it_both_end_in_gates():
    raw = [_raw("ingresar", requires_login=True), _raw("notas", description="Consulta tus notas."), _raw("telefono")]
    goals, issues = classify(raw, OUTLINE, HEIGHT)
    assert [goal.gates for goal in goals] == [["login"], ["login"], []]
    assert issues == ["notas: la tarea es sobre datos propios de la persona; queda con barrera login"]


class _Files:
    def __init__(self, folder: Path):
        self.folder = folder

    def read_json(self, name: str) -> dict:
        return json.loads((self.folder / name).read_text(encoding="utf-8"))


class _Run:
    def file(self, name: str) -> str:
        return name


def test_real_uchile_catalog_gets_login_on_student_portal_tasks_and_the_revision_skips_them():
    # Revisión mwrksrlc-3fe63f: Haiku propuso como top tareas de Ucampus y matrícula sin barrera y sus Guías fallaron.
    files = _Files(Path(__file__).parent / "data" / "uchile")
    outline = read_outline(files, _Run())
    keys = ("id", "description", "level", "parent", "intent", "submits_form", "evidence", "entry", "demand",
            "estimated_steps")
    raw = [{key: goal[key] for key in keys} for goal in files.read_json("goals.json")["goals"]]
    goals, issues = classify(raw, outline, HEIGHT)
    by_id = {goal.id: goal for goal in goals}
    blocked = ("acceder-ucampus", "consultar-notas", "inscribir-asignaturas", "matricularse")
    assert all("login" in by_id[goal_id].gates for goal_id in blocked)
    assert sum("queda con barrera login" in issue for issue in issues) == 11
    chosen = [goal.id for goal in for_revision(goals, 6)]
    assert not set(blocked) & set(chosen)
    assert chosen == ["buscar-postgrado", "buscar-carrera-pregrado", "acceder-servicio-medico-dental",
                      "conocer-opciones-admision-especial", "solicitar-certificado-titulo", "postular-admision-regular"]


def test_real_metro_catalog_keeps_its_gates():
    data = json.loads((Path(__file__).parents[3] / "shared" / "tests" / "data" / "catalogo-metro.json").read_text())
    fields = Goal.__dataclass_fields__
    goals = [Goal(**{key: value for key, value in raw.items() if key in fields}) for raw in data["goals"]]
    assert [login_reason(goal) for goal in goals] == [None] * len(goals)


def test_outline_text_lists_each_link_once_and_the_page_gates():
    text = render_outline(OUTLINE)
    assert text.count(f"Ingresar → {LOGIN}") == 1 and "Barreras: login" in text
    assert f"PÁGINA 2 (profundidad 0): «{HELP}» {HELP}" in text


def test_catalog_with_a_scripted_model():
    class ScriptedCaller:
        async def ask(self, system_prompt, schema, text, image=None):
            assert "sin el nombre del sitio" in system_prompt and "PÁGINA 1" in text
            return {"goals": [_raw("baja", intent="transact", submits_form=True), _raw("baja")]}

    raw = asyncio.run(propose_goals(ScriptedCaller(), OUTLINE))
    goals, issues = validate(raw, OUTLINE)
    assert [(goal.intent, goal.submits_form) for goal in goals] == [("transact", True)] and "repetido" in issues[0]


def test_scripted_engine_catalogs_the_start_page():
    raw = asyncio.run(propose_goals(FakeCaller("guion", "low", scripted_catalog), OUTLINE))
    goals, issues = validate(raw, OUTLINE)
    assert [(goal.id, goal.evidence) for goal in goals] == [("pagina-inicial", [OUTLINE.pages[0].url])] and not issues


def test_markdown_groups_goals_under_their_summary():
    goals = [_goal("grupo", level="summary", description="Gestiona tu servicio"),
             _goal("baja", parent="grupo", gates=["side_effect"]), _goal("suelto")]
    markdown = goals_markdown({"host": "sitio.cl", "pages": 3, "model": "m", "catalog_cost_usd": 0.1}, goals, ["x"])
    grouped, loose = markdown.split("## Sin grupo")
    assert "Gestiona tu servicio (`grupo`)" in grouped and "`baja`" in grouped and "side_effect" in grouped
    assert "`suelto`" in loose and "- x" in loose


def _run_catalog(monkeypatch, tmp_path, outline, *options):
    @asynccontextmanager
    async def fake_browser(cdp_url):
        yield None

    async def fake_crawl(*args):
        return outline

    async def no_model(*args):
        raise AssertionError("no se debe llamar al modelo")

    monkeypatch.setenv(store.ENV_VAR, tmp_path.as_uri())
    monkeypatch.setattr(command, "open_browser", fake_browser)
    monkeypatch.setattr(command, "crawl", fake_crawl)
    monkeypatch.setattr(command, "propose_goals", no_model)
    parser = build_parser()
    command.run(parser, parser.parse_args(["--url", START, *options]))


def test_start_page_that_fails_stops_before_the_model_and_the_run_fails(tmp_path, monkeypatch):
    failed = SiteOutline(START, "sitio.cl", "1024x768", [], [f"{START}: HTTP 503"])
    with pytest.raises(SystemExit, match="HTTP 503"):
        _run_catalog(monkeypatch, tmp_path, failed)
    backend = store.LocalBackend(tmp_path)
    [run] = backend.list_runs(store.cataloger(START))
    assert store.read_manifest(backend, run).status == "failed"
    assert backend.exists(run.file("outline.json")) and not backend.exists(run.file("goals.json"))


def test_existing_catalog_is_kept_without_rerun(tmp_path, monkeypatch, capsys):
    backend = store.LocalBackend(tmp_path)
    store.finish_run(backend, store.start_run(backend, store.cataloger(START), model="m"), "succeeded")
    _run_catalog(monkeypatch, tmp_path, OUTLINE)
    assert "--rerun" in capsys.readouterr().out and len(backend.list_runs(store.cataloger(START))) == 1


def test_catalog_round_trip_fills_the_evaluation_fields(tmp_path):
    goal = _goal("baja", intent="transact", gates=["side_effect"])
    backend = store.LocalBackend(tmp_path)
    run = store.start_run(backend, store.cataloger(START), model="m")
    write_catalog(run.workdir, {"host": "sitio.cl", "pages": 1, "model": "m", "catalog_cost_usd": 0}, [goal], ["x"])
    meta, goals, issues = read_catalog(backend, run.key)
    assert meta["host"] == "sitio.cl" and issues == ["x"]
    assert goals[0].instruction == instruction(goal) and goals[0].exclusion is None
