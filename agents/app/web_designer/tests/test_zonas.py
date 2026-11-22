"""Un sitio sin carpeta medido en su página: zonas con selectores estables, rasgos, la composición genérica y la
variedad de `auto`. Sobre HTML local, sin red ni Claude."""

import asyncio
import hashlib
import re
from collections import Counter

import pytest
from playwright.async_api import async_playwright

from disenador import motor, zonas
from disenador.mejora import semilla_de_pagina
from disenador.motor.sitio import rasgos_medidos, sitio_medido

CON_IDS = """<!doctype html><meta charset="utf-8"><title>Servicio de Pruebas</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  header { background: #fff; padding: 12px 24px; }
  nav a, nav button { margin-right: 16px; }
  .grilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 24px; }
  .grilla article { min-height: 160px; border: 1px solid #ddd; }
  .lineas { display: flex; gap: 8px; } .lineas li { list-style: none; padding: 8px; border-left: 6px solid; }
  footer { background: #0b2545; color: #fff; padding: 40px; }
</style>
<header><a href="/"><img alt="Logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="120" height="40"></a>
  <nav id="menu"><a href="/a">Trámites</a><a href="/b">Ayuda</a><a href="/c">Noticias</a><button>Más</button></nav>
</header>
<main id="contenido">
  <h1>Bienvenida</h1>
  <h2>Destacados</h2>
  <section class="grilla" id="destacados">
    <article><h3>Uno</h3><a href="/1">Ver el primero de los destacados</a></article>
    <article><h3>Dos</h3><a href="/2">Ver el segundo de los destacados</a></article>
    <article><h3>Tres</h3><a href="/3">Ver el tercero de los destacados</a></article>
  </section>
  <h2>Líneas</h2>
  <ul class="lineas">
    <li style="border-color: rgb(220, 30, 40)">L1</li><li style="border-color: rgb(250, 190, 0)">L2</li>
    <li style="border-color: rgb(20, 90, 200)">L3</li><li style="border-color: rgb(30, 160, 80)">L4</li>
    <li style="border-color: rgb(150, 40, 170)">L5</li>
  </ul>
</main>
<footer><p>Pie del servicio</p></footer>"""

# Sin landmarks: ids que nombran la cabecera y el pie, y tarjetas con clases generadas (sin selector estable).
SIN_LANDMARKS = """<!doctype html><meta charset="utf-8"><title>Tienda</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  #Header { background: #123; color: #fff; padding: 10px; } #Header a { color: #fff; margin-right: 12px; }
  .x9f3a2b1c { display: flex; gap: 20px; padding: 20px; } .x9f3a2b1c > div { width: 220px; height: 180px; }
  #Footer { background: #eee; padding: 30px; }
</style>
<div id="Header"><span>Tienda</span><a href="/a">Ofertas</a><a href="/b">Hogar</a><a href="/c">Ropa</a>
  <a href="/d">Carro de compras</a></div>
<div class="x9f3a2b1c">
  <div class="c4e5f6a7b8"><img alt="" width="200" height="100"><a href="/p1">Producto uno $ 12.990</a></div>
  <div class="c4e5f6a7b8"><img alt="" width="200" height="100"><a href="/p2">Producto dos $ 9.990</a></div>
  <div class="c4e5f6a7b8"><img alt="" width="200" height="100"><a href="/p3">Producto tres $ 19.990</a></div>
</div>
<div id="Footer"><p>Pie</p></div>"""


def _medir(html: str) -> dict:
    async def correr():
        async with async_playwright() as p:
            navegador = await p.chromium.launch()
            page = await navegador.new_page(viewport={"width": 1024, "height": 768})
            await page.set_content(html)
            try:
                return await zonas.medir(page)
            finally:
                await navegador.close()

    return asyncio.run(correr())


def test_zonas_con_ids_y_landmarks():
    medida = _medir(CON_IDS)
    z = medida["zonas"]
    assert z["cabecera"] == "header" and z["nav"] == "#menu" and z["nav_enlace"] == "#menu :is(a, button)"
    assert z["titulos_seccion"] == "#contenido h2" and z["pie"] == "footer"
    assert z["tarjetas"] == "#destacados > article" and medida["tarjetas_holgura"] == 24
    assert z["logo"] == "header > a"
    assert medida["oscuros"] == {"cabecera": False, "pie": True}
    assert [c["nombre"] for c in medida["categorias"]] == ["L1", "L2", "L3", "L4", "L5"]
    assert medida["senales"]["institucion_texto"] and not medida["senales"]["carro"]


def test_zonas_sin_landmarks_y_con_clases_generadas():
    medida = _medir(SIN_LANDMARKS)
    z = medida["zonas"]
    assert z["cabecera"] == "#Header" and z["pie"] == "#Footer" and z["nav"] == "#Header"
    # Las tarjetas solo tenían clases generadas: se descartan y queda anotado.
    assert "tarjetas" not in z and any(d["zona"] == "tarjetas" for d in medida["descartes"])
    assert not any(re.search(r"[0-9a-f]{6,}", s) for s in z.values())
    assert medida["oscuros"]["cabecera"] and medida["senales"]["precios"] == 3 and medida["senales"]["carro"]


