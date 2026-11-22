"""Sitio local de prueba: un desvío, un menú que se abre con un botón y un acordeón bajo el pliegue."""

import asyncio
from collections.abc import Callable

import pytest
from playwright.async_api import async_playwright

from shared.browser.session import BrowserSession, connect_browser, create_context
from shared.browser.viewports import SCREENS

from guide import config
from guide.decider import Decision

DESKTOP = SCREENS["desktop"]

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
    "sticky.html": """<title>Fijo</title>
        <header style="position:sticky;top:0;background:#fff">Encabezado que siempre se ve</header>
        <p>""" + "Texto largo de relleno. " * 1500 + """</p><p>Respuesta bajo el encabezado fijo.</p>""",
    "duplicado.html": """<title>Duplicado</title>
        <div style="display:none"><p>Horario de atención: 9 a 18 horas.</p></div>
        <div><p>Horario de atención: 9 a 18 horas.</p></div>""",
    "acordeon.html": """<title>Acordeón</title>
        <button onclick="document.getElementById('respuesta').style.maxHeight = 'none'">Ver respuesta</button>
        <div id="respuesta" style="max-height:0;overflow:hidden"><p>La respuesta es 42.</p></div>
        <a href="https://otro.example/">Otro sitio</a>
        <a href="mailto:contacto@sitio.cl">Escríbenos</a> <a href="tel:+56226749300">Llámanos</a>""",
    "app.html": """<title>Aplicación</title>
        <div style="height:100vh;overflow:hidden"><div style="height:100%;overflow:auto">
          <div style="height:2000px"></div><a href="productos.html">Al fondo del panel</a>
        </div></div>""",
}


class ScriptedDecider:
    """Cada paso del guion elige su acción por el nombre del elemento en la vista que recibe."""

    def __init__(self, script: list[tuple[str, str | None, dict]], on_done: Callable[[], None] | None = None):
        self.script = list(script)
        self.on_done = on_done
        self.prompts: list[str] = []
        self.usage = {"input_tokens": 0}
        self.cost_usd = 0.0

    async def decide(self, prompt, screenshot: bytes) -> Decision:
        text = str(prompt)
        self.prompts.append(text)
        action, name, extra = self.script.pop(0)
        if action == "done" and self.on_done:
            self.on_done()
        ref = None
        if name:
            line = next(line for line in text.splitlines() if f"«{name}»" in line and line.startswith("e"))
            ref = line.split(" · ")[0]
        return Decision(reason="guion", action=action, ref=ref, **extra)


@pytest.fixture(autouse=True)
def short_reappear_wait(monkeypatch):
    """Las páginas de prueba no tienen carruseles: un elemento oculto no vuelve."""
    monkeypatch.setattr(config, "REAPPEAR_S", 1.0)
    monkeypatch.setattr(config, "TRIAL_REAPPEAR_S", 0.5)


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
