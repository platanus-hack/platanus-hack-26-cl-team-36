"""Pruebas de `--css`: el tema se aplica en cada documento y se repone si el sitio lo quita (sin llamar a Claude)."""

import asyncio
import hashlib

import pytest
from playwright.async_api import async_playwright

import report
from batch import describir_tema
from browser import TEMA_ESTILO_ID, BrowserSession, NavegadorConTema, connect_browser, create_context
from profiles import Profile
from recording import blocked_form_count

DESKTOP = Profile("test_desktop", "Prueba", 1024, 768, False, "")
CSS = "html.mi-tema body { background: rgb(1, 2, 3); }"

PAGES = {
    "uno.html": """<title>Uno</title><a href="dos.html">Ir a dos</a>
        <form method="post" action="enviar"><button id="enviar">Enviar</button></form>
        <iframe src="marco.html"></iframe>""",
    "dos.html": "<title>Dos</title><p>Página dos</p>",
    "marco.html": "<title>Marco</title><p>Dentro del iframe</p>",
    # Como Gmail: reemplaza el documento completo después de cargar.
    "reescribe.html": """<title>Reescribe</title><script>
        addEventListener('load', () => setTimeout(() => {
          document.open(); document.write('<html class="propia"><head><title>Nueva</title></head><body>Nuevo</body></html>');
          document.close();
        }, 50));
        </script>""",
    # Un sitio que pisa las clases de <html> y borra los <style> que no son suyos.
    "pisa.html": """<title>Pisa</title><script>
        addEventListener('load', () => setTimeout(() => {
          document.documentElement.className = 'solo-mias';
          document.querySelectorAll('style').forEach((s) => s.remove());
        }, 50));
        </script>""",
}


@pytest.fixture
def site(tmp_path):
    for name, html in PAGES.items():
        (tmp_path / name).write_text(f'<meta charset="utf-8">{html}', encoding="utf-8")
    return tmp_path


async def _estado(page):
    return await page.evaluate(
        """(id) => ({
            clase: document.documentElement.classList.contains('mi-tema'),
            estilos: document.querySelectorAll('#' + id).length,
            fondo: getComputedStyle(document.body).backgroundColor,
        })""",
        TEMA_ESTILO_ID,
    )


def _con_tema(site, page_name: str, body):
    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                context = await create_context(NavegadorConTema(browser, CSS), DESKTOP)
                session = BrowserSession(context, DESKTOP)
                await session.open((site / page_name).as_uri())
                await body(session)
            finally:
                await browser.close()

    asyncio.run(main())


def test_aplica_el_tema_en_cada_navegacion(site):
    async def body(session):
        assert await _estado(session.page) == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}
        await session.page.click("text=Ir a dos")
        await session.wait_until_settled()
        assert await _estado(session.page) == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}

    _con_tema(site, "uno.html", body)


def test_no_toca_los_iframes(site):
    async def body(session):
        marco = next(frame for frame in session.page.frames if frame.url.endswith("marco.html"))
        tiene_clase = await marco.evaluate("document.documentElement.classList.contains('mi-tema')")
        assert tiene_clase is False

    _con_tema(site, "uno.html", body)


def test_repone_el_tema_si_el_sitio_reemplaza_el_html(site):
    async def body(session):
        await session.page.wait_for_function("document.title === 'Nueva'")
        await session.page.wait_for_function("document.documentElement.classList.contains('mi-tema')")
        estado = await _estado(session.page)
        assert estado == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}
        assert await session.page.evaluate("document.documentElement.classList.contains('propia')")

    _con_tema(site, "reescribe.html", body)


def test_repone_la_clase_y_el_estilo_si_el_sitio_los_quita(site):
    async def body(session):
        await session.page.wait_for_function("document.documentElement.classList.contains('solo-mias')")
        await session.page.wait_for_function("document.documentElement.classList.contains('mi-tema')")
        assert await _estado(session.page) == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}

    _con_tema(site, "pisa.html", body)


def test_el_tema_no_desactiva_el_bloqueo_de_formularios(site):
    async def body(session):
        await session.page.click("#enviar")
        await session.wait_until_settled()
        assert session.page.url.endswith("uno.html")
        assert await blocked_form_count(session.page) == 1

    _con_tema(site, "uno.html", body)


def test_describir_tema_y_reporte(tmp_path):
    archivo = tmp_path / "oscuro.css"
    archivo.write_text(CSS, encoding="utf-8")
    css, tema = describir_tema(archivo)
    assert css == CSS
    assert tema == {
        "archivo": "oscuro.css",
        "sha256": hashlib.sha256(CSS.encode()).hexdigest()[:12],
        "bytes": len(CSS.encode()),
    }
    assert "`oscuro.css`" in report._tema_label(tema)
    assert report._tema_label(None).startswith("ninguno")
