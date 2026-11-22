"""`route --revision`: el objetivo del catálogo de esa revisión, sobre el sitio local servido por HTTP y un guion."""

import functools
import sys
import threading
from dataclasses import asdict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from shared import store
from shared.catalog.goal import Goal, instruction_goal_id
from shared.claude.fake import FakeCaller

from guide import config, reference, route_command
from guide.replay import Replay, Verification
import main
from main import build_parser
from tests.conftest import ScriptedDecider

QUOTE = "Para dar de baja llama al 103."
ROUTE = [("click", "Menú", {}), ("click", "Ayuda", {}), ("click", "¿Cómo doy de baja?", {}),
         ("done", None, {"answer": "Llamar al 103", "quote": QUOTE})]


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def served(site):
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(site)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()
    server.server_close()


@pytest.fixture
def backend(tmp_path, monkeypatch):
    root = tmp_path / "almacen"
    monkeypatch.setenv(store.ENV_VAR, root.as_uri())
    return store.LocalBackend(root)


@pytest.fixture
def scripted(monkeypatch):
    """El decisor de cada ruta sigue `script`; las instrucciones que recibe quedan en `seen`."""
    state = {"script": ROUTE, "seen": []}

    def decider(system_prompt, caller):
        scripted_decider = ScriptedDecider(state["script"])
        original = scripted_decider.decide

        async def decide(text, screenshot):
            state["seen"].append(str(text))
            return await original(text, screenshot)

        scripted_decider.decide = decide
        return scripted_decider

    monkeypatch.setattr(reference, "ClaudeDecider", decider)
    return state


def _goal(goal_id: str, url: str, description: str, **changes) -> dict:
    goal = Goal(goal_id, "127.0.0.1", url, description, None, "user_goal", None, "find_info", [url], None)
    return {**asdict(goal), **changes}


def _catalog(backend, url: str, revision: str | None, goals: list[dict], status="succeeded") -> store.RunKey:
    run = store.start_run(backend, store.cataloger(url), model="m", revision=revision)
    backend.write_json(run.key.file("goals.json"), {"issues": [], "goals": goals})
    store.finish_run(backend, run, status)
    return run.key


def _route(*options):
    parser = build_parser()
    route_command.run(parser, parser.parse_args(["route", "--shorter", "0", *options]))


def _guide_runs(backend, url, goal):
    return backend.list_runs(store.guide(url, goal, "desktop"))


def test_takes_the_goal_from_its_revision_catalog_and_the_run_succeeds(served, backend, scripted):
    catalog = _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    _catalog(backend, served, "rev-b", [_goal("baja", served, "Otra instrucción, de otra revisión")])
    _route("--url", served, "--revision", "rev-a", "--goal", "baja")
    assert "Encuentra cómo dar de baja" in scripted["seen"][0]
    [run] = _guide_runs(backend, served, "baja")
    manifest = store.read_manifest(backend, run)
    assert (manifest.status, manifest.revision, manifest.inputs) == ("succeeded", "rev-a", (str(catalog),))
    route = backend.read_json(run.file("route.json"))
    assert route["status"] == "verified" and route["start_url"] == served


def test_a_route_not_found_fails_the_run_and_exits_non_zero(served, backend, scripted):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    scripted["script"] = [("give_up", None, {"text": "No está."})]
    with pytest.raises(SystemExit) as exit_info:
        _route("--url", served, "--revision", "rev-a", "--goal", "baja")
    assert exit_info.value.code == 1
    [run] = _guide_runs(backend, served, "baja")
    manifest = store.read_manifest(backend, run)
    assert (manifest.status, manifest.revision) == ("failed", "rev-a")
    assert backend.read_json(run.file("route.json"))["status"] == "not_found"


@pytest.mark.parametrize("revision, goal, message", [
    ("rev-x", "baja", "no hay catálogo"),
    ("rev-fallida", "baja", "no hay catálogo"),
    ("rev-a", "otra", "no tiene el objetivo otra"),
    ("rev-a", "login", "excluido: barrera login"),
    ("rev-a", "resumen", "excluido: nivel summary"),
    ("rev-a", "ajeno", "empieza en otro sitio"),
])
def test_a_goal_it_cannot_map_leaves_a_failed_run_of_the_revision(served, backend, scripted, revision, goal, message):
    _catalog(backend, served, "rev-a", [
        _goal("baja", served, "x"),
        _goal("login", served, "x", gates=["login"]),
        _goal("resumen", served, "x", level="summary"),
        _goal("ajeno", "https://otro.cl/", "x"),
    ])
    _catalog(backend, served, "rev-fallida", [_goal("baja", served, "x")], status="failed")
    with pytest.raises(SystemExit) as exit_info:
        _route("--url", served, "--revision", revision, "--goal", goal)
    assert exit_info.value.code != 0 and message in str(exit_info.value.code)
    run = store.revision_run(backend, store.guide(served, goal, "desktop"), revision)
    assert store.read_manifest(backend, run).status == "failed" and scripted["seen"] == []


