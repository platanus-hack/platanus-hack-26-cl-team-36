"""El flujo de una revisión con un invocador falso que deja las corridas de cada etapa en un almacén en disco."""

import asyncio
import collections
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path

import pytest

from shared import stages, store
from shared.catalog.goal import Goal

import main
from conductor import command, flow
from conductor.invokers import Outcome

URL = "https://sitio.cl/"
REVISION = "rev-1"


def goal(goal_id: str, prominence: str = "buried", level: str = "user_goal", gates=()) -> dict:
    return asdict(Goal(goal_id, "sitio.cl", URL, f"Objetivo {goal_id}", None, level, None, "find_info", [URL], None,
                       prominence=prominence, gates=list(gates)))


class FakeInvoker:
    """Cada etapa deja su corrida de la revisión; `results[(etapa, goal)]` puede ser failed, timeout o raise.

    `delays[(etapa, goal)]` cambia lo que tarda esa etapa; `waits[(etapa, goal)] = ("start" | "end", etapa, goal)`
    la hace terminar solo después de que otra empiece o termine.
    """

    def __init__(self, backend: store.Backend, goals: list[dict], results=None, delay: float = 0.01, delays=None,
                 waits=None):
        self.backend = backend
        self.goals = goals
        self.results = results or {}
        self.delay = delay
        self.delays = delays or {}
        self.waits = waits or {}
        self.events = collections.defaultdict(asyncio.Event)
        self.calls: list[tuple[str, str | None]] = []
        self.payloads: list[dict] = []
        self.active = self.max_active = 0

    async def run(self, stage, payload, timeout_s):
        key = (stage, payload.get("goal"))
        self.calls.append(key)
        self.payloads.append(payload)
        self.events[("start", *key)].set()
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if key in self.waits:
                await asyncio.wait_for(self.events[self.waits[key]].wait(), 5)
            await asyncio.sleep(self.delays.get(key, self.delay))
        finally:
            self.active -= 1
            self.events[("end", *key)].set()
        result = self.results.get((stage, payload.get("goal")), "succeeded")
        if result == "raise":
            raise RuntimeError("se cayó")
        if result == "timeout":
            return Outcome("failed", error=f"superó el tiempo máximo de {timeout_s:g} s")
        run = store.start_run(self.backend, stages.command(stage, payload).prefix, model="m",
                              revision=payload["revision"])
        if stage == "catalog":
            self.backend.write_json(run.key.file("goals.json"), {"issues": [], "goals": self.goals})
        if stage == "guide":
            self.backend.write_json(run.key.file("route.json"),
                                    {"status": "verified" if result == "succeeded" else "not_found"})
        store.finish_run(self.backend, run, result)
        return Outcome(result, str(run.key), None if result == "succeeded" else f"la corrida terminó {result}")


@pytest.fixture
def backend(tmp_path):
    return store.LocalBackend(tmp_path / "almacen")


def conduct(backend, invoker, **options):
    return asyncio.run(flow.conduct(backend, invoker, URL, REVISION, flow.Options(**options), log=lambda _: None))


def test_order_selection_and_payloads(backend):
    goals = [goal("b", "primary"), goal("a"), goal("c", "secondary"), goal("d", level="summary"),
             goal("e", gates=["login"]), goal("f", "primary")]
    invoker = FakeInvoker(backend, goals)
    report = conduct(backend, invoker, goals_max=3, concurrency=1, profiles="first_time", runs=2)
    assert report["status"] == "succeeded" and report["error"] is None
    assert invoker.calls == [("catalog", None), ("guide", "b"), ("visitor", "b"), ("guide", "f"), ("visitor", "f"),
                             ("guide", "c"), ("visitor", "c"), ("improver", None)]
    assert invoker.payloads[0] == {"url": URL, "revision": REVISION}
    assert invoker.payloads[2] == {"url": URL, "revision": REVISION, "goal": "b", "profiles": "first_time", "runs": 2}
    assert [entry["id"] for entry in report["goals"]] == ["b", "f", "c"]
    assert all(entry["visitor"]["status"] == "succeeded" for entry in report["goals"])
    assert report["stages"]["improver"]["run"].startswith("sitio.cl/improver/")
    assert report["stages"]["improver"]["pending_goals"] == []


def test_a_revision_without_options_runs_the_full_visitor(backend):
    """La API manda solo url y revision: cada objetivo lleva los perfiles e intentos por defecto, y la etapa los acepta."""
    invoker = FakeInvoker(backend, [goal(f"g{n}") for n in range(10)])
    report = conduct(backend, invoker)
    visitors = [payload for payload in invoker.payloads if "profiles" in payload]
    assert len(visitors) == 8
    assert visitors[0]["profiles"] == "desktop,mobile,explorador,explorador_buscador" and visitors[0]["runs"] == 2
    assert stages.command("visitor", visitors[0]).args[-4:] == (
        "--profiles", "desktop,mobile,explorador,explorador_buscador", "--runs", "2")
    assert report["options"]["goals_max"] == 8


