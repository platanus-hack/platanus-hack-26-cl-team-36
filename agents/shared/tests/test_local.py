from datetime import UTC, datetime
from pathlib import Path

import pytest

from shared.store import InvalidKey, LocalBackend, cataloger, finish_run, start_run, visitor

MOMENT = datetime(2026, 11, 21, 10, 44, 22, tzinfo=UTC)


def test_run_end_to_end(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = visitor("https://www.wom.cl/", "baja-fibra")
    run = start_run(backend, prefix, model="haiku", clock=lambda: MOMENT)

    assert run.workdir == tmp_path / "wom.cl/visitor/baja-fibra/2026-11-21T10-44-22Z"
    (run.workdir / "report.md").write_text("# Reporte\n")
    (run.workdir / "first_time").mkdir()
    (run.workdir / "first_time" / "step_00.png").write_bytes(b"png")
    finish_run(backend, run, "succeeded", clock=lambda: MOMENT)

    assert backend.read_text(run.key.file("report.md")) == "# Reporte\n"
    assert backend.read_bytes(run.key.file("step_00.png", "first_time")) == b"png"
    assert backend.exists(run.key.file("manifest.json"))
    assert not backend.exists(run.key.file("route.json"))
    assert backend.list_runs(prefix) == [run.key]


def test_same_second_never_overwrites(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = cataloger("wom.cl")
    first = start_run(backend, prefix, model=None, clock=lambda: MOMENT)
    backend.write_json(first.key.file("goals.json"), ["baja-fibra"])
    second = start_run(backend, prefix, model=None, clock=lambda: MOMENT)

    assert (first.key.run_id, second.key.run_id) == ("2026-11-21T10-44-22Z", "2026-11-21T10-44-22Z_01")
    assert backend.read_json(first.key.file("goals.json")) == ["baja-fibra"]
    assert backend.list_runs(prefix) == [first.key, second.key]


def test_list_ignores_foreign_folders(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    prefix = cataloger("wom.cl")
    assert backend.list_runs(prefix) == []
    (tmp_path / "wom.cl/cataloger/latest").mkdir(parents=True)
    assert backend.list_runs(prefix) == []


def test_rejects_hand_built_keys(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    with pytest.raises(InvalidKey):
        backend.write_text("../fuera.md", "x")
    with pytest.raises(InvalidKey):
        backend.read_bytes("wom.cl/cataloger/2026-11-21T10-44-22Z/../../x.json")


def test_publish_checks_layout(tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path)
    run = start_run(backend, cataloger("wom.cl"), model=None, clock=lambda: MOMENT)
    (run.workdir / "Notas.txt").write_text("x")
    with pytest.raises(InvalidKey):
        finish_run(backend, run, "failed")
    with pytest.raises(ValueError):
        backend.publish(run.key, tmp_path)
