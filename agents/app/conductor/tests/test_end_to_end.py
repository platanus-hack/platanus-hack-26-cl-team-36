"""Una revisión de punta a punta: los CLIs reales de cada etapa como subprocesos, con el motor guionizado, sobre un
sitio local servido por HTTP y un almacén en disco. Sin Claude ni AWS."""

import functools
import shutil
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from shared import store

import main

REVISION = "e2e-1"
PAGE = """<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Municipalidad de Prueba</title></head>
<body><header><h1>Municipalidad de Prueba</h1><nav><a href="horario.html">Horario</a></nav></header>
<main><p>Atendemos de lunes a viernes.</p></main></body></html>"""
HOURS = """<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Horario</title></head>
<body><h1>Horario</h1><p>De 8:30 a 14:00.</p><a href="index.html">Inicio</a></body></html>"""


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def site(tmp_path):
    root = tmp_path / "sitio"
    root.mkdir()
    (root / "index.html").write_text(PAGE, encoding="utf-8")
    (root / "horario.html").write_text(HOURS, encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()
    server.server_close()


@pytest.mark.skipif(shutil.which("uv") is None, reason="las etapas corren con uv")
def test_a_revision_runs_every_stage(site, tmp_path, monkeypatch, capsys):
    backend = store.LocalBackend(tmp_path / "almacen")
    monkeypatch.setenv(store.ENV_VAR, backend.root.as_uri())
    monkeypatch.setenv("AGENTS_ENGINE", "fake")
    monkeypatch.setenv("AGENTS_BROWSER", "local")
    monkeypatch.setenv("CONDUCTOR_INVOKER", "local")
    for stage in ("CATALOG", "GUIDE", "VISITOR", "IMPROVER"):
        # Holgado: la primera vez cada app instala su entorno con uv.
        monkeypatch.setenv(f"CONDUCTOR_TIMEOUT_{stage}_S", "300")
    monkeypatch.setattr(sys, "argv", ["main.py", "--url", site, "--revision", REVISION, "--goals-max", "1"])

    with pytest.raises(SystemExit) as exit:
        main.main()
    conductor = store.revision_run(backend, store.conductor(site), REVISION)
    report = backend.read_json(conductor.file("conductor.json"))
    logs = "\n".join(f"== {path.name}\n{path.read_text(errors='replace')[-3000:]}"
                     for path in sorted((backend.root / str(conductor)).glob("*.log")))
    assert exit.value.code == 0, f"{report}\n{logs}"
    assert store.read_manifest(backend, conductor).status == "succeeded"

    catalog = store.revision_run(backend, store.cataloger(site), REVISION)
    goals = backend.read_json(catalog.file("goals.json"))["goals"]
    assert goals
    goal = report["goals"][0]["id"]

    guide = store.revision_run(backend, store.guide(site, goal, "desktop"), REVISION)
    assert backend.read_json(guide.file("route.json"))["status"] == "verified"

    visitor = store.revision_run(backend, store.visitor(site, goal), REVISION)
    comparison = backend.read_json(visitor.file("comparison.json"))
    assert any(row.get("reached_final_node") for row in comparison["runs"])

    improver = store.revision_run(backend, store.improver(site), REVISION)
    assert "html.mi-tema" in backend.read_text(improver.file("tema.css"))

    for run in (catalog, guide, visitor, improver, conductor):
        manifest = store.read_manifest(backend, run)
        assert (manifest.revision, manifest.status) == (REVISION, "succeeded")
