from pathlib import Path

import pytest

from dispatcher import APPS_DIR, InvalidRequest, own_runtime_arn, parse_request, run_stage
from shared import store

URL = "https://www.wom.cl/planes"
REV = "rev-1"
ARN = "arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/ChameleonAgents_default_chameleon-abc"
OTEL = f"service.name=x,cloud.resource_id={ARN}/runtime-endpoint/DEFAULT:DEFAULT,cloud.provider=aws"


def payload(stage: str, **extra) -> dict:
    return {"stage": stage, "revision": REV, "url": URL, **extra}


@pytest.fixture
def backend(tmp_path: Path) -> store.Backend:
    return store.LocalBackend(tmp_path)


def manifests(backend: store.Backend, prefix: store.RunPrefix) -> list[store.Manifest]:
    return [store.read_manifest(backend, run) for run in backend.list_runs(prefix)]


@pytest.mark.parametrize(
    ("stage", "extra", "app", "args"),
    [
        ("revision", {"goals_max": 2}, "conductor", ["--url", URL, "--revision", REV, "--goals-max", "2"]),
        ("catalog", {}, "cataloger", ["--url", URL, "--revision", REV, "--pages", "1"]),
        ("guide", {"goal": "baja"}, "guide", ["route", "--url", URL, "--revision", REV, "--goal", "baja"]),
        ("visitor", {"goal": "baja", "runs": 1}, "visitor",
         ["--url", URL, "--revision", REV, "--goal", "baja", "--runs", "1"]),
        ("improver", {}, "web_designer", ["--url", URL, "--revision", REV]),
    ],
)
def test_each_stage_runs_its_app_cli(stage: str, extra: dict, app: str, args: list[str]) -> None:
    request = parse_request(payload(stage, **extra))
    assert (request.stage, request.revision, request.command.app) == (stage, REV, app)
    assert request.command.argv[-len(args):] == args
    assert request.command.argv[:2] == ["uv", "run"]
    assert (APPS_DIR / "runtime").is_dir()


@pytest.mark.parametrize(
    "bad",
    [
        None,
        ["catalog"],
        payload("explore"),
        payload("catalog", url="ftp://x"),
        {"stage": "catalog", "url": URL},
        payload("catalog", revision="Rev 1"),
        payload("guide"),
        payload("visitor", goal="baja", runs="muchos"),
    ],
)
def test_invalid_requests(bad) -> None:
    with pytest.raises(InvalidRequest):
        parse_request(bad)


def test_success_leaves_the_store_alone(backend: store.Backend) -> None:
    request = parse_request(payload("catalog"))
    assert run_stage(request, backend=backend, runner=lambda request, env: 0, environ={}) == 0
    assert backend.list_runs(request.command.prefix) == []


def test_failure_without_a_run_writes_a_failed_one(backend: store.Backend) -> None:
    request = parse_request(payload("guide", goal="baja"))
    assert run_stage(request, backend=backend, runner=lambda request, env: 2, environ={}) == 2
    [manifest] = manifests(backend, request.command.prefix)
    assert (manifest.status, manifest.revision, manifest.goal) == ("failed", REV, "baja")


def test_a_cli_that_cannot_start_counts_as_failed(backend: store.Backend) -> None:
    def missing(request, env):
        raise FileNotFoundError("uv")

    request = parse_request(payload("improver"))
    assert run_stage(request, backend=backend, runner=missing, environ={}) != 0
    assert [m.status for m in manifests(backend, request.command.prefix)] == ["failed"]


def test_failure_with_its_own_failed_run_adds_nothing(backend: store.Backend) -> None:
    request = parse_request(payload("catalog"))

    def fails_cleanly(request, env):
        with pytest.raises(RuntimeError):
            with store.running(backend, request.command.prefix, model="haiku", revision=REV):
                raise RuntimeError("sin objetivos")
        return 1

    run_stage(request, backend=backend, runner=fails_cleanly, environ={})
    assert [m.status for m in manifests(backend, request.command.prefix)] == ["failed"]


def test_failure_closes_a_run_left_running(backend: store.Backend) -> None:
    request = parse_request(payload("visitor", goal="baja"))

    def dies(request, env):
        store.start_run(backend, request.command.prefix, model="haiku", revision=REV)
        return -9

    run_stage(request, backend=backend, runner=dies, environ={})
    [manifest] = manifests(backend, request.command.prefix)
    assert (manifest.status, manifest.model) == ("failed", "haiku")


def test_a_run_of_another_revision_does_not_count(backend: store.Backend) -> None:
    request = parse_request(payload("catalog"))
    store.finish_run(backend, store.start_run(backend, request.command.prefix, model=None, revision="otra"), "failed")
    run_stage(request, backend=backend, runner=lambda request, env: 1, environ={})
    assert sorted(m.revision for m in manifests(backend, request.command.prefix)) == ["otra", REV]


def test_revision_runs_the_conductor_against_this_runtime(backend: store.Backend) -> None:
    seen = {}

    def runner(request, env):
        seen.update(env)
        return 0

    request = parse_request(payload("revision"))
    run_stage(request, backend=backend, runner=runner, environ={"OTEL_RESOURCE_ATTRIBUTES": OTEL, "PATH": "/bin"})
    assert seen["CONDUCTOR_INVOKER"] == "agentcore"
    assert seen["CONDUCTOR_RUNTIME_ARN"] == ARN
    assert seen["PATH"] == "/bin"


def test_other_stages_do_not_get_the_invoker(backend: store.Backend) -> None:
    seen = {}
    request = parse_request(payload("catalog"))
    run_stage(request, backend=backend, runner=lambda request, env: seen.update(env) or 0,
              environ={"OTEL_RESOURCE_ATTRIBUTES": OTEL})
    assert "CONDUCTOR_INVOKER" not in seen


def test_revision_without_an_arn_fails_its_conductor_run(backend: store.Backend) -> None:
    calls = []
    request = parse_request(payload("revision"))
    run_stage(request, backend=backend, runner=lambda request, env: calls.append(env) or 0, environ={})
    assert calls == []
    [manifest] = manifests(backend, store.conductor(URL))
    assert (manifest.agent, manifest.status, manifest.revision) == ("conductor", "failed", REV)


def test_own_runtime_arn() -> None:
    assert own_runtime_arn({"OTEL_RESOURCE_ATTRIBUTES": OTEL}) == ARN
    assert own_runtime_arn({"OTEL_RESOURCE_ATTRIBUTES": OTEL, "CONDUCTOR_RUNTIME_ARN": "arn:x"}) == "arn:x"
    assert own_runtime_arn({"OTEL_RESOURCE_ATTRIBUTES": "service.name=x"}) is None
    assert own_runtime_arn({}) is None
