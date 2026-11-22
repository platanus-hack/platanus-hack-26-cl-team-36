"""Mapa y métricas sobre la página local de prueba, con un tema aplicado en el lugar."""

import asyncio
import json

from playwright.async_api import async_playwright

from shared.browser.session import connect_browser

from conftest import CSS_GUION
from disenador import mapa, metricas, pagina
from disenador.css import sanear


def _en_pagina(url: str, cuerpo):
    async def principal():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                contexto, page = await pagina.abrir(browser, url, "escritorio")
                await cuerpo(page)
                await contexto.close()
            finally:
                await browser.close()

    return asyncio.run(principal())


def test_mapa(sitio):
    resultado = {}

    async def cuerpo(page):
        resultado.update(await mapa.construir_mapa(page))

    _en_pagina(sitio.as_uri(), cuerpo)
    assert resultado["viewport"] == [1280, 800]
    assert {l["etiqueta"] for l in resultado["landmarks"]} >= {"header", "nav", "main", "footer"}
    assert resultado["encabezados"][0]["texto"] == "Título principal"
    assert resultado["claves"]["body"]["fondo"] == "rgb(255, 255, 255)"
    assert resultado["variables_css"]["valores"]["--color-marca"] == "#0a58ca"
    assert resultado["variables_css"]["total"] == 3
    assert any(b["selector"] == "button#pagar" and b["clases"] == ["cta"] and b["fondo"] == "rgb(10, 88, 202)" for b in resultado["botones_destacados"])
    assert resultado["conteos"]["botones"] == 2
    # Los enlaces de la navegación, con un selector que los encuentra (la receta Tarea no tiene que inventarlo).
    assert resultado["enlaces_de_navegacion"] == [
        {"texto": "Inicio", "href": "#a", "selector": "a[href='#a']"},
        {"texto": "Ayuda", "href": "#b", "selector": "a[href='#b']"},
    ]
    completo, recortado = mapa.como_texto(resultado), mapa.como_texto(resultado, max_caracteres=600)
    assert len(recortado) < len(completo)
    assert json.loads(recortado)["contenedores"] == [] and json.loads(recortado)["variables_css"]


def test_metricas_antes_y_despues(sitio):
    resultado = {}

    async def cuerpo(page):
        resultado["antes"] = await metricas.medir(page, "antes")
        await pagina.aplicar_tema(page, sanear(CSS_GUION).css)
        resultado["despues"] = await metricas.medir(page, "despues")
        resultado["clase"] = await page.evaluate("document.documentElement.classList.contains('mi-tema')")
        await pagina.poner_clase(page, False)
        resultado["apagada"] = await metricas.medir(page, "despues")

    _en_pagina(sitio.as_uri(), cuerpo)
    antes, despues, apagada = resultado["antes"], resultado["despues"], resultado["apagada"]
    assert resultado["clase"]
    # Antes: el texto tenue (#bbb sobre blanco, 1,9:1) falla; el resto pasa.
    assert antes["contraste"]["fallan"] == 1
    assert antes["contraste"]["peores"][0]["texto"].startswith("Texto tenue")
    assert antes["interactivos"] == 5 and antes["botones"] == 2
    # Después: fondo oscuro, todo legible (#999 sobre #111 pasa); el botón secundario se perdió.
    assert despues["contraste"]["fallan"] == 0
    assert despues["perdidos_total"] == 1 and despues["perdidos"][0]["texto"] == "Ver más"
    assert despues["ocultos"] >= 1
    assert despues["letra_mediana_px"] == 18 and antes["letra_mediana_px"] == 16
    assert not despues["desborde_horizontal"]
    # Sin la clase vuelve la página original.
    assert apagada["perdidos_total"] == 0 and apagada["contraste"]["fallan"] == 1


def test_contraste_con_filtro_invert(sitio):
    resultado = {}

    async def cuerpo(page):
        await pagina.aplicar_tema(page, "html.mi-tema { filter: invert(1) !important; }")
        resultado["medida"] = await metricas.medir(page, "antes")

    _en_pagina(sitio.as_uri(), cuerpo)
    peor = resultado["medida"]["contraste"]["peores"][0]
    assert peor["texto"].startswith("Texto tenue") and peor["fondo"] == "#000000"


def test_combinar():
    medida = {"contraste": {"proporcion_falla": 0.2, "inciertas": 0}, "letra_min_px": 12, "letra_mediana_px": 16,
              "desborde_horizontal": False, "fijos": 1}
    despues = {**medida, "contraste": {"proporcion_falla": 0.0, "inciertas": 1}, "perdidos_total": 2,
               "perdidos": [{"texto": "a"}], "ocultos": 3, "fijos": 2}
    analisis = {"fuera_de_mi_tema": [{}], "rechazos": [], "bytes": 100, "reglas": 4, "important": 3, "filtros": 1,
                "backdrop_filter": 0, "selectores_universales": 0, "transiciones_de_layout": 0, "position_fixed": 1}
    resultado = metricas.combinar(
        {"escritorio": {"antes": medida, "despues": despues}, "movil": {"antes": medida, "despues": despues}},
        analisis,
        {"escritorio": {"identica": True}, "movil": {"identica": False}},
    )
    fila = resultado["fila"]
    assert fila["contraste_falla_antes"] == 0.2 and fila["contraste_falla_despues"] == 0.0
    assert fila["perdidos"] == 4 and fila["ocultos"] == 6 and fila["fijos_agregados"] == 2
    assert fila["violaciones"] == 1 and fila["riesgos"] == 2 and fila["sin_mi_tema_identica"] is False
    assert resultado["viewports"]["escritorio"]["perdidos"] == [{"texto": "a"}]


