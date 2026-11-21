"""Rutas de los objetivos de un catálogo sin Claude: qué se mapea, qué se reutiliza y qué pasa si una falla."""

from contextlib import asynccontextmanager
from dataclasses import asdict

import pytest

from shared import store
from shared.catalog.goal import Goal

from guide import reference, route_command
from guide.catalog_routes import pending_routes
from main import build_parser

START = "https://www.sitio.cl/"


def _goal(goal_id: str, **changes) -> Goal:
    fields = {"id": goal_id, "host": "sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [START], "entry": None}
    return Goal(**{**fields, **changes})


def _publish(backend: store.LocalBackend, prefix: store.RunPrefix, files: dict) -> store.RunKey:
    run = store.start_run(backend, prefix, model="m")
    for name, data in files.items():
        backend.write_json(run.key.file(name), data)
    store.finish_run(backend, run, "succeeded")
    return run.key


def _route(goal: Goal, **changes) -> dict:
    return {"status": "verified", "start_url": goal.start_url, "instruction": goal.instruction, **changes}


def _run_route(monkeypatch, tmp_path, goals: list[Goal], *options):
    monkeypatch.setenv(store.ENV_VAR, tmp_path.as_uri())
    _publish(store.LocalBackend(tmp_path), store.cataloger(START),
             {"goals.json": {"issues": [], "goals": [asdict(goal) for goal in goals]}})

    @asynccontextmanager
    async def fake_browser(cdp_url):
        yield None

    monkeypatch.setattr(route_command, "open_browser", fake_browser)
    parser = build_parser()
    route_command.run(parser, parser.parse_args(["route", "--site", START, *options]))


def test_a_failed_goal_route_does_not_stop_the_others_and_each_run_names_the_catalog(tmp_path, monkeypatch, capsys):
    async def fake_map_reference(browser, mapping, decider, out_dir):
        if mapping.goal == "roto":
            raise RuntimeError("se cayó")
        return {"status": "verified", "totals": {"min_steps": 7}}

    monkeypatch.setattr(reference, "map_reference", fake_map_reference)
    goals = [_goal("info"), _goal("roto"), _goal("pagina", intent="reach_page")]
    _run_route(monkeypatch, tmp_path, goals, "--routes", "all")
    out = capsys.readouterr().out
    assert "roto desktop: error interno, RuntimeError: se cayó" in out
    assert "info desktop: verified, 7 pasos mínimos" in out and "pagina desktop: verified" in out
    backend = store.LocalBackend(tmp_path)
    [catalog] = backend.list_runs(store.cataloger(START))
    [broken] = backend.list_runs(store.guide(START, "roto", "desktop"))
    [info] = backend.list_runs(store.guide(START, "info", "desktop"))
    assert store.read_manifest(backend, broken).status == "failed"
    assert store.read_manifest(backend, info).inputs == (str(catalog),)


def test_negative_routes_are_rejected(tmp_path, monkeypatch, capsys):
    with pytest.raises(SystemExit) as exit_info:
        _run_route(monkeypatch, tmp_path, [_goal("a")], "--routes", "-1")
    assert exit_info.value.code == 2 and "--routes" in capsys.readouterr().err


def test_resume_takes_verified_routes_for_the_same_instruction(tmp_path):
    backend = store.LocalBackend(tmp_path)
    done, changed, unverified, missing = (_goal(name, instruction="x") for name in ("a", "b", "c", "d"))
    for goal, changes in ((done, {}), (changed, {"instruction": "otra"}), (unverified, {"status": "unverified"})):
        _publish(backend, store.guide(START, goal.id, "desktop"), {"route.json": _route(goal, **changes)})
    assert pending_routes(backend, [done, changed, unverified, missing], None, False) == [changed, unverified, missing]


def test_verified_routes_count_toward_the_route_limit(tmp_path):
    backend = store.LocalBackend(tmp_path)
    goals = [_goal(name, instruction="x", prominence=prominence) for name, prominence in
             (("a", "buried"), ("b", "buried"), ("c", "primary"), ("d", "primary"))]
    _publish(backend, store.guide(START, "c", "desktop"), {"route.json": _route(goals[2])})
    assert [goal.id for goal in pending_routes(backend, goals, 2, False)] == ["a"]
    assert [goal.id for goal in pending_routes(backend, goals, None, False)] == ["a", "b", "d"]
    assert [goal.id for goal in pending_routes(backend, goals, 2, True)] == ["a", "b"]
