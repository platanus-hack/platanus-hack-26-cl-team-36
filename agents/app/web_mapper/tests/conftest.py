"""Sitio local de prueba: un desvío, un menú que se abre con un botón y un acordeón bajo el pliegue."""

import asyncio

import pytest
from playwright.async_api import async_playwright

from browser import BrowserSession, connect_browser, create_context
from profiles import Profile

DESKTOP = Profile("test_desktop", "Prueba", 1024, 768, False, "")

PAGES = {
    "index.html": """<title>Inicio</title>
        <button id="menu" aria-expanded="false" aria-controls="nav"
          onclick="const nav = document.getElementById('nav'); nav.hidden = !nav.hidden; this.setAttribute('aria-expanded', String(!nav.hidden))">Menú</button>
        <nav id="nav" hidden><a href="ayuda.html">Ayuda</a></nav>
        <h1>Bienvenida</h1>
        <a href="productos.html">Productos</a>
        <div style="height:2000px"></div>
        <a href="contacto.html">Contacto</a>""",
    "productos.html": """<title>Productos</title><h1>Productos</h1><a href="index.html">Volver al inicio</a>""",
    "ayuda.html": """<title>Ayuda</title><h1>Centro de ayuda</h1>
        <button onclick="void 0">Imprimir</button>
        <div style="height:1500px"></div>
        <details><summary>¿Cómo doy de baja?</summary><p>Para dar de baja llama al 103.</p></details>""",
    "form.html": """<title>Formulario</title>
        <label for="q">Buscar</label><input id="q" type="search">
        <select aria-label="Región"><option>Norte</option><option>Sur</option></select>
        <input type="password" aria-label="Clave">
        <div style="position:absolute;left:-500px;width:200px"><a href="x.html">Fuera</a></div>""",
    "clip.html": """<title>Recortes</title>
        <a href="#contenido" style="position:absolute;top:-40px">Saltar al contenido</a>
        <div style="max-height:0;overflow:hidden"><a href="x.html">En acordeón cerrado</a></div>
        <a href="uno.html">Repetido</a> <a href="dos.html">Repetido</a>
        <p>""" + "Texto de relleno. " * 1500 + """</p><p>Respuesta al fondo de la página.</p>""",
}


@pytest.fixture
def site(tmp_path):
    for name, html in PAGES.items():
        (tmp_path / name).write_text(f'<meta charset="utf-8">{html}', encoding="utf-8")
    return tmp_path


@pytest.fixture
def with_session(site):
    """Corre `body(session)` con una sesión abierta en la página indicada del sitio."""

    def run(page: str, body):
        async def main():
            async with async_playwright() as playwright:
                browser = await connect_browser(playwright)
                try:
                    session = BrowserSession(await create_context(browser, DESKTOP), DESKTOP)
                    await session.open((site / page).as_uri())
                    await body(session)
                finally:
                    await browser.close()

        asyncio.run(main())

    return run