# Un carrusel que rota solo, un enlace que la "SPA" vuelve a pintar igual, y cuatro botones que el tema esconde sin
# display ni visibility: opacidad casi cero, texto transparente, clip-path y una capa encima.
PAGINA_RUIDO = """<!doctype html><meta charset="utf-8"><title>Ruido</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  .lamina { display: block; padding: 4px; }
  .oculta { display: none; }
  button { position: absolute; left: 20px; width: 120px; height: 30px; }
  #tapa { display: none; position: fixed; top: 280px; left: 0; width: 300px; height: 200px; background: #fff; }
</style>
<nav><a id="inicio" href="#inicio">Inicio</a></nav>
<div id="carrusel"><a class="lamina" href="#l1">Lámina uno</a><a class="lamina oculta" href="#l2">Lámina dos</a></div>
<button id="b1" style="top: 100px">Opaco</button>
<button id="b2" style="top: 150px">Transparente</button>
<button id="b3" style="top: 200px">Recortado</button>
<button id="b4" style="top: 300px">Tapado</button>
<button id="b5" style="top: 350px">Tapado antes</button>
<div id="tapa"></div>
<script>
  window.rotar = () => document.querySelectorAll("#carrusel a").forEach((a) => a.classList.toggle("oculta"));
  window.repintar = () => {
    const viejo = document.getElementById("inicio");
    viejo.replaceWith(viejo.cloneNode(true));
  };
</script>
"""

CSS_ESCONDE = """html.mi-tema #b1 { opacity: 0.02 !important; }
html.mi-tema #b2 { color: transparent !important; }
html.mi-tema #b3 { clip-path: inset(50%) !important; }
html.mi-tema #tapa { display: block !important; }"""


def test_perdidos_sin_ruido_y_escondidos_sin_display(tmp_path):
    archivo = tmp_path / "ruido.html"
    archivo.write_text(PAGINA_RUIDO, encoding="utf-8")
    resultado = {}

    async def cuerpo(page):
        # #b5 ya estaba tapado antes del tema: no cuenta.
        await page.evaluate("document.getElementById('tapa').style.cssText = 'display:block; top:340px; height:50px'")
        resultado["antes"] = await metricas.medir(page, "antes")
        await page.evaluate("document.getElementById('tapa').style.cssText = ''")
        await page.evaluate("rotar(); repintar()")   # la página cambia sola entre "antes" y el tema
        await pagina.esperar(page, 0.1)
        resultado["ruido"] = await metricas.medir(page, "ruido")
        await pagina.aplicar_tema(page, CSS_ESCONDE)
        resultado["despues"] = await metricas.medir(page, "despues")

    _en_pagina(archivo.as_uri(), cuerpo)
    ruido, despues = resultado["ruido"], resultado["despues"]
    assert ruido["perdidos_ruido"] == 1             # la lámina uno; el enlace repintado no se pierde
    assert sorted(p["texto"] for p in despues["perdidos"]) == ["Opaco", "Recortado", "Tapado", "Transparente"]
    assert despues["perdidos_total"] == 4 and despues["perdidos_ruido"] == 1
    assert despues["ocultos_ruido"] >= 1 and despues["ocultos"] >= 2


def test_sin_tema_no_se_pierde_nada(tmp_path):
    """Con un tema que no esconde nada, lo que cambia solo no se le cuenta."""
    archivo = tmp_path / "ruido.html"
    archivo.write_text(PAGINA_RUIDO, encoding="utf-8")
    resultado = {}

    async def cuerpo(page):
        await metricas.medir(page, "antes")
        await page.evaluate("rotar(); repintar()")
        await metricas.medir(page, "ruido")
        await pagina.aplicar_tema(page, "html.mi-tema body { background: #111 !important; }")
        resultado["despues"] = await metricas.medir(page, "despues")

    _en_pagina(archivo.as_uri(), cuerpo)
    assert resultado["despues"]["perdidos_total"] == 0 and resultado["despues"]["ocultos"] == 0


def test_como_texto_recorta_los_enlaces_de_navegacion_antes_que_los_landmarks():
    def lista(n, clave):
        return [{clave: f"{clave}-{i}-" + "x" * 30} for i in range(n)]

    def largo(mapa_):
        return len(json.dumps(mapa_, ensure_ascii=False, separators=(",", ":")))

    base = {"url": "u", "contenedores": lista(20, "c"), "encabezados": lista(20, "h"), "enlaces_de_navegacion": lista(15, "e"), "landmarks": lista(10, "l")}
    sin_contenedores_ni_encabezados = largo({**base, "contenedores": [], "encabezados": []})
    recortado = json.loads(mapa.como_texto(base, max_caracteres=sin_contenedores_ni_encabezados - 50))
    assert recortado["contenedores"] == [] and recortado["encabezados"] == []
    assert 0 < len(recortado["enlaces_de_navegacion"]) < 15
    assert len(recortado["landmarks"]) == 10, "los landmarks se recortan al final"
    assert json.loads(mapa.como_texto(base, max_caracteres=10**6)) == base
    # Un mapa viejo sin la lista tampoco falla.
    assert "enlaces_de_navegacion" not in json.loads(mapa.como_texto({k: v for k, v in base.items() if k != "enlaces_de_navegacion"}, 200))
