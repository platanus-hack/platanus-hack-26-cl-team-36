"""La etapa de una revisión, el resultado medido contra la ruta de la Guía y el usuario guionizado (sin Claude)."""

import asyncio
import functools
import json
import sys
import threading
from dataclasses import asdict
from datetime import UTC, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from shared import store
from shared.catalog.goal import Goal
from shared.nodes.urls import node_key

import main
from visitor import batch, outcome, report
from visitor.batch import attempt_folder, attempt_slots
from visitor.profiles import PROFILES, system_prompt
from visitor.recording import Run
from visitor.stage import MissingInput, run_stage

REVISION, OTHER = "r1", "r2"
HOME, HELP, HOURS = ("https://s.cl/", "Inicio"), ("https://s.cl/ayuda", "Ayuda"), ("https://s.cl/horario", "Horario")
ROUTE = {"final_node": node_key(*HOURS), "nodes": [node_key(*HOME), node_key(*HELP), node_key(*HOURS)]}


def _run(pages, end_reason="done") -> dict:
    return {"profile": "desktop", "start": {"url": HOME[0], "title": HOME[1]}, "end_reason": end_reason,
            "final_message": "listo", "steps": [{"url": url, "title": title} for url, title in pages]}


# --- perfiles ---------------------------------------------------------------------------------------------------

def test_desktop_only_does_the_task_and_mobile_only_says_it_is_a_phone():
    desktop, mobile = system_prompt(PROFILES["desktop"]), system_prompt(PROFILES["mobile"])
    assert "TU PERFIL" not in desktop and "1024x768" in desktop
    assert "TU PERFIL\nUsas el sitio desde un teléfono" in mobile and "390x844" in mobile
    assert "first_time" not in PROFILES and "hurried" not in PROFILES


# --- resultado ------------------------------------------------------------------------------------------------

def test_success_is_reaching_the_final_page_of_the_route_whatever_the_user_says():
    assert outcome.by_route(_run([HELP, HOURS]), ROUTE) | {"justification": ""} == {
        "outcome": "success", "source": "route", "claimed_done": True, "justification": ""}
    reached_but_gave_up = outcome.by_route(_run([HOURS, HELP], "gave_up"), ROUTE)
    assert reached_but_gave_up["outcome"] == "success" and not reached_but_gave_up["claimed_done"]


def test_not_reaching_is_abandoned_and_claiming_done_without_reaching_is_failed():
    assert outcome.by_route(_run([HELP], "gave_up"), ROUTE)["outcome"] == "abandoned"
    assert outcome.by_route(_run([HELP], "step_limit"), ROUTE)["outcome"] == "abandoned"
    claimed = outcome.by_route(_run([HELP]), ROUTE)
    assert claimed["outcome"] == "failed" and claimed["claimed_done"]
    assert "Declaró que terminó" in claimed["justification"]


def _recorded(tmp_path, references, judge=None, criteria=None, end_reason="done") -> dict:
    run = Run(profile="desktop", profile_name="Escritorio", viewport="1024x768", model="m", start_url=HOME[0],
              instruction="i", folder="desktop", start={"url": HOME[0], "title": HOME[1]}, end_reason=end_reason,
              final_screenshot="step_00.png")
    (tmp_path / "step_00.png").write_bytes(b"png")
    asyncio.run(batch._record_verdict(run, tmp_path, references, judge, "i", criteria))
    return json.loads((tmp_path / "run.json").read_text())["verdict"]


def test_without_route_nor_judge_the_attempt_is_unmeasured(tmp_path):
    verdict = _recorded(tmp_path, {})
    assert verdict["outcome"] == "unmeasured" and verdict["source"] is None and verdict["claimed_done"]


class _Judge:
    def __init__(self):
        self.calls = 0

    async def ask_json(self, system_prompt, text, image, schema):
        self.calls += 1
        return {"outcome": "success", "justification": "se ve el horario"}


def test_the_judge_only_decides_attempts_without_route(tmp_path):
    judge = _Judge()
    verdict = _recorded(tmp_path, {}, judge, {"criterion": "c", "evidence": []})
    assert (verdict["outcome"], verdict["source"], judge.calls) == ("success", "judge", 1)
    with_route = _recorded(tmp_path, {"desktop": ("k", ROUTE)}, judge, {"criterion": "c"})
    assert with_route["source"] == "route" and judge.calls == 1
    assert _recorded(tmp_path, {}, judge, {"criterion": "c"}, "api_error")["outcome"] == "interrupted"