def test_defaults_come_from_the_environment():
    env = {**os.environ, "CONDUCTOR_GOALS_MAX": "3", "CONDUCTOR_PROFILES": "desktop", "CONDUCTOR_RUNS": "4"}
    code = "from conductor import config; print(config.GOALS_MAX, config.PROFILES, config.RUNS)"
    output = subprocess.run([sys.executable, "-c", code], cwd=Path(main.__file__).parent, env=env, check=True,
                            capture_output=True, text=True).stdout
    assert output.split() == ["3", "desktop", "4"]


def test_concurrency_is_capped(backend):
    invoker = FakeInvoker(backend, [goal(f"g{n}") for n in range(5)], delay=0.05)
    report = conduct(backend, invoker, goals_max=5, concurrency=2)
    assert report["status"] == "succeeded"
    assert invoker.max_active == 2


def test_a_failed_guide_still_runs_its_visitor(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], {("guide", "a"): "failed"})
    report = conduct(backend, invoker)
    assert ("visitor", "a") in invoker.calls and ("visitor", "b") in invoker.calls
    first, second = report["goals"]
    assert first["guide"]["status"] == "failed" and first["route_verified"] is False
    assert first["visitor"]["status"] == "succeeded" and second["route_verified"] is True
    assert report["status"] == "succeeded"


def test_stage_timeout_and_errors_do_not_stop_the_others(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], {("guide", "a"): "timeout", ("visitor", "b"): "raise"},)
    report = conduct(backend, invoker, timeouts={"catalog": 1, "guide": 7, "visitor": 1, "improver": 1})
    a, b = report["goals"]
    assert a["guide"]["error"] == "superó el tiempo máximo de 7 s" and a["visitor"]["status"] == "succeeded"
    assert b["visitor"] == {"status": "failed", "run": None, "error": "RuntimeError: se cayó", "seconds": 0.0}
    assert invoker.calls[-1] == ("improver", None) and report["status"] == "succeeded"


def test_the_improver_starts_after_the_grace_with_a_visitor_done(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], waits={("guide", "b"): ("start", "improver", None)})
    report = conduct(backend, invoker, improver_grace_s=0.05)
    assert invoker.calls.index(("improver", None)) < invoker.calls.index(("visitor", "b"))
    assert report["stages"]["improver"]["pending_goals"] == ["b"] and report["status"] == "succeeded"
    assert [entry["visitor"]["status"] for entry in report["goals"]] == ["succeeded", "succeeded"]


def test_the_improver_waits_the_grace_for_the_others(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], delays={("guide", "b"): 0.1})
    report = conduct(backend, invoker, improver_grace_s=5)
    assert invoker.calls[-1] == ("improver", None) and report["stages"]["improver"]["pending_goals"] == []


def test_without_a_successful_visitor_the_improver_waits_for_all(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b"), goal("c")],
                          {("visitor", "a"): "failed", ("visitor", "b"): "failed", ("visitor", "c"): "failed"},
                          delays={("guide", "c"): 0.3})
    report = conduct(backend, invoker, improver_grace_s=0)
    assert invoker.calls[-1] == ("improver", None) and report["stages"]["improver"]["pending_goals"] == []


def test_a_late_goal_does_not_change_what_the_improver_reported(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], {("visitor", "b"): "failed"},
                          waits={("guide", "b"): ("start", "improver", None), ("improver", None): ("end", "visitor", "b")})
    report = conduct(backend, invoker, improver_grace_s=0)
    assert report["stages"]["improver"]["pending_goals"] == ["b"] and report["status"] == "succeeded"
    assert report["goals"][1]["visitor"]["status"] == "failed"


def test_the_improver_shares_the_concurrency_cap(backend):
    invoker = FakeInvoker(backend, [goal("a"), goal("b"), goal("c")], delays={("guide", "b"): 0.3, ("guide", "c"): 0.3})
    report = conduct(backend, invoker, improver_grace_s=0, concurrency=2)
    assert report["stages"]["improver"]["pending_goals"] and invoker.max_active <= 2


def test_a_goal_that_raises_does_not_cancel_the_improver(backend, monkeypatch):
    verified = flow.route_verified

    def route_verified(backend, guide):
        if "/guide/b/" in guide.run:
            raise RuntimeError("S3 no responde")
        return verified(backend, guide)

    monkeypatch.setattr(flow, "route_verified", route_verified)
    invoker = FakeInvoker(backend, [goal("a"), goal("b")], delays={("improver", None): 0.2},
                          waits={("guide", "b"): ("start", "improver", None), ("improver", None): ("end", "guide", "b")})
    report = conduct(backend, invoker, improver_grace_s=0)
    assert report["status"] == "succeeded" and report["stages"]["improver"]["status"] == "succeeded"
    b = report["goals"][1]
    assert b["error"] == "RuntimeError: S3 no responde" and b["guide"]["status"] == "succeeded" and b["visitor"] is None


