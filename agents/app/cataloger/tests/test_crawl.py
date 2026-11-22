"""Esquema de un sitio local servido por HTTP: zonas, barreras, topes y filtro de sitio."""

import asyncio
import http.server
import threading

import pytest
from playwright.async_api import async_playwright

from shared.browser.session import connect_browser
from shared.browser.viewports import SCREENS
from shared.catalog.files import read_catalog
from shared.claude import engines
from shared import store

from cataloger import command, config
from cataloger.crawl import crawl
from main import build_parser

DESKTOP = SCREENS["desktop"]

SITE = {
    "index.html": """<title>Inicio</title>
        <header><nav><a href="/a.html">Sección A</a><a href="/b.html">Sección B</a></nav></header>
        <main><h1>Bienvenida</h1><a href="/c.html">Contenido C</a><a href="https://otro.example/x">Otro sitio</a>
          <a href="/manual.pdf">Manual</a></main>
        <footer><a href="/login.html">Ingresar</a>
          <form method="post"><input type="email" autocomplete="email" aria-label="Correo"></form></footer>""",
    "a.html": """<title>A</title><main><a href="/profunda.html">Más adentro</a>
        <div style="display:none"><form method="post"><input type="password" aria-label="Clave"></form></div>
        <input type="email" autocomplete="email" aria-label="Correo" hidden>
        <form><label for="s">Buscar por nombre del trámite</label><input id="s">
          <select aria-label="Dirección regional"><option>Norte</option></select></form></main>""",
    "b.html": """<title>B</title><main><form><input name="telefono_contacto"></form></main>""",
    "c.html": """<title>C</title><main><form><label for="r">RUT</label><input id="r"></form></main>""",
    "login.html": """<title>Ingreso</title><main><form method="post">
        <input autocomplete="username" aria-label="Usuario"><input type="password" aria-label="Clave"></form></main>""",
    "profunda.html": """<title>Profunda</title><a href="/mas-profunda.html">Aún más</a>""",
    "mas-profunda.html": """<title>Más profunda</title>""",
}


REDIRECT_SITE = {
    "index.html": """<title>Inicio</title><main><a href="/a.html">A</a><a href="/viejo.html">Viejo</a>
        <a href="/afuera.html">Afuera</a><a href="/nuevo.html">Nuevo</a></main>""",
    "a.html": """<title>A</title><main><a href="/b.html">B</a></main>""",
    "b.html": """<title>B</title>""",
}
# Destinos de redirección; {port} es el del servidor, en otro host (localhost en vez de 127.0.0.1).
REDIRECTS = {"/viejo.html": "/a.html", "/afuera.html": "http://localhost:{port}/b.html", "/nuevo.html": "/b.html"}


def _serve(directory, site: dict[str, str], redirects: dict[str, str]):
    for name, html in site.items():
        (directory / name).write_text(f'<meta charset="utf-8">{html}', encoding="utf-8")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def do_GET(self):
            if self.path in redirects:
                self.send_response(302)
                self.send_header("Location", redirects[self.path].format(port=self.server.server_port))
                self.end_headers()
                return
            super().do_GET()

        def log_message(self, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


@pytest.fixture
def serve(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CRAWL_DELAY_S", 0)
    servers = []

    def start(site, redirects=None):
        servers.append(_serve(tmp_path, site, redirects or {}))
        return f"http://127.0.0.1:{servers[-1].server_port}"

    yield start
    for httpd in servers:
        httpd.shutdown()


@pytest.fixture
def server(serve):
    return serve(SITE)


def _crawl(base: str, max_pages: int, max_depth: int):
    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await crawl(browser, DESKTOP, f"{base}/index.html", max_pages, max_depth, lambda text: None)
            finally:
                await browser.close()

    return asyncio.run(main())


def test_breadth_first_with_navigation_first_and_depth_cap(server):
    outline = _crawl(server, 20, 2)
    assert [page.title for page in outline.pages] == ["Inicio", "A", "B", "C", "Ingreso", "Profunda"]
    assert [page.depth for page in outline.pages] == [0, 1, 1, 1, 1, 2]
    start = outline.pages[0]
    zones = {link.text: link.zone for link in start.links}
    assert zones == {"Sección A": "nav", "Sección B": "nav", "Contenido C": "main", "Otro sitio": "main",
                     "Manual": "main", "Ingresar": "footer"}
    assert start.headings == ["Bienvenida"] and outline.failures == []


def test_gate_signals_come_from_content_forms(server):
    gates = {page.title: page.gates for page in _crawl(server, 20, 1).pages}
    assert gates == {"Inicio": [], "A": [], "B": ["personal_data"], "C": ["personal_data"], "Ingreso": ["login"]}


def test_page_cap(server):
    assert [page.title for page in _crawl(server, 2, 2).pages] == ["Inicio", "A"]


def test_redirects_to_a_seen_page_or_another_host_are_dropped(serve):
    outline = _crawl(serve(REDIRECT_SITE, REDIRECTS), 20, 2)
    assert [page.title for page in outline.pages] == ["Inicio", "A", "B"]
    assert len(outline.failures) == 1 and "otro sitio" in outline.failures[0]


def _catalog_revision(monkeypatch, store_dir, url: str, revision: str):
    monkeypatch.setenv(store.ENV_VAR, store_dir.as_uri())
    monkeypatch.setenv(engines.ENGINE_VAR, "fake")
    parser = build_parser()
    command.run(parser, parser.parse_args(["--url", url, "--revision", revision]))


def test_revision_catalogs_only_that_page_in_a_new_run(server, tmp_path, monkeypatch):
    url = f"{server}/index.html"
    backend = store.LocalBackend(tmp_path / "almacen")
    prefix = store.cataloger(url)
    store.finish_run(backend, store.start_run(backend, prefix, model="m"), "succeeded")
    _catalog_revision(monkeypatch, tmp_path / "almacen", url, "rev-1")
    run = store.revision_run(backend, prefix, "rev-1")
    assert run and len(backend.list_runs(prefix)) == 2
    assert store.read_manifest(backend, run).status == "succeeded"
    meta, goals, _ = read_catalog(backend, run)
    assert meta["pages"] == 1 and [(goal.id, goal.exclusion) for goal in goals] == [("pagina-inicial", None)]


def test_revision_without_evaluable_goals_still_succeeds(server, tmp_path, monkeypatch):
    url = f"{server}/index.html"
    monkeypatch.setattr(command, "scripted_catalog", lambda *args: {"goals": []})
    _catalog_revision(monkeypatch, tmp_path / "almacen", url, "rev-2")
    backend = store.LocalBackend(tmp_path / "almacen")
    run = store.revision_run(backend, store.cataloger(url), "rev-2")
    assert store.read_manifest(backend, run).status == "succeeded" and read_catalog(backend, run)[1] == []
