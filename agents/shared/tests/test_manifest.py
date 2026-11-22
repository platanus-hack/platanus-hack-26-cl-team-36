from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fake_s3 import FakeS3

from shared.store import (
    Backend,
    Clock,
    InvalidKey,
    LocalBackend,
    Manifest,
    S3Backend,
    cataloger,
    conductor,
    finish_run,
    guide,
    latest_run,
    read_manifest,
    revision_run,
    running,
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


def test_running_finishes_succeeded_or_failed(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = cataloger("wom.cl")
    with running(backend, prefix, model=None) as done:
        (done.workdir / "goals.json").write_text("[]")
    with pytest.raises(RuntimeError), running(backend, prefix, model=None) as broken:
        raise RuntimeError("falla")
    assert [read_manifest(backend, run.key).status for run in (done, broken)] == ["succeeded", "failed"]


def test_a_run_that_cannot_be_published_ends_failed_with_the_original_error(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    with pytest.raises(InvalidKey), running(backend, cataloger("wom.cl"), model=None) as run:
        (run.workdir / "Sin Extension").write_text("x")
    assert read_manifest(backend, run.key).status == "failed"


def test_latest_run_skips_empty_folders_and_unreadable_manifests(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = cataloger("wom.cl")
    good = start_run(backend, prefix, model=None, clock=lambda: MOMENT)
    finish_run(backend, good, "succeeded")
    (tmp_path / str(prefix) / "2026-11-21T11-00-00Z").mkdir()
    truncated = tmp_path / str(prefix) / "2026-11-21T12-00-00Z"
    truncated.mkdir()
    (truncated / "manifest.json").write_text('{"agent": "catal')
    assert latest_run(backend, prefix) == good.key


def test_revision_is_written_only_when_given(backend: Backend) -> None:
    plain = start_run(backend, cataloger("wom.cl"), model=None, clock=lambda: MOMENT)
    tagged = start_run(backend, conductor("wom.cl"), model=None, revision="r-20261121-ab12", clock=lambda: MOMENT)

    assert "revision" not in backend.read_json(plain.key.file("manifest.json"))
    assert read_manifest(backend, plain.key).revision is None
    assert backend.read_json(tagged.key.file("manifest.json"))["revision"] == "r-20261121-ab12"
    finished = finish_run(backend, tagged, "succeeded")
    assert read_manifest(backend, tagged.key) == finished
    assert finished.revision == "r-20261121-ab12"


@pytest.mark.parametrize("revision", ["", "R1", "a_b", "a--b", "-a", "a-", "a" * 41])
def test_invalid_revision_is_rejected(tmp_path: Path, revision: str) -> None:
    with pytest.raises(ValueError):
        start_run(LocalBackend(tmp_path), cataloger("wom.cl"), model=None, revision=revision)


def test_revision_run_is_the_newest_of_that_revision_in_any_status(backend: Backend) -> None:
    prefix = cataloger("wom.cl")
    assert revision_run(backend, prefix, "a1") is None
    old, other, newest, untagged = (
        start_run(backend, prefix, model=None, revision=revision, clock=clock_at(i))
        for i, revision in enumerate(["a1", "b2", "a1", None])
    )
    finish_run(backend, old, "succeeded")
    finish_run(backend, other, "succeeded")

    assert revision_run(backend, prefix, "a1") == newest.key
    finish_run(backend, newest, "failed")
    assert revision_run(backend, prefix, "a1") == newest.key
    assert revision_run(backend, prefix, "b2") == other.key
    assert revision_run(backend, prefix, "c3") is None
    assert latest_run(backend, prefix, "running") == untagged.key


def test_revision_run_skips_unreadable_manifests(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = cataloger("wom.cl")
    good = start_run(backend, prefix, model=None, revision="a1", clock=lambda: MOMENT)
    broken = tmp_path / str(prefix) / "2026-11-21T12-00-00Z"
    broken.mkdir()
    (broken / "manifest.json").write_text('{"revision": "a1"')
    assert revision_run(backend, prefix, "a1") == good.key
    with pytest.raises(ValueError):
        revision_run(backend, prefix, "No Valida")


def test_running_passes_the_revision(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    with running(backend, cataloger("wom.cl"), model=None, revision="a1") as run:
        pass
    assert read_manifest(backend, run.key).revision == "a1"


def test_revision_run_does_not_read_runs_older_than_since() -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "runs", client)
    prefix = conductor("wom.cl")
    old = [start_run(backend, prefix, model=None, revision="a1", clock=clock_at(i)) for i in range(5)]
    newest = start_run(backend, prefix, model=None, revision="b2", clock=clock_at(60))
    reads: list[str] = []
    get_object = client.get_object
    client.get_object = lambda **args: reads.append(args["Key"]) or get_object(**args)  # type: ignore[method-assign]

    assert revision_run(backend, prefix, "a1") == old[-1].key
    assert revision_run(backend, prefix, "a1", since=MOMENT + timedelta(seconds=30)) is None
    assert revision_run(backend, prefix, "b2", since=MOMENT + timedelta(seconds=60, microseconds=5)) == newest.key
    assert len(reads) == 2 + 1 + 1
