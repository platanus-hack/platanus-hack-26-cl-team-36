"""El CSS saneado leído por Chromium: la verificación del pipeline y las cargas de la revisión aplicadas de verdad."""

import asyncio

from playwright.async_api import async_playwright

from browser import connect_browser
from disenador import pagina
from disenador.css import sanear
from test_css import CARGA_CONTENT, CARGA_FONT_FACE, CARGA_LAYER

CARGAS = (CARGA_FONT_FACE, CARGA_CONTENT, CARGA_LAYER)


def _con_navegador(cuerpo):
    async def principal():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await cuerpo(browser)
            finally:
                await browser.close()

    return asyncio.run(principal())


def test_verificar_css_detecta_lo_que_el_saneamiento_no_debio_dejar():
    malo = """@import url(https://evil.example/i.css);
    @font-face { font-family: a; src: url(https://evil.example/f.woff); }
    body { color: red }
    html.mi-tema a { color: red; :not(&) b { color: red } &:hover, .c { color: blue } }
    html.mi-tema d { background: image-set("https://evil.example/d.png" 1x); }
    @media (min-width: 1px) { p { color: red } html.mi-tema q { color: blue } }
    @keyframes k { from { opacity: 0 } to { opacity: 1 } }"""

    async def cuerpo(browser):
        return (
            await pagina.verificar_css(browser, malo),
            [await pagina.verificar_css(browser, carga) for carga in CARGAS],
            [await pagina.verificar_css(browser, sanear(carga).css) for carga in CARGAS],
        )

    violaciones, crudas, saneadas = _con_navegador(cuerpo)
    motivos = [v["motivo"] for v in violaciones]
    assert motivos == [
        "regla CSSImportRule no permitida",
        "regla CSSFontFaceRule no permitida",
        "selector fuera de html.mi-tema: body",
        "selector fuera de html.mi-tema: :not(&) b",
        "carga recursos o ejecuta código",
        "selector fuera de html.mi-tema: p",
    ]
    assert all(crudas), "sin sanear, Chromium ve reglas fuera de ámbito o que cargan recursos"
    assert saneadas == [[], [], []]


def test_las_cargas_saneadas_no_cargan_nada_ni_salen_del_ambito():
    """La prueba de concepto de la revisión: el CSS saneado, aplicado en una página, no pide nada a evil.example."""

    async def cuerpo(browser):
        page = await browser.new_page()
        pedidos = []
        page.on("request", lambda r: pedidos.append(r.url))
        await page.route("**/*", lambda ruta: ruta.fulfill(body="x"))
        reglas = []
        for carga in CARGAS:
            await page.set_content("<html class=mi-tema><body><a>hola</a><style>" + sanear(carga).css
                                   + "</style></body></html>")
            await page.wait_for_timeout(200)
            reglas.append(await page.evaluate(
                "[...document.styleSheets[0].cssRules].map(r => r.selectorText || r.cssText)"))
        return pedidos, reglas

    pedidos, reglas = _con_navegador(cuerpo)
    assert not [p for p in pedidos if "evil" in p]
    assert reglas == [[], ["html.mi-tema *"], ["html.mi-tema q"]]
