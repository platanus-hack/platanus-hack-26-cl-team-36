"""`route --revision`: el objetivo del catálogo de esa revisión, sobre el sitio local servido por HTTP y un guion."""

import functools
import sys
import threading
from dataclasses import asdict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from shared import store
from shared.catalog.goal import Goal, instruction_goal_id

from guide import reference, route_command
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
            state["seen"].append(text)
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


def test_on_aws_engines_it_does_not_need_the_claude_command(backend, monkeypatch):
    monkeypatch.setenv("AGENTS_ENGINE", "bedrock")
    monkeypatch.setenv("AGENTS_BROWSER", "agentcore")
    monkeypatch.setattr(main.shutil, "which", lambda name: None)
    monkeypatch.setattr(sys, "argv", ["main.py", "route", "--url", "https://sitio.cl/", "--revision", "r1", "--goal", "a"])
    with pytest.raises(SystemExit) as exit_info:
        main.main()
    assert "no hay catálogo terminado de la revisión r1" in str(exit_info.value.code)