@pytest.mark.parametrize("options", [
    ["--revision", "rev-a", "--goal", "baja"],
    ["--url", "https://sitio.cl/", "--revision", "rev-a"],
    ["--url", "https://sitio.cl/", "--revision", "Rev A", "--goal", "baja"],
    ["--url", "https://sitio.cl/", "--revision", "rev-a", "--goal", "baja", "--instruction", "x"],
    ["--url", "https://sitio.cl/", "--instruction", "x", "--goal", "baja"],
])
def test_revision_options_are_validated(backend, capsys, options):
    with pytest.raises(SystemExit) as exit_info:
        _route(*options)
    assert exit_info.value.code == 2 and capsys.readouterr().err


def test_without_revision_an_unfound_route_still_succeeds_outside_any_revision(served, backend, scripted):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    scripted["script"] = [("give_up", None, {"text": "No está."})]
    _route("--url", served, "--instruction", "Encuentra cómo dar de baja")
    assert _guide_runs(backend, served, "baja") == []
    [run] = _guide_runs(backend, served, instruction_goal_id("Encuentra cómo dar de baja"))
    manifest = store.read_manifest(backend, run)
    assert (manifest.status, manifest.revision, manifest.inputs) == ("succeeded", None, ())
    assert backend.read_json(run.file("route.json"))["status"] == "not_found"
    assert backend.read_json(run.file("trace.json"))["status"] == "failed"


def test_on_aws_engines_it_does_not_need_the_claude_command(backend, monkeypatch):
    monkeypatch.setenv("AGENTS_ENGINE", "bedrock")
    monkeypatch.setenv("AGENTS_BROWSER", "agentcore")
    monkeypatch.setattr(main.shutil, "which", lambda name: None)
    monkeypatch.setattr(sys, "argv", ["main.py", "route", "--url", "https://sitio.cl/", "--revision", "r1", "--goal", "a"])
    with pytest.raises(SystemExit) as exit_info:
        main.main()
    assert "no hay catálogo terminado de la revisión r1" in str(exit_info.value.code)


@pytest.mark.parametrize("options, extra_routes", [
    (["--revision", "rev-a", "--goal", "baja"], config.REVISION_EXTRA_ROUTES),
    (["--revision", "rev-a", "--goal", "baja", "--shorter", "2"], 2),
    (["--instruction", "Encuentra cómo dar de baja"], config.EXTRA_ROUTES),
])
def test_a_revision_explores_once_unless_asked(backend, monkeypatch, options, extra_routes):
    url = "https://sitio.cl/"
    _catalog(backend, url, "rev-a", [_goal("baja", url, "Encuentra cómo dar de baja")])
    mapped = []

    async def fake_map(backend, mappings, cdp_url, concurrency):
        mapped.extend(mappings)
        return []

    monkeypatch.setattr(route_command, "_map", fake_map)
    parser = build_parser()
    route_command.run(parser, parser.parse_args(["route", "--url", url, *options]))
    assert [mapping.extra_routes for mapping in mapped] == [extra_routes]


DETOUR = [("scroll", None, {"text": "down"}), *ROUTE]   # la verificación quita el scroll