def test_rasgos_por_senales():
    gob = rasgos_medidos("www.ine.gob.cl", {"senales": {"institucion_texto": True, "campos": 0}})
    tienda = rasgos_medidos("tienda.cl", {"senales": {"precios": 12, "carro": True, "campos": 3}})
    video = rasgos_medidos("festival.cl", {"senales": {"videos": 1}, "categorias": [{}] * 5})
    assert gob["institucional"] == 1 and gob["comercio"] <= 0.3 and gob["tarea_formulario"] == 0
    assert tienda["comercio"] == 1 and tienda["institucional"] < 0.5 and tienda["tarea_formulario"] == 1
    assert video["video_hero"] == 1 and video["categorias_color"] == 1


MEDIDA = {
    "zonas": {"cabecera": "header", "nav": "#menu", "nav_enlace": "#menu :is(a, button)", "titulos_seccion": "main h2",
              "tarjetas": "#destacados > article", "pie": "footer", "logo": "header > a"},
    "tarjetas_holgura": 24, "oscuros": {"cabecera": False, "pie": True},
    "marca": [{"color": "rgb(255, 255, 255)", "peso": 40}, {"color": "rgb(204, 20, 20)", "peso": 12},
              {"color": "rgb(0, 51, 102)", "peso": 9}, {"color": "rgb(0, 60, 120)", "peso": 6}],
    "categorias": [], "senales": {"institucion_texto": True},
}


@pytest.mark.parametrize("direccion", ["A", "B", "C", "auto"])
def test_sitio_medido_compone_con_zonas_y_recetas(direccion):
    sitio = sitio_medido("www.servicio.gob.cl", MEDIDA)
    assert 240 < sitio.marca["h"] < 260  # dos azules pesan más que el rojo
    assert sitio.holgura_tarjetas == 24 and len(sitio.categorias) == 6
    recetas = set()
    for semilla in range(1, 41):
        tema = motor.componer(sitio, direccion, semilla, vistas={"lanzador": "tareas"})
        assert tema.ok and "{{" not in tema.css and tema.informe["saneador"]["fuera_de_ambito"] == []
        oscuro = tema.informe["tokens"]["--mt-esquema"] == "dark"
        assert ("font, a, span:not(:empty)" in tema.css) == oscuro
        assert "#destacados > article" in tema.css and "--mt-anillo-tarjeta: 10px" in tema.css
        assert ("header > a {" in tema.css) == oscuro  # la placa del logo, solo en oscuro y con cabecera clara
        recetas.update(tema.informe["recetas"])
    zonales = {"letrero": "A", "vidrio": "C", "filete-secciones": "A", "franja": "A", "bento-lanzador": "B",
               "discos-lanzador": "A", "rebote": "B"}
    assert {r for r, d in zonales.items() if d == direccion} <= recetas


def test_en_claro_no_se_repinta_una_cabecera_oscura():
    sitio = sitio_medido("tienda.cl", {**MEDIDA, "oscuros": {"cabecera": True, "pie": False}})
    tema = motor.componer(sitio, "B", 1)
    assert tema.ok and "html.mi-tema header {" not in tema.css and "#menu :is(a, button)" not in tema.css
    assert "--mt-pie-fondo: var(--mt-superficie-2)" in tema.css


def test_la_carpeta_manda_sobre_la_medida():
    con_medida = motor.rasgos_del_sitio("www.metro.cl", {}, MEDIDA)
    sin_medida = motor.rasgos_del_sitio("www.metro.cl")
    assert con_medida.carpeta and con_medida.zonas == sin_medida.zonas
    assert motor.componer(con_medida, "auto", 9).css == motor.componer(sin_medida, "auto", 9).css
    # Lo que componía metro antes de las zonas medidas, byte a byte.
    huellas = {(d, s): hashlib.sha256(motor.componer(sin_medida, d, s, fidelidad=0).css.encode()).hexdigest()[:12]
               for d, s in (("A", 1), ("B", 2), ("C", 3), ("auto", 5))}
    assert huellas == METRO_HUELLAS


# Antes de las zonas medidas eran 98f6e0cd5585, 3cb697d9723f, f1895a0dea3a y 380955090ef0; cambiaron solo porque
# kit.css dejó de pisarle la fuente a los íconos (selector de la letra del kit con `:not` de clases de íconos).
METRO_HUELLAS = {("A", 1): "b5452c107210", ("B", 2): "8e7399220abd", ("C", 3): "ecf3cf42181d",
                 ("auto", 5): "a13490bc7e95"}


