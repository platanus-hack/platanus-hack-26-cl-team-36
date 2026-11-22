"""Los invocadores: `local` con apps falsas como subprocesos y `agentcore` con un cliente falso."""

import asyncio
import io
import json
import sys
import textwrap
from datetime import timedelta

import pytest

from shared import store

from conductor import config, invokers
from conductor.invokers import AgentCoreInvoker, LocalInvoker

URL = "https://sitio.cl/"
REVISION = "rev-1"
CATALOG = {"url": URL, "revision": REVISION}

# Una app falsa: deja la corrida de la revisión y termina como dice su variable APP_<nombre>.
APP = textwrap.dedent("""
    import argparse, os, sys, time
    from shared import store
    parser = argparse.ArgumentParser()
    parser.add_argument("--url"); parser.add_argument("--revision"); parser.add_argument("--pages")
    args = parser.parse_args()
    print("argv", sys.argv[1:], "venv", os.environ.get("VIRTUAL_ENV"), flush=True)
    backend = store.open_backend()
    run = store.start_run(backend, store.cataloger(args.url), model="m", revision=args.revision)
    mode = os.environ["APP_MODE"]
    if mode == "sleep":
        time.sleep(60)
    store.finish_run(backend, run, "succeeded" if mode == "ok" else "failed")
    sys.exit(0 if mode == "ok" else 3)
""")


@pytest.fixture
def backend(tmp_path, monkeypatch):
    root = tmp_path / "almacen"
    monkeypatch.setenv(store.ENV_VAR, root.as_uri())
    return store.LocalBackend(root)


@pytest.fixture
def local(tmp_path, backend):
    (tmp_path / "apps" / "cataloger").mkdir(parents=True)
    (tmp_path / "apps" / "cataloger" / "main.py").write_text(APP, encoding="utf-8")
    (tmp_path / "logs").mkdir()
    return LocalInvoker(backend, tmp_path / "apps", tmp_path / "logs", command=(sys.executable, "main.py"))


def test_local_succeeds_with_the_run_of_the_revision(local, tmp_path, monkeypatch):
    monkeypatch.setenv("APP_MODE", "ok")
    monkeypatch.setenv("VIRTUAL_ENV", "/otro/venv")
    outcome = asyncio.run(local.run("catalog", CATALOG, 30))
    assert outcome.status == "succeeded" and outcome.error is None
    assert outcome.run.startswith("sitio.cl/cataloger/")
    log = (tmp_path / "logs" / "catalog.log").read_text()
    assert f"['--url', '{URL}', '--revision', '{REVISION}', '--pages', '1']" in log and "venv None" in log


def test_local_fails_with_the_exit_code(local, monkeypatch):
    monkeypatch.setenv("APP_MODE", "fail")
    outcome = asyncio.run(local.run("catalog", CATALOG, 30))
    assert outcome.status == "failed" and outcome.error == "salió con código 3" and outcome.run


def test_local_timeout_kills_the_stage_and_closes_its_run(local, backend, monkeypatch):
    monkeypatch.setenv("APP_MODE", "sleep")
    outcome = asyncio.run(local.run("catalog", CATALOG, 1.5))
    assert outcome.status == "failed" and outcome.error == "superó el tiempo máximo de 1.5 s"
    assert outcome.seconds < 10
    assert store.read_manifest(backend, store.parse_key(outcome.run).run).status == "failed"


def test_local_cancellation_kills_the_stage_and_closes_its_run(local, backend, monkeypatch):
    monkeypatch.setenv("APP_MODE", "sleep")

    async def cancel_once_started():
        task = asyncio.create_task(local.run("catalog", CATALOG, 60))
        while store.revision_run(backend, store.cataloger(URL), REVISION) is None:
            await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(cancel_once_started(), 20))
    run = store.revision_run(backend, store.cataloger(URL), REVISION)
    assert store.read_manifest(backend, run).status == "failed"