@pytest.mark.parametrize("script", [ROUTE, DETOUR])
def test_the_trace_is_in_the_store_after_each_step_and_ends_as_the_route(served, backend, scripted, monkeypatch, script):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    scripted["script"] = script
    published, seen = [], []
    publish_file = store.LocalBackend.publish_file

    def spy(self, run, workdir, name, profile=None):
        published.append(name)
        publish_file(self, run, workdir, name, profile)

    monkeypatch.setattr(store.LocalBackend, "publish_file", spy)
    decide = reference.ClaudeDecider

    def watching(system_prompt, caller):
        decider = decide(system_prompt, caller)
        original = decider.decide

        async def decide_and_look(text, screenshot):
            [run] = _guide_runs(backend, served, "baja")
            trace = backend.read_json(run.file("trace.json"))
            steps = len(seen)
            assert store.read_manifest(backend, run).status == "running"
            assert (trace["status"], len(trace["steps"]), trace["start"]["screenshot"]) == ("running", steps, "step_00.png")
            assert all(backend.exists(run.file(f"step_{n:02d}.png")) for n in range(steps + 1))
            seen.append(trace)
            return await original(text, screenshot)

        decider.decide = decide_and_look
        return decider

    monkeypatch.setattr(reference, "ClaudeDecider", watching)
    _route("--url", served, "--revision", "rev-a", "--goal", "baja")

    actions = len(script) - 1
    assert published == ["step_00.png", "trace.json"] + [
        name for n in range(1, actions + 1) for name in (f"step_{n:02d}.png", "trace.json")
    ] + [f"step_{n:02d}.png" for n in range(4, actions + 1)]   # las capturas que la ruta no usa se quitan
    last = seen[-1]
    assert (last["schema_version"], last["agent"], last["goal"], last["revision"], last["profile"]) == (
        1, "guide", "baja", "rev-a", None)
    assert last["steps"][-1]["label"] == "click «¿Cómo doy de baja?»"

    [run] = _guide_runs(backend, served, "baja")
    route = backend.read_json(run.file("route.json"))
    trace = backend.read_json(run.file("trace.json"))
    assert (trace["status"], trace["steps"]) == ("succeeded", route["steps"])
    assert trace["start"] == {key: route["start"][key] for key in ("url", "title", "screenshot")}
    files = sorted(path.name for path in (backend.root / str(run)).iterdir())
    assert files == ["manifest.json", "route.json", "route.md", "step_00.png", "step_01.png", "step_02.png",
                     "step_03.png", "trace.json"]


def _failed_route(backend, served):
    with pytest.raises(SystemExit):
        _route("--url", served, "--revision", "rev-a", "--goal", "baja")
    [run] = _guide_runs(backend, served, "baja")
    return run, backend.read_json(run.file("route.json")), backend.read_json(run.file("trace.json"))


def test_a_failed_route_leaves_a_failed_trace_with_what_was_explored(served, backend, scripted):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    scripted["script"] = [("click", "Productos", {}), ("give_up", None, {"text": "No está."})]
    run, route, trace = _failed_route(backend, served)
    assert (route["status"], route["steps"]) == ("not_found", [])
    assert trace["status"] == "failed" and trace["start"]["screenshot"] == "step_00.png"
    assert [(step["label"], step["screenshot"]) for step in trace["steps"]] == [("click «Productos»", "step_01.png")]
    assert backend.exists(run.file("step_00.png")) and backend.exists(run.file("step_01.png"))


def test_an_unverified_route_keeps_the_exploration_captures_it_would_overwrite(served, backend, scripted, monkeypatch):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    scripted["script"] = [("click", "Productos", {}), ("click", "Volver al inicio", {}), *ROUTE]

    async def unverified(browser, screen, url, candidate, final_node, quote, log):
        return Verification(False, candidate[2:], Replay(), 1, 0, "la cita no está en la página final")

    monkeypatch.setattr(reference, "verify_and_minimise", unverified)
    run, route, trace = _failed_route(backend, served)
    assert route["status"] == "unverified" and len(route["steps"]) == 3
    assert trace["status"] == "failed"
    assert [step["label"] for step in trace["steps"]][:2] == ["click «Productos»", "click «Volver al inicio»"]
    assert [step["screenshot"] for step in trace["steps"]] == [
        "explore_01.png", "explore_02.png", "explore_03.png", "step_04.png", "step_05.png"]
    assert backend.read_bytes(run.file("explore_01.png")) != backend.read_bytes(run.file("step_01.png"))


def test_a_decision_without_reason_does_not_end_the_exploration(served, backend, monkeypatch):
    _catalog(backend, served, "rev-a", [_goal("baja", served, "Encuentra cómo dar de baja")])
    caller = FakeCaller("m", "e", script=[{"action": "scroll", "text": "down"}, {"action": "give_up", "text": "No está."}])
    monkeypatch.setattr(reference, "make_caller", lambda *args, **kwargs: caller)
    run, route, trace = _failed_route(backend, served)
    assert route["exploration"]["end_reason"] == "gave_up" and len(caller.calls) == 2
    assert "razón" not in route["exploration"]["history"][0]
    assert [step["label"] for step in trace["steps"]] == ["scroll «down»"]