def test_report_tells_apart_claiming_done_without_reaching_and_unmeasured():
    def run(folder, verdict, attempt=1):
        return {**_run([HELP]), "profile_name": "Escritorio", "viewport": "1024x768", "duration_s": 3, "turns": 1,
                "final_screenshot": "step_01.png", "verdict": verdict, "folder": folder, "attempt": attempt,
                "steps": []}

    claimed = outcome.by_route(_run([HELP]), ROUTE)
    text = report.generate(
        {"url": "u", "instruction": "i", "task_id": "t", "timestamp": "t", "engine": "fake", "user_model": "fake",
         "judge_model": None, "effort": None},
        None,
        [run("desktop", claimed), run("desktop-2", outcome.unmeasured(_run([HELP])), 2)],
        {"nodes": [], "branches": [], "recommended_route": None},
    )
    assert "| Escritorio | 1024x768 | declaró que terminó sin llegar |" in text
    assert "| Escritorio (intento 2) | 1024x768 | sin medir |" in text
    assert "](desktop-2/step_01.png)" in text and "sin juez" in text
    assert "**Éxito:** llegar a la página final de la ruta de la Guía" in text


def test_runs_gives_each_profile_its_attempts_in_their_own_folders():
    slots = attempt_slots(["desktop", "mobile"], 2)
    assert [attempt_folder(*slot) for slot in slots] == ["desktop", "desktop-2", "mobile", "mobile-2"]
    with pytest.raises(ValueError):
        attempt_slots(["desktop"], 0)


# --- etapa por revisión, de punta a punta con el usuario guionizado ---------------------------------------------

PAGES = {
    "index.html": '<title>Inicio</title><a href="ayuda.html" style="font-size:30px">Ayuda</a>',
    "ayuda.html": '<title>Ayuda</title><p>Más</p><a href="horario.html" style="font-size:30px">Horario</a>',
    "horario.html": "<title>Horario</title><h1>De 9 a 18</h1>",
}