@pytest.mark.parametrize("goals", [[], [goal("d", level="subfunction"), goal("e", gates=["bot_check"])]])
def test_no_evaluable_goals_fails_without_improver(backend, goals):
    invoker = FakeInvoker(backend, goals)
    report = conduct(backend, invoker)
    assert invoker.calls == [("catalog", None)]
    assert report["status"] == "failed" and report["error"] == "el catálogo no tiene objetivos evaluables"


def test_failed_catalog_fails_the_revision(backend):
    invoker = FakeInvoker(backend, [goal("a")], {("catalog", None): "failed"})
    report = conduct(backend, invoker)
    assert invoker.calls == [("catalog", None)] and report["status"] == "failed"


def test_failed_improver_fails_the_revision(backend):
    invoker = FakeInvoker(backend, [goal("a")], {("improver", None): "failed"})
    report = conduct(backend, invoker)
    assert report["status"] == "failed" and report["error"] == "la mejora falló"
    assert report["goals"][0]["visitor"]["status"] == "succeeded"


def _main(monkeypatch, backend, invoker, *args):
    monkeypatch.setattr(command, "make_invoker", lambda backend, log_dir: invoker)
    monkeypatch.setattr("sys.argv", ["main.py", "--url", URL, "--revision", REVISION, *args])
    with pytest.raises(SystemExit) as exit:
        main.main()
    conductor = store.latest_run(backend, store.conductor(URL), "succeeded" if exit.value.code == 0 else "failed")
    return exit.value.code, store.read_manifest(backend, conductor), backend.read_json(conductor.file("conductor.json"))


def test_command_writes_the_conductor_run(monkeypatch, backend):
    monkeypatch.setenv(store.ENV_VAR, backend.root.as_uri())
    code, manifest, report = _main(monkeypatch, backend, FakeInvoker(backend, [goal("a")]), "--goals-max", "1")
    assert code == 0 and manifest.revision == REVISION and manifest.status == "succeeded"
    assert report["status"] == "succeeded" and report["options"]["goals_max"] == 1
    assert report["options"]["concurrency"] == 6  # por defecto: todos los objetivos de una revisión a la vez


def test_command_fails_with_the_improver(monkeypatch, backend):
    monkeypatch.setenv(store.ENV_VAR, backend.root.as_uri())
    invoker = FakeInvoker(backend, [goal("a")], {("improver", None): "failed"})
    code, manifest, report = _main(monkeypatch, backend, invoker)
    assert code == 1 and manifest.status == "failed" and report["error"] == "la mejora falló"


def test_command_with_a_bad_invoker_leaves_a_failed_run(monkeypatch, backend):
    monkeypatch.setenv(store.ENV_VAR, backend.root.as_uri())
    monkeypatch.setenv("CONDUCTOR_INVOKER", "lambda")
    monkeypatch.setattr("sys.argv", ["main.py", "--url", URL, "--revision", REVISION])
    with pytest.raises(SystemExit) as exit:
        main.main()
    run = store.latest_run(backend, store.conductor(URL), "failed")
    assert exit.value.code == 1
    assert "no es un invocador" in json.loads((backend.root / str(run) / "conductor.json").read_text())["error"]


# El conductor con un invocador que nunca termina, para recibir SIGTERM a mitad de la revisión.
_SLOW = """
import asyncio
import main
from conductor import command

class Slow:
    async def run(self, stage, payload, timeout_s):
        await asyncio.sleep(60)

command.make_invoker = lambda backend, log_dir: Slow()
main.main()
"""


def test_sigterm_leaves_a_failed_run(backend, tmp_path):
    script = tmp_path / "slow.py"
    script.write_text(_SLOW, encoding="utf-8")
    env = {**os.environ, store.ENV_VAR: backend.root.as_uri()}
    process = subprocess.Popen([sys.executable, str(script), "--url", URL, "--revision", REVISION],
                               cwd=Path(main.__file__).parent, env={**env, "PYTHONPATH": str(Path(main.__file__).parent)},
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 20
    while store.revision_run(backend, store.conductor(URL), REVISION) is None and time.monotonic() < deadline:
        time.sleep(0.05)
    time.sleep(0.3)
    process.send_signal(signal.SIGTERM)
    assert process.wait(20) == 1, process.stderr.read().decode()
    run = store.revision_run(backend, store.conductor(URL), REVISION)
    assert store.read_manifest(backend, run).status == "failed"


@pytest.mark.parametrize("args", [["--url", "sitio.cl"], ["--url", URL, "--goals-max", "50"],
                                  ["--url", URL, "--profiles", "x,-y"]])
def test_command_rejects_what_a_stage_would_reject(monkeypatch, backend, args):
    monkeypatch.setenv(store.ENV_VAR, backend.root.as_uri())
    monkeypatch.setattr("sys.argv", ["main.py", "--revision", REVISION, *args])
    with pytest.raises(SystemExit) as exit:
        main.main()
    assert exit.value.code == 2 and not backend.root.exists()