SITIOS = {
    "ministerio.gob.cl": {"senales": {"institucion_texto": True}},
    "servicio.gob.cl": {"senales": {"institucion_texto": True, "campos": 3}},
    "tienda.cl": {"senales": {"precios": 20, "carro": True}},
    "moda.cl": {"senales": {"precios": 9, "carro": True, "hero_imagen": True}},
    "festival.cl": {"senales": {"videos": 1}},
    "diario.cl": {"senales": {"hero_imagen": True}, "categorias": [{"color": f"hsl({h}, 70%, 45%)"} for h in range(5)]},
    "universidad.cl": {"senales": {"institucion_texto": True, "hero_imagen": True}},
    "blog.cl": {"senales": {}},
    "banco.cl": {"senales": {"campos": 2}},
    "museo.cl": {"senales": {"institucion_texto": True, "videos": 1}},
}


def test_al_transformar_auto_reparte_las_expresivas_entre_sitios():
    """Con fidelidad 0 (transformar), cada sitio con sus rasgos y la semilla de su página (aunque el modelo repita la
    7). Cada página sortea por su cuenta, así que el reparto se mide en muchas revisiones: ninguna expresiva pasa del
    45 % del total ni baja del 20 %, y en la gran mayoría ninguna se lleva más de la mitad de los sitios."""
    total, revisiones_sesgadas = Counter(), 0
    for r in range(200):
        elegidas = Counter()
        for host, medida in SITIOS.items():
            semilla = semilla_de_pagina(7, f"rev-{r} https://{host}/")
            elegidas[motor.componer(sitio_medido(host, medida), "auto", semilla, fidelidad=0).informe["direccion"]] += 1
        total.update(elegidas)
        revisiones_sesgadas += max(elegidas.values()) > len(SITIOS) // 2
    partes = {d: n / sum(total.values()) for d, n in total.items()}
    assert all(0.2 <= p <= 0.45 for p in partes.values()) and len(partes) == 3, partes
    assert revisiones_sesgadas <= 200 * 0.3, revisiones_sesgadas
    esperado = Counter()
    for host, medida in SITIOS.items():
        esperado.update(motor.probabilidades_auto(sitio_medido(host, medida)))
    assert max(esperado.values()) <= len(SITIOS) * 0.4, esperado


def test_la_semilla_de_pagina_es_determinista_y_distinta():
    assert semilla_de_pagina(7, "r a") == semilla_de_pagina(7, "r a") >= 1
    assert len({semilla_de_pagina(7, f"r https://{h}/") for h in SITIOS}) == len(SITIOS)


NATIVO = {**MEDIDA, "identidad": {"fondo": "rgb(250, 248, 240)", "tinta": "rgb(40, 40, 60)", "familia_texto": "Open Sans",
                                   "familia_titulos": "Merriweather", "radio": 4}}


def test_por_omision_auto_refina_con_nativa():
    """Sin razón fuerte (fidelidad por omisión), Nativa domina; con fidelidad 1 es siempre Nativa."""
    elegidas = Counter()
    for host, medida in SITIOS.items():
        sitio = sitio_medido(host, {**medida, **NATIVO})
        for r in range(20):
            elegidas[motor.componer(sitio, "auto", semilla_de_pagina(7, f"rev-{r} {host}")).informe["direccion"]] += 1
    assert elegidas["D"] >= sum(elegidas.values()) * 0.7, elegidas
    sitio = sitio_medido("x.cl", NATIVO)
    assert {motor.componer(sitio, "auto", s, {"fidelidad": 1}).informe["direccion"] for s in range(1, 30)} == {"D"}


def test_nativa_parte_de_la_identidad_del_sitio():
    sitio = sitio_medido("www.servicio.gob.cl", NATIVO)
    for semilla in range(1, 41):
        tema = motor.componer(sitio, "D", semilla, {"recetas": {"agregar": ["bento-lanzador", "vidrio"]}},
                              vistas={"lanzador": "tareas"})
        tokens = tema.informe["tokens"]
        assert tema.ok and tokens["--mt-esquema"] == "light" and tokens["--mt-radio-2"] == "4px"
        assert tokens["--mt-familia-texto"].startswith('"Open Sans", "MT Inter"')
        assert tokens["--mt-familia-display"].startswith('"Merriweather", "MT Serif"')
        assert not set(tema.informe["recetas"]) & {"bento-lanzador", "vidrio", "superficie-marca", "letrero", "aurora"}
        assert any("le quita la identidad" in a for a in tema.informe["avisos"])
        assert tema.informe["parametros"]["fondo"] >= 97  # el fondo crema del sitio sigue crema


def test_nativa_de_un_sitio_oscuro_queda_oscura():
    sitio = sitio_medido("noche.cl", {**NATIVO, "identidad": {**NATIVO["identidad"], "fondo": "rgb(18, 18, 24)",
                                                              "tinta": "rgb(230, 230, 230)"}})
    tema = motor.componer(sitio, "D", 3)
    assert tema.ok and tema.informe["tokens"]["--mt-esquema"] == "dark"
