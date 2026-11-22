"""Pruebas de `--css`: el tema se aplica en cada documento y se repone si el sitio lo quita (sin llamar a Claude)."""

import asyncio
import hashlib
import json

import pytest
from playwright.async_api import async_playwright

from shared.browser.session import BrowserSession, blocked_form_count, connect_browser, create_context
from shared.browser.theme import TEMA_ESTILO_ID, NavegadorConTema, TemaInvalido, describir_kit, describir_tema, script_de_tema
from shared.browser.viewports import SCREENS
from visitor import report

DESKTOP = SCREENS["desktop"]
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


def _con_tema(site, page_name: str, body, css: str = CSS, script: str | None = None):
    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                context = await create_context(NavegadorConTema(browser, script or script_de_tema(css)), DESKTOP)
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


def test_un_css_con_los_marcadores_del_script_igual_se_aplica(site):
    """El CSS entra al script como un solo argumento JSON: lo que traiga adentro no puede romper el JavaScript."""
    css = '/* __ID__ __CLASE__ __CONFIG__ " ` ${x} </script> \u2028 */ ' + CSS

    async def body(session):
        assert await _estado(session.page) == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}
        assert await session.page.evaluate(f"document.getElementById('{TEMA_ESTILO_ID}').textContent") == css

    _con_tema(site, "uno.html", body, css)


@pytest.mark.parametrize("css", [
    "html.mi-tema body { background: url(https://x.cl/a.png) !important; }",
    "@import 'https://x.cl/b.css'; html.mi-tema body { color: red; }",
    'html.mi-tema p::before { content: "\\201C" !important; }',
    "html.mi-tema body { width: expression(alert(1)); }",
])
def test_un_tema_con_lo_que_filtra_la_extension_se_rechaza(tmp_path, css):
    archivo = tmp_path / "malo.css"
    archivo.write_text(css, encoding="utf-8")
    with pytest.raises(TemaInvalido, match="que la extensión filtra"):
        describir_tema(archivo)


def test_main_rechaza_el_tema_antes_de_correr(tmp_path, capsys, monkeypatch):
    import main

    archivo = tmp_path / "malo.css"
    archivo.write_text("@import 'x.css';", encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["main.py", "--url", "https://ejemplo.cl", "--instruction", "x", "--css", str(archivo)])
    with pytest.raises(SystemExit):
        main.main()
    assert "@import" in capsys.readouterr().err


def test_la_csp_se_ignora_con_y_sin_tema():
    """Con y sin tema los contextos se crean igual: la única diferencia entre las tandas es el tema."""
    pedidos = []

    class Navegador:
        async def new_context(self, **options):
            pedidos.append(options)

            class Contexto:
                async def add_init_script(self, script):
                    pass

            return Contexto()

    asyncio.run(create_context(Navegador(), DESKTOP))
    asyncio.run(create_context(NavegadorConTema(Navegador(), script_de_tema(CSS)), DESKTOP))
    assert pedidos[0] == pedidos[1] and pedidos[0]["bypass_csp"] is True


# Una extensión mínima con la forma de extension/src: registro, una feature que dibuja un aviso con sus opciones y un
# motor que usa `browser.*` (fuera de la extensión lanzaría un error si se inyectara).
EXTENSION = {
    "manifest.json": json.dumps({"content_scripts": [{
        "css": ["features/aviso.css", "content/transicion.css"],
        "js": ["content/registro.js", "features/aviso.js", "content/motor.js"],
    }]}),
    "content/registro.js": """globalThis.MiTema ??= { features: new Map(),
        registrarFeature(id, feature) { this.features.set(id, feature); } };""",
    "features/aviso.js": """(() => {
        function actualizar({ texto }) {
          if (!document.body || document.getElementById('aviso')) return;
          const aviso = document.createElement('p');
          aviso.id = 'aviso';
          aviso.textContent = texto;
          document.body.prepend(aviso);
        }
        MiTema.registrarFeature('aviso', { actualizar });
      })();""",
    "features/aviso.css": "#aviso { color: rgb(4, 5, 6); }",
    "content/transicion.css": "html { color: rgb(9, 9, 9); }",
    "content/motor.js": "browser.storage.local.get('activo');",
    "temas/demo/tema.json": json.dumps({"features": {"aviso": {"texto": "Hola"}}}),
    "temas/demo/tema.css": CSS,
}


def test_un_kit_monta_sus_features_y_las_repone(site, tmp_path):
    src = tmp_path / "extension"
    for ruta, contenido in EXTENSION.items():
        (src / ruta).parent.mkdir(parents=True, exist_ok=True)
        (src / ruta).write_text(contenido, encoding="utf-8")
    script, tema = describir_kit(src / "temas/demo/tema.json")
    assert tema["kit"] is True and tema["archivo"] == "tema.json"
    assert "browser.storage" not in script and "rgb(9, 9, 9)" not in script

    async def aviso(session):
        return await session.page.evaluate(
            "(() => { const a = document.getElementById('aviso'); return a && [a.textContent, getComputedStyle(a).color]; })()"
        )

    async def body(session):
        assert await _estado(session.page) == {"clase": True, "estilos": 1, "fondo": "rgb(1, 2, 3)"}
        assert await aviso(session) == ["Hola", "rgb(4, 5, 6)"]
        marco = next(frame for frame in session.page.frames if frame.url.endswith("marco.html"))
        assert await marco.evaluate("document.getElementById('aviso')") is None
        await session.page.evaluate("document.getElementById('aviso').remove()")
        await session.page.wait_for_function("!!document.getElementById('aviso')")
        await session.page.click("text=Ir a dos")
        await session.wait_until_settled()
        assert await aviso(session) == ["Hola", "rgb(4, 5, 6)"]

    _con_tema(site, "uno.html", body, script=script)
