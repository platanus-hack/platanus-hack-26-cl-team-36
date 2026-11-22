import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from legacy_runs.scan import Migration, scan
from migrate_runs import run

from shared.catalog.goal import instruction_goal_id
from shared.store import LocalBackend, latest_run, parse_key, read_manifest, visitor

ROUTE_TIME = datetime(2026, 11, 20, 12, 0, 0, tzinfo=UTC)
CATALOG_TIME = datetime(2026, 11, 17, 8, 30, 0, tzinfo=UTC)
WOM = "Encuentra cómo dar de baja tu servicio de Internet Fibra."
FREE = instruction_goal_id("Encontrar el horario")


def write(path: Path, content: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")


def attempt(started_at: str = "", outcome: str = "success") -> dict:
    return {"profile": "p", "started_at": started_at, "start": {"url": "u"} if started_at else {},
            "verdict": {"outcome": outcome}}


def batch(folder: Path, url: str, instruction: str, task_id: str | None, profiles: dict[str, dict]) -> None:
    write(folder / "route_tree.json", {"url": url, "instruction": instruction, "task_id": task_id,
                                       "timestamp": folder.name, "user_model": "claude-sonnet-5-5"})
    write(folder / "criteria.json", {"criterion": "c"})
    write(folder / "report.md", "# Reporte\n")
    for profile, run_json in profiles.items():
        write(folder / profile / "run.json", run_json)
        write(folder / profile / "step_00.png", b"png")


def route(folder: Path, task_id: str | None) -> None:
    write(folder / "route.json", {"task_id": task_id, "start_url": "https://www.wom.cl/", "instruction": WOM,
                                  "viewport": folder.name, "model": "claude-opus-5-5", "status": "verified"})
    write(folder / "route.md", "# Ruta\n")
    write(folder / "step_00.png", b"png")
    write(folder / "proposed.json", {"status": "proposed"})
    for path in folder.iterdir():
        os.utime(path, (ROUTE_TIME.timestamp(), ROUTE_TIME.timestamp()))


@pytest.fixture
def old_tree(tmp_path: Path) -> Path:
    root = tmp_path / "old"
    task = root / "wom-baja-fibra" / "2026-11-20_15-30-00"
    batch(task, "https://www.wom.cl/", WOM, "wom-baja-fibra", {
        "first_time": attempt("2026-11-20T15:30:02.120-03:00"),
        "mobile": attempt("2026-11-20T15:30:02.500-03:00", "abandoned"),
    })
    write(task / "reference_comparison.json", {"spl": 1.0, "runs": []})
    write(task / "first_time" / "video.webm", b"webm")
    write(task / "first_time" / "claude_code.log", "log\n")
    batch(root / "2026-11-19_09-00-00", "https://ejemplo.cl/", "Encontrar el horario", None,
          {"first_time": attempt("2026-11-19T09:00:01.000-03:00", "interrupted")})
    route(root / "wom-baja-fibra" / "reference" / "desktop", "wom-baja-fibra")
    route(root / "wom-baja-fibra" / "reference" / "mobile", "wom-baja-fibra")
    catalog = root / "www.wom.cl" / "goals"
    write(catalog / "goals.json", {"host": "www.wom.cl", "start_url": "https://www.wom.cl/", "model": "claude-opus-5-5",
                                   "issues": [], "goals": [{"id": "wom-planes-hogar"}]})
    write(catalog / "outline.json", {"pages": []})
    write(catalog / "goals.md", "# Objetivos\n")
    write(catalog / "summary.md", "# Resumen\n")
    for path in catalog.iterdir():
        os.utime(path, (CATALOG_TIME.timestamp(), CATALOG_TIME.timestamp()))
    batch(root / "wom-planes-hogar" / "2026-11-18_10-00-00", "https://www.wom.cl/", "Planes hogar",
          "wom-planes-hogar", {"first_time": {"profile": "first_time"}})
    write(root / "wom-baja-fibra" / "2026-11-20_16-00-00" / "route_tree.json", {"task_id": "wom-baja-fibra"})
    write(root / "aws" / "2026-11-20_10-00-00" / "report.md", "# AWS\n")
    write(root / "desconocida" / "2026-11-20_10-00-00" / "report.md", "#\n")
    write(root / ".DS_Store", b"")
    return root


def snapshot(root: Path) -> dict[str, tuple[bytes, float]]:
    return {str(path.relative_to(root)): (path.read_bytes(), path.stat().st_mtime)
            for path in root.rglob("*") if path.is_file()}


def plan(root: Path) -> dict[str, str]:
    return {str(item.source.relative_to(root)): str(item.run) if isinstance(item, Migration) else item.reason
            for item in scan(root)}


def test_plan_maps_each_old_folder(old_tree: Path) -> None:
    assert plan(old_tree) == {
        "wom-baja-fibra/2026-11-20_15-30-00": "wom.cl/visitor/baja-fibra/2026-11-20T18-30-00Z",
        "wom-baja-fibra/2026-11-20_16-00-00": "sin report.md: la tanda no terminó",
        "2026-11-19_09-00-00": f"ejemplo.cl/visitor/{FREE}/2026-11-19T12-00-00Z",
        "wom-baja-fibra/reference/desktop": "wom.cl/guide/baja-fibra/desktop/2026-11-20T12-00-00Z",
        "wom-baja-fibra/reference/mobile": "wom.cl/guide/baja-fibra/mobile/2026-11-20T12-00-00Z",
        "www.wom.cl/goals": "wom.cl/cataloger/2026-11-17T08-30-00Z",
        "wom-planes-hogar/2026-11-18_10-00-00": "wom.cl/visitor/wom-planes-hogar/2026-11-18T13-00-00Z",
        "aws": "reportes de just aws explore: solo report.md, sin la tanda",
        "desconocida": "ni tarea, ni objetivo de un catálogo, ni host",
    }


def test_dry_run_prints_the_plan_and_writes_nothing(old_tree: Path, tmp_path: Path) -> None:
    lines = run(old_tree, LocalBackend(tmp_path / "new"), write=False)

    assert "wom-baja-fibra/2026-11-20_15-30-00 → wom.cl/visitor/baja-fibra/2026-11-20T18-30-00Z" in lines
    assert "aws: se omite, reportes de just aws explore: solo report.md, sin la tanda" in lines
    assert any(line.startswith("    sin proposed.json: ") for line in lines)
    assert any(line.startswith("    sin summary.md: ") for line in lines)
    assert not (tmp_path / "new").exists()


def test_write_leaves_runs_the_backoffice_reads(old_tree: Path, tmp_path: Path) -> None:
    backend = LocalBackend(tmp_path / "new")
    run(old_tree, backend, write=True)

    task = latest_run(backend, visitor("wom.cl", "baja-fibra"))
    assert task is not None and str(parse_key(str(task)).run) == "wom.cl/visitor/baja-fibra/2026-11-20T18-30-00Z"
    manifest = read_manifest(backend, task)
    assert (manifest.status, manifest.model, manifest.inputs) == ("succeeded", "claude-sonnet-5-5", ())
    assert manifest.started_at == "2026-11-20T18:30:00Z"
    assert backend.list_profiles(task) == ["first_time", "mobile"]
    assert backend.read_bytes(task.file("video.webm", "first_time")) == b"webm"
    assert backend.read_json(task.file("comparison.json")) == {"spl": 1.0, "runs": []}
    assert not backend.exists(task.file("reference_comparison.json"))

    free = backend.list_runs(visitor("ejemplo.cl", FREE))
    assert [read_manifest(backend, key).status for key in free] == ["failed"]

    for key in ("wom.cl/guide/baja-fibra/desktop/2026-11-20T12-00-00Z",
                "wom.cl/guide/baja-fibra/mobile/2026-11-20T12-00-00Z", "wom.cl/cataloger/2026-11-17T08-30-00Z"):
        migrated = parse_key(key).run
        assert read_manifest(backend, migrated).status == "succeeded"
        assert read_manifest(backend, migrated).model == "claude-opus-5-5"
    assert not backend.exists("wom.cl/guide/baja-fibra/desktop/2026-11-20T12-00-00Z/proposed.json")
    assert backend.exists("wom.cl/cataloger/2026-11-17T08-30-00Z/goals.json")
    assert not backend.exists("wom.cl/cataloger/2026-11-17T08-30-00Z/summary.md")


def test_second_run_migrates_nothing_and_source_is_untouched(old_tree: Path, tmp_path: Path) -> None:
    before = snapshot(old_tree)
    backend = LocalBackend(tmp_path / "new")
    run(old_tree, backend, write=True)
    written = snapshot(tmp_path / "new")

    lines = run(old_tree, backend, write=True)

    assert not any(" → " in line for line in lines)
    assert "wom-baja-fibra/2026-11-20_15-30-00: ya migrada en wom.cl/visitor/baja-fibra/2026-11-20T18-30-00Z" \
        " (succeeded)" in lines
    assert snapshot(tmp_path / "new") == written
    assert snapshot(old_tree) == before


def test_batch_zone_comes_from_run_json(tmp_path: Path) -> None:
    batch(tmp_path / "2026-07-01_09-00-00", "https://ejemplo.cl/", "Algo", None,
          {"first_time": attempt("2026-07-01T09:00:01.000+02:00")})
    [item] = scan(tmp_path)
    assert isinstance(item, Migration) and item.started == datetime(2026, 7, 1, 7, 0, 0, tzinfo=UTC)
