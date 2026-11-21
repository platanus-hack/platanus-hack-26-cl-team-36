"""Esquema de un sitio local servido por HTTP: zonas, barreras, topes y filtro de sitio."""

import asyncio
import functools
import http.server
import threading

import pytest
from playwright.async_api import async_playwright

from browser import connect_browser
from mapper import config
from mapper.crawl import crawl
from tests.conftest import DESKTOP

SITE = {
    "index.html": """<title>Inicio</title>
        <header><nav><a href="/a.html">Sección A</a><a href="/b.html">Sección B</a></nav></header>
        <main><h1>Bienvenida</h1><a href="/c.html">Contenido C</a><a href="https://otro.example/x">Otro sitio</a>
          <a href="/manual.pdf">Manual</a></main>
        <footer><a href="/login.html">Ingresar</a>
          <form method="post"><input type="email" autocomplete="email" aria-label="Correo"></form></footer>""",
    "a.html": """<title>A</title><main><a href="/profunda.html">Más adentro</a></main>""",
    "b.html": """<title>B</title><main><form><input name="telefono_contacto"></form></main>""",
    "c.html": """<title>C</title><main><form><label for="r">RUT</label><input id="r"></form></main>""",
    "login.html": """<title>Ingreso</title><main><form method="post">
        <input autocomplete="username" aria-label="Usuario"><input type="password" aria-label="Clave"></form></main>""",
    "profunda.html": """<title>Profunda</title><a href="/mas-profunda.html">Aún más</a>""",
    "mas-profunda.html": """<title>Más profunda</title>""",
}


@pytest.fixture
def server(tmp_path, monkeypatch):
    for name, html in SITE.items():
        (tmp_path / name).write_text(f'<meta charset="utf-8">{html}', encoding="utf-8")
    monkeypatch.setattr(config, "CRAWL_DELAY_S", 0)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(tmp_path))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


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
