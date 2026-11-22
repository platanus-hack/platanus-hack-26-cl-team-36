import asyncio

import pytest

from shared import store

from visitor import batch
from visitor.batch import BatchInterrupted, run_batch

PREFIX = store.visitor("https://www.sitio.cl/", "baja")


def _run_with(monkeypatch, tmp_path, finished: int):
    async def fake_write_batch(batch_dir, *args):
        (batch_dir / "report.md").write_text("# Reporte", encoding="utf-8")
        return finished

    monkeypatch.setattr(batch, "_write_batch", fake_write_batch)
    backend = store.LocalBackend(tmp_path)
    return backend, asyncio.run(run_batch(backend, PREFIX, "https://www.sitio.cl/", "x", ["desktop"], {}))


def test_a_batch_with_a_finished_attempt_succeeds(tmp_path, monkeypatch):
    backend, run = _run_with(monkeypatch, tmp_path, 1)
    assert store.read_manifest(backend, run).status == "succeeded"


def test_a_batch_whose_attempts_were_all_interrupted_fails_and_keeps_its_report(tmp_path, monkeypatch):
    with pytest.raises(BatchInterrupted) as raised:
        _run_with(monkeypatch, tmp_path, 0)
    backend = store.LocalBackend(tmp_path)
    assert store.read_manifest(backend, raised.value.run).status == "failed"
    assert backend.exists(raised.value.run.file("report.md")) and store.latest_run(backend, PREFIX) is None
