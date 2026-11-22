import logging
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_s3 import FakeS3

from shared.store import TRACE, LiveTrace, LocalBackend, S3Backend, finish_run, guide, start_run, visitor

MOMENT = datetime(2026, 11, 21, 10, 44, 22, tzinfo=UTC)
START = {"url": "https://wom.cl/", "title": "Inicio", "screenshot": "step_00.png"}


def test_s3_publishes_a_file_of_a_run_in_progress_with_its_content_type() -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "runs", client)
    run = start_run(backend, visitor("wom.cl", "baja"), model=None, clock=lambda: MOMENT)
    (run.workdir / "desktop").mkdir()
    (run.workdir / "desktop" / "step_01.png").write_bytes(b"png")
    (run.workdir / "report.md").write_text("# a medias")
    backend.publish_file(run.key, run.workdir, "step_01.png", "desktop")

    key = f"runs/{run.key.file('step_01.png', 'desktop')}"
    assert client.objects[("bucket", key)] == (b"png", "image/png")
    assert client.uploaded == [key]
    assert run.workdir.exists()


def test_s3_publishing_a_missing_file_removes_the_published_one() -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "", client)
    run = start_run(backend, guide("wom.cl", "baja", "desktop"), model=None, clock=lambda: MOMENT)
    (run.workdir / "step_03.png").write_bytes(b"png")
    backend.publish_file(run.key, run.workdir, "step_03.png")
    (run.workdir / "step_03.png").unlink()
    backend.publish_file(run.key, run.workdir, "step_03.png")
    assert ("bucket", run.key.file("step_03.png")) not in client.objects


def test_a_failed_upload_is_a_warning_and_never_an_exception(monkeypatch, caplog) -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "", client)
    run = start_run(backend, guide("wom.cl", "baja", "desktop"), model=None, clock=lambda: MOMENT)
    (run.workdir / "step_01.png").write_bytes(b"png")

    def denied(*args, **kwargs):
        raise ConnectionError("sin red")

    monkeypatch.setattr(client, "upload_file", denied)
    with caplog.at_level(logging.WARNING):
        backend.publish_file(run.key, run.workdir, "step_01.png")
        backend.publish_file(run.key, run.workdir, "Mal nombre")
    assert "sin red" in caplog.text and "Mal nombre" in caplog.text


def test_local_workdir_is_already_the_store(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    run = start_run(backend, guide("wom.cl", "baja", "desktop"), model=None, clock=lambda: MOMENT)
    (run.workdir / "step_01.png").write_bytes(b"png")
    backend.publish_file(run.key, run.workdir, "step_01.png")
    assert backend.read_bytes(run.key.file("step_01.png")) == b"png"


def test_local_copies_from_another_workdir(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path / "almacen")
    run = start_run(backend, visitor("wom.cl", "baja"), model=None, clock=lambda: MOMENT)
    elsewhere = tmp_path / "trabajo"
    (elsewhere / "desktop").mkdir(parents=True)
    (elsewhere / "desktop" / "step_01.png").write_bytes(b"png")
    backend.publish_file(run.key, elsewhere, "step_01.png", "desktop")
    assert backend.read_bytes(run.key.file("step_01.png", "desktop")) == b"png"
    (elsewhere / "desktop" / "step_01.png").unlink()
    backend.publish_file(run.key, elsewhere, "step_01.png", "desktop")
    assert not backend.exists(run.key.file("step_01.png", "desktop"))


@pytest.mark.parametrize("folder", [None, "desktop-2"])
def test_live_trace_uploads_the_new_capture_and_trace_only(folder) -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "", client)
    prefix = visitor("wom.cl", "baja") if folder else guide("wom.cl", "baja", "desktop")
    run = start_run(backend, prefix, model=None, revision="rev-1", clock=lambda: MOMENT)
    trace = LiveTrace(backend, run, "visitor" if folder else "guide", "desktop" if folder else None, folder,
                      clock=lambda: MOMENT)
    directory = trace.directory
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "step_00.png").write_bytes(b"0")
    trace.write("running", START, [], publish=["step_00.png"])
    (directory / "step_01.png").write_bytes(b"1")
    client.uploaded.clear()
    trace.write("running", START, [{"number": 1}], publish=["step_01.png"])

    assert client.uploaded == [run.key.file("step_01.png", folder), run.key.file(TRACE, folder)]
    published = backend.read_json(run.key.file(TRACE, folder))
    assert published == {
        "schema_version": 1, "agent": trace.agent, "goal": "baja", "revision": "rev-1", "profile": trace.profile,
        "status": "running", "updated_at": "2026-11-21T10:44:22Z", "start": START, "steps": [{"number": 1}],
    }

    trace.write("succeeded", START, [{"number": 1}])
    assert backend.read_json(run.key.file(TRACE, folder))["status"] == "running"
    finish_run(backend, run, "succeeded")
    assert backend.read_json(run.key.file(TRACE, folder))["status"] == "succeeded"


def test_live_trace_discard_removes_locally_and_from_the_store() -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "", client)
    run = start_run(backend, guide("wom.cl", "baja", "desktop"), model=None, clock=lambda: MOMENT)
    trace = LiveTrace(backend, run, "guide")
    (run.workdir / "step_05.png").write_bytes(b"5")
    trace.write("running", START, [], publish=["step_05.png"])
    trace.discard(["step_05.png"])
    assert not (run.workdir / "step_05.png").exists()
    assert not backend.exists(run.key.file("step_05.png"))
    assert sorted(path.name for path in run.workdir.iterdir()) == [TRACE]