class FakeClient:
    def __init__(self, on_invoke=None, error=None):
        self.calls = []
        self.on_invoke = on_invoke
        self.error = error

    def invoke_agent_runtime(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        if self.on_invoke:
            self.on_invoke(json.loads(kwargs["payload"]))
        return {"response": io.BytesIO(b'{"status": "accepted"}')}


class FakeTime:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []
        self.on_sleep = None

    def monotonic(self):
        return self.now

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds
        if self.on_sleep:
            self.on_sleep(len(self.sleeps))


def agentcore(backend, client, fake_time):
    return AgentCoreInvoker(backend, "arn:runtime", client=client, poll_s=10, poll_first_s=10, sleep=fake_time.sleep,
                            monotonic=fake_time.monotonic)


def test_agentcore_payload_and_a_new_session_per_stage(backend):
    def finish(payload):
        prefix = store.guide(URL, payload["goal"], "desktop") if payload["stage"] == "guide" else store.cataloger(URL)
        store.finish_run(backend, store.start_run(backend, prefix, model="m", revision=payload["revision"]), "succeeded")

    client = FakeClient(on_invoke=finish)
    invoker = agentcore(backend, client, FakeTime())
    assert asyncio.run(invoker.run("catalog", CATALOG, 60)).status == "succeeded"
    assert asyncio.run(invoker.run("guide", {**CATALOG, "goal": "a", "profiles": None}, 60)).status == "succeeded"
    first, second = client.calls
    assert first["agentRuntimeArn"] == "arn:runtime" and first["contentType"] == "application/json"
    assert json.loads(first["payload"]) == {"stage": "catalog", "url": URL, "revision": REVISION}
    assert json.loads(second["payload"]) == {"stage": "guide", "url": URL, "revision": REVISION, "goal": "a"}
    assert first["runtimeSessionId"] != second["runtimeSessionId"]
    assert all(len(call["runtimeSessionId"]) >= 33 for call in client.calls)


def test_agentcore_waits_for_the_new_manifest_since_the_invocation(backend):
    # Una corrida vieja de la misma revisión ya terminó: no es la de esta invocación.
    old = store.start_run(backend, store.cataloger(URL), model="m", revision=REVISION,
                          clock=lambda: store.utc_now() - timedelta(hours=1))
    store.finish_run(backend, old, "failed")
    fake_time = FakeTime()
    runs = {}

    def stage_progress(polls):
        if polls == 1:
            runs["new"] = store.start_run(backend, store.cataloger(URL), model="m", revision=REVISION)
        if polls == 3:
            store.finish_run(backend, runs["new"], "succeeded")

    fake_time.on_sleep = stage_progress
    outcome = asyncio.run(agentcore(backend, FakeClient(), fake_time).run("catalog", CATALOG, 600))
    assert outcome.status == "succeeded" and outcome.run == str(runs["new"].key)
    assert fake_time.sleeps == [10, 10, 10] and outcome.seconds == 30


def test_agentcore_timeout(backend):
    fake_time = FakeTime()
    outcome = asyncio.run(agentcore(backend, FakeClient(), fake_time).run("catalog", CATALOG, 25))
    assert outcome.status == "failed" and outcome.error == "superó el tiempo máximo de 25 s" and outcome.run is None
    assert fake_time.sleeps == [10, 10, 5]


def test_agentcore_polls_soon_and_then_less_often(backend):
    fake_time = FakeTime()
    invoker = AgentCoreInvoker(backend, "arn:runtime", client=FakeClient(), poll_s=5, poll_first_s=1,
                               sleep=fake_time.sleep, monotonic=fake_time.monotonic)
    assert asyncio.run(invoker.run("catalog", CATALOG, 20)).status == "failed"
    assert fake_time.sleeps == [1, 1.5, 2.25, 3.375, 5, 5, 1.875]
    assert AgentCoreInvoker(backend, "arn:runtime", client=FakeClient(), poll_s=0.5).poll_first_s == 0.5


def test_agentcore_invoke_error(backend):
    outcome = asyncio.run(agentcore(backend, FakeClient(error=RuntimeError("sin permiso")), FakeTime())
                          .run("catalog", CATALOG, 25))
    assert outcome.status == "failed" and "sin permiso" in outcome.error


def test_make_invoker(backend, monkeypatch):
    monkeypatch.delenv(config.INVOKER_VAR, raising=False)
    assert isinstance(invokers.make_invoker(backend, None), LocalInvoker)
    monkeypatch.setenv(config.INVOKER_VAR, "agentcore")
    monkeypatch.delenv(config.RUNTIME_ARN_VAR, raising=False)
    with pytest.raises(ValueError, match=config.RUNTIME_ARN_VAR):
        invokers.make_invoker(backend, None)


def test_timeouts_from_the_environment(monkeypatch):
    monkeypatch.setenv("CONDUCTOR_TIMEOUT_GUIDE_S", "30")
    assert config.timeouts() == {**config.TIMEOUTS_S, "guide": 30.0}
    monkeypatch.setenv("CONDUCTOR_TIMEOUT_GUIDE_S", "-1")
    with pytest.raises(ValueError):
        config.timeouts()
    monkeypatch.setenv("CONDUCTOR_TIMEOUT_GUIDE_S", "0")
    with pytest.raises(ValueError):
        config.timeouts()


def test_improver_grace_from_the_environment(monkeypatch):
    monkeypatch.delenv(config.GRACE_VAR, raising=False)
    assert config.improver_grace_s() == 45
    monkeypatch.setenv(config.GRACE_VAR, "0")
    assert config.improver_grace_s() == 0
    monkeypatch.setenv(config.GRACE_VAR, "-1")
    with pytest.raises(ValueError):
        config.improver_grace_s()


def test_agentcore_client_retries_throttling(backend, monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "x")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "x")
    client = AgentCoreInvoker(backend, "arn:runtime").client
    assert client.meta.service_model.service_name == "bedrock-agentcore"
    assert client.meta.config.retries == {"mode": "standard", "total_max_attempts": 6}
