from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fake_s3 import FakeS3

from shared.store import (
    Backend,
    Clock,
    LocalBackend,
    Manifest,
    S3Backend,
    cataloger,
    finish_run,
    guide,
    latest_run,
    read_manifest,
    start_run,
)
from shared.store.run_ids import MAX_SEQUENCE

MOMENT = datetime(2026, 11, 21, 10, 44, 22, tzinfo=UTC)


def clock_at(seconds: int) -> Clock:
    return lambda: MOMENT + timedelta(seconds=seconds)


@pytest.fixture(params=["local", "s3"])
def backend(request: pytest.FixtureRequest, tmp_path: Path) -> Backend:
    return LocalBackend(tmp_path) if request.param == "local" else S3Backend("bucket", "runs", FakeS3())


def test_lifecycle_and_lineage(backend: Backend) -> None:
    source = start_run(backend, cataloger("wom.cl"), model="sonnet", clock=lambda: MOMENT)
    run = start_run(
        backend, guide("wom.cl", "baja-fibra", "desktop"), model="sonnet", inputs=[source.key], clock=lambda: MOMENT
    )

    running = read_manifest(backend, run.key)
    assert running.status == "running"
    assert running.finished_at is None
    assert running.inputs == ("wom.cl/cataloger/2026-11-21T10-44-22Z",)

    (run.workdir / "route.json").write_text("{}")
    finished = finish_run(backend, run, "succeeded", clock=lambda: MOMENT + timedelta(minutes=3))

    assert read_manifest(backend, run.key) == finished
    assert backend.read_json(run.key.file("manifest.json")) == {
        "agent": "guide",
        "host": "wom.cl",
        "goal": "baja-fibra",
        "viewport": "desktop",
        "run_id": "2026-11-21T10-44-22Z",
        "started_at": "2026-11-21T10:44:22Z",
        "status": "succeeded",
        "model": "sonnet",
        "inputs": ["wom.cl/cataloger/2026-11-21T10-44-22Z"],
        "finished_at": "2026-11-21T10:47:22Z",
        "schema_version": 1,
    }
    assert backend.read_text(run.key.file("route.json")) == "{}"


def test_gives_up_after_the_last_sequence(backend: Backend) -> None:
    prefix = cataloger("wom.cl")
    for _ in range(MAX_SEQUENCE + 1):
        start_run(backend, prefix, model=None, clock=lambda: MOMENT)
    with pytest.raises(RuntimeError):
        start_run(backend, prefix, model=None, clock=lambda: MOMENT)


def test_latest_run_by_status(backend: Backend) -> None:
    prefix = cataloger("wom.cl")
    assert latest_run(backend, prefix) is None
    done, failed, running = (start_run(backend, prefix, model=None, clock=clock_at(i)) for i in range(3))
    finish_run(backend, done, "succeeded")
    finish_run(backend, failed, "failed")

    assert backend.list_runs(prefix) == [done.key, failed.key, running.key]
    assert latest_run(backend, prefix) == done.key
    assert latest_run(backend, prefix, "failed") == failed.key
    assert latest_run(backend, prefix, "running") == running.key


def test_finished_run_is_not_republished(backend: Backend) -> None:
    run = start_run(backend, cataloger("wom.cl"), model=None, clock=lambda: MOMENT)
    (run.workdir / "goals.json").write_text("[]")
    finished = finish_run(backend, run, "succeeded", clock=lambda: MOMENT)
    run.workdir.mkdir(exist_ok=True)
    (run.workdir / "goals.json").write_text("[1]")

    with pytest.raises(RuntimeError):
        finish_run(backend, run, "failed", clock=lambda: MOMENT + timedelta(minutes=1))
    assert read_manifest(backend, run.key) == finished


def test_finish_skips_hidden_files(backend: Backend) -> None:
    run = start_run(backend, cataloger("wom.cl"), model=None, clock=lambda: MOMENT)
    (run.workdir / ".DS_Store").write_bytes(b"x")
    (run.workdir / "goals.json").write_text("[]")

    assert finish_run(backend, run, "succeeded").status == "succeeded"
    assert backend.read_text(run.key.file("goals.json")) == "[]"


def test_manifest_ignores_unknown_fields() -> None:
    data: dict[str, Any] = {
        "agent": "cataloger",
        "host": "wom.cl",
        "goal": None,
        "viewport": None,
        "run_id": "2026-11-21T10-44-22Z",
        "started_at": "2026-11-21T10:44:22Z",
        "status": "running",
        "model": None,
        "inputs": [],
        "schema_version": 2,
        "cost_usd": 0.12,
    }
    assert Manifest.from_dict(data).schema_version == 2
