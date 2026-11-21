from datetime import UTC, datetime, timedelta

import pytest
from fake_s3 import ClientError, FakeS3

from shared.store import Clock, S3Backend, cataloger, finish_run, start_run, visitor

MOMENT = datetime(2026, 11, 21, 10, 44, 22, tzinfo=UTC)


def clock_at(moment: datetime) -> Clock:
    return lambda: moment


def test_publish_uploads_with_content_types_and_cleans_workdir() -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "/runs/", client)
    run = start_run(backend, visitor("wom.cl", "baja-fibra"), model="haiku", clock=lambda: MOMENT)
    (run.workdir / "first_time").mkdir()
    (run.workdir / "first_time" / "video.webm").write_bytes(b"webm")
    (run.workdir / "first_time" / "step_00.png").write_bytes(b"png")
    (run.workdir / "report.md").write_text("# Reporte\n")
    (run.workdir / "comparison.json").write_text("{}")
    finish_run(backend, run, "succeeded")

    base = "runs/wom.cl/visitor/baja-fibra/2026-11-21T10-44-22Z"
    assert {key: kind for (_, key), (_, kind) in client.objects.items()} == {
        f"{base}/manifest.json": "application/json",
        f"{base}/comparison.json": "application/json",
        f"{base}/report.md": "text/markdown; charset=utf-8",
        f"{base}/first_time/step_00.png": "image/png",
        f"{base}/first_time/video.webm": "video/webm",
    }
    assert not run.workdir.exists()


def test_latest_lists_with_delimiter_across_pages() -> None:
    client = FakeS3(page_size=2)
    backend = S3Backend("bucket", "", client)
    prefix = cataloger("wom.cl")
    moments = [MOMENT + timedelta(seconds=i) for i in range(5)]
    runs = [start_run(backend, prefix, model=None, clock=clock_at(moment)) for moment in moments]
    start_run(backend, cataloger("sii.cl"), model=None, clock=lambda: MOMENT + timedelta(hours=1))

    assert backend.list_runs(prefix) == [run.key for run in runs]
    assert backend.latest_run(prefix) == runs[-1].key
    assert not any("latest" in key for _, key in client.objects)


def test_exists_and_unexpected_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeS3()
    backend = S3Backend("bucket", "", client)
    key = cataloger("wom.cl").run("2026-11-21T10-44-22Z").file("goals.json")
    assert not backend.exists(key)
    backend.write_json(key, [])
    assert backend.exists(key)

    def denied(**_: object) -> None:
        raise ClientError("AccessDenied")

    monkeypatch.setattr(client, "head_object", denied)
    with pytest.raises(ClientError):
        backend.exists(key)