@pytest.fixture
def site(tmp_path):
    folder = tmp_path / "sitio"
    folder.mkdir()
    for name, html in PAGES.items():
        (folder / name).write_text(html, encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(folder)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def _goal(url: str, goal_id: str = "horario") -> Goal:
    return Goal(id=goal_id, host="127.0.0.1", start_url=url + "index.html", description="Encuentra el horario.",
                expected_answer=None, level="user_goal", parent=None, intent="find_info", evidence=[url],
                entry=None, instruction="Encuentra el horario.", exclusion=None)


def _at(minute: int):
    return lambda: datetime(2026, 11, 21, 10, minute, tzinfo=UTC)


def _catalog(backend, url, revision, goal: Goal, minute: int) -> store.RunKey:
    run = store.start_run(backend, store.cataloger(url), model="m", revision=revision, clock=_at(minute))
    backend.write_json(run.key.file("goals.json"), {"goals": [asdict(goal)], "issues": []})
    store.finish_run(backend, run, "succeeded")
    return run.key


def _route(backend, url, revision, goal: Goal, minute: int, last_page="horario.html", status="verified"):
    titles = {"ayuda.html": "Ayuda", "horario.html": "Horario"}
    steps = [{"number": 1, "label": "click «Ayuda»", "action": "click", "value": None,
              "target": {"text": "Ayuda", "href": "ayuda.html"}, "locators": [{"by": "href", "value": "ayuda.html", "nth": 0}]}]
    if last_page == "horario.html":
        steps.append({"number": 2, "label": "click «Horario»", "action": "click", "value": None,
                      "target": {"text": "Horario", "href": "horario.html"}, "locators": []})
    final = node_key(url + last_page, titles[last_page])
    run = store.start_run(backend, store.guide(goal.start_url, goal.id, "desktop"), model="m", revision=revision,
                          clock=_at(minute))
    backend.write_json(run.key.file("route.json"), {
        "status": status, "start_url": goal.start_url, "instruction": goal.instruction, "viewport": "desktop",
        "totals": {"min_steps": len(steps), "distinct_pages": len(steps) + 1}, "final_node": final,
        "nodes": [node_key(goal.start_url, "Inicio"), final], "steps": steps})
    store.finish_run(backend, run, "succeeded")
    return run.key


def _stage(backend, url, **options):
    return asyncio.run(run_stage(backend, url, REVISION, "horario", ["desktop"], engine="fake", **options))


def test_the_stage_uses_the_catalog_and_route_of_its_revision_even_with_newer_ones(tmp_path, site):
    backend = store.LocalBackend(tmp_path / "almacen")
    goal = _goal(site)
    catalog = _catalog(backend, site, REVISION, goal, 0)
    route = _route(backend, site, REVISION, goal, 1)
    # Más nuevos, de otra revisión: la ruta de esa revisión solo llega a la ayuda.
    _catalog(backend, site, OTHER, _goal(site + "otra/"), 2)
    _route(backend, site, OTHER, goal, 3, last_page="ayuda.html")

    run = _stage(backend, site)
    manifest = store.read_manifest(backend, run)
    assert (manifest.status, manifest.revision) == ("succeeded", REVISION)
    assert set(manifest.inputs) == {str(catalog), str(route)}
    data = backend.read_json(run.file("run.json", "desktop"))
    assert (data["end_reason"], data["verdict"]["outcome"], data["verdict"]["source"]) == ("done", "success", "route")
    assert [step["title"] for step in data["steps"]] == ["Ayuda", "Horario"]
    assert not backend.exists(run.file("criteria.json"))


def test_runs_two_repeats_the_attempt_in_the_same_run(tmp_path, site):
    backend = store.LocalBackend(tmp_path / "almacen")
    goal = _goal(site)
    _catalog(backend, site, REVISION, goal, 0)
    _route(backend, site, REVISION, goal, 1)
    run = _stage(backend, site, runs=2)
    assert backend.list_profiles(run) == ["desktop", "desktop-2"]
    second = backend.read_json(run.file("run.json", "desktop-2"))
    assert (second["attempt"], second["verdict"]["outcome"]) == (2, "success")
    comparison = backend.read_json(run.file("comparison.json"))
    assert [row["run"] for row in comparison["runs"]] == ["desktop", "desktop-2"]


def test_without_a_verified_route_of_the_revision_it_fails_without_calling_the_model(tmp_path, site, monkeypatch):
    backend = store.LocalBackend(tmp_path / "almacen")
    goal = _goal(site)
    _catalog(backend, site, REVISION, goal, 0)
    _route(backend, site, REVISION, goal, 1, status="unverified")
    _route(backend, site, OTHER, goal, 2)  # verificada, pero de otra revisión

    async def no_batch(*args, **kwargs):
        raise AssertionError("no debía correr la tanda")

    monkeypatch.setattr("visitor.stage.run_batch", no_batch)
    with pytest.raises(MissingInput, match="ruta verificada"):
        _stage(backend, site)
    failed = store.revision_run(backend, store.visitor(site, "horario"), REVISION)
    assert store.read_manifest(backend, failed).status == "failed"
    assert "No se corrió" in backend.read_text(failed.file("report.md"))


def test_the_cli_exits_zero_when_the_run_succeeds_and_not_without_inputs(tmp_path, site, monkeypatch):
    backend = store.LocalBackend(tmp_path / "almacen")
    goal = _goal(site)
    monkeypatch.setenv(store.ENV_VAR, (tmp_path / "almacen").as_uri())
    monkeypatch.setenv("AGENTS_ENGINE", "fake")
    argv = ["main.py", "--url", site, "--revision", REVISION, "--goal", "horario", "--profiles", "desktop", "--runs", "1"]
    monkeypatch.setattr(sys, "argv", argv)
    with pytest.raises(SystemExit) as missing:
        main.main()
    assert missing.value.code not in (0, None)

    _catalog(backend, site, REVISION, goal, 0)
    _route(backend, site, REVISION, goal, 1)
    main.main()  # sin SystemExit: sale con 0
    run = store.revision_run(backend, store.visitor(site, "horario"), REVISION)
    assert store.read_manifest(backend, run).status == "succeeded"
