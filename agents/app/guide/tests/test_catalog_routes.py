"""Rutas de los objetivos de un catálogo sin Claude: qué se mapea, qué se reutiliza y qué pasa si una falla."""

import json
from contextlib import asynccontextmanager
from dataclasses import asdict

import pytest

from shared.catalog.goal import Goal

from guide import config, reference, route_command
from guide.catalog_routes import pending_routes, route_path
from main import build_parser

START = "https://www.sitio.cl/"


def _goal(goal_id: str, **changes) -> Goal:
    fields = {"id": goal_id, "host": "www.sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [START], "entry": None}
    return Goal(**{**fields, **changes})


def _run_route(monkeypatch, tmp_path, goals: list[Goal], *options):
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")

    @asynccontextmanager
    async def fake_browser(cdp_url):
        yield None

    monkeypatch.setattr(route_command, "open_browser", fake_browser)
    catalog = tmp_path / "goals.json"
    catalog.write_text(json.dumps({"issues": [], "goals": [asdict(goal) for goal in goals]}), encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(["route", "--goals", str(catalog), *options])
    route_command.run(parser, args)


def test_a_failed_goal_route_does_not_stop_the_others(tmp_path, monkeypatch, capsys):
    async def fake_map_reference(browser, mapping, decider):
        if mapping.task_id == "sitio-roto":
            raise RuntimeError("se cayó")
        return {"status": "verified", "totals": {"min_steps": 7}}

    monkeypatch.setattr(reference, "map_reference", fake_map_reference)
    goals = [_goal("sitio-info"), _goal("sitio-roto"), _goal("sitio-pagina", intent="reach_page")]
    _run_route(monkeypatch, tmp_path, goals, "--routes", "all")
    out = capsys.readouterr().out
    assert "sitio-roto desktop: error interno, RuntimeError: se cayó" in out
    assert "sitio-info desktop: verified, 7 pasos mínimos" in out and "sitio-pagina desktop: verified" in out


def test_negative_routes_are_rejected(tmp_path, monkeypatch, capsys):
    with pytest.raises(SystemExit) as exit_info:
        _run_route(monkeypatch, tmp_path, [_goal("sitio-a")], "--routes", "-1")
    assert exit_info.value.code == 2 and "--routes" in capsys.readouterr().err


def test_resume_takes_verified_routes_for_the_same_instruction(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")
    done, changed, unverified, missing = (_goal(f"sitio-{name}", instruction="x") for name in ("a", "b", "c", "d"))
    route = {"status": "verified", "instruction": "x", "answer": "Sí.",
             "totals": {"min_steps": 3, "actions": 2, "distinct_pages": 2},
             "nodes": ["a", "b"], "final_node": "b"}
    for goal, changes in ((done, {}), (changed, {"instruction": "otra"}), (unverified, {"status": "unverified"})):
        route_path(goal).parent.mkdir(parents=True)
        route_path(goal).write_text(json.dumps({**route, **changes}), encoding="utf-8")
    assert pending_routes([done, changed, unverified, missing], None, False) == [changed, unverified, missing]


def test_verified_routes_count_toward_the_route_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / ".runs")
    goals = [_goal(f"sitio-{name}", instruction="x", prominence=prominence) for name, prominence in
             (("a", "buried"), ("b", "buried"), ("c", "primary"), ("d", "primary"))]
    route_path(goals[2]).parent.mkdir(parents=True)
    route_path(goals[2]).write_text(json.dumps({
        "status": "verified", "instruction": "x", "answer": "", "totals": {"min_steps": 1, "actions": 1, "distinct_pages": 1},
        "nodes": ["a"], "final_node": "a"}), encoding="utf-8")
    assert [goal.id for goal in pending_routes(goals, 2, False)] == ["sitio-a"]
    assert [goal.id for goal in pending_routes(goals, None, False)] == ["sitio-a", "sitio-b", "sitio-d"]
    assert [goal.id for goal in pending_routes(goals, 2, True)] == ["sitio-a", "sitio-b"]
