"""El motor de direcciones de arte: barrido de semillas, sitio sin carpeta, ajustes acotados, recetas incompatibles,
la regla que oculta el bloque reemplazado y el orden del lanzador. Sin red ni Claude."""

import asyncio
import re

import pytest
from playwright.async_api import async_playwright

from disenador import atajos, motor
from disenador.mejora import ANCLA_JS, BLOQUE_JS, CONTENIDO_JS
from disenador.voz import VOZ_JS
from disenador.motor.azar import Azar
from disenador.motor.color import contraste, ok
from disenador.motor.componer import RAIZ, aplicar_ajustes

METRO = motor.rasgos_del_sitio("www.metro.cl")
SEMILLAS = range(1, 201)


@pytest.mark.parametrize("direccion", ["A", "B", "C", "D", "auto"])
def test_barrido_de_semillas_sin_rechazos_ni_fallas_aa(direccion):
    vistas_recetas = set()
    for semilla in SEMILLAS:
        tema = motor.componer(METRO, direccion, semilla)
        informe = tema.informe
        assert informe["saneador"] == {"rechazos": [], "fuera_de_ambito": []}, (semilla, informe["saneador"])
        assert informe["contraste"]["fallas"] == [], (semilla, informe["contraste"]["fallas"])
        # En `auto`, la receta prestada desplaza a la fija de su grupo y eso queda como aviso.
        assert informe["contraste"]["minimo"] >= 3 and (direccion == "auto" or informe["avisos"] == [])
        assert "{{" not in tema.css and tema.css.count("{") == tema.css.count("}")
        vistas_recetas.update(informe["recetas"])
    # La semilla varía las opcionales: el barrido las recorre.
    assert len(vistas_recetas) >= 4


def test_mismo_resultado_que_el_prototipo():
    """Valores sacados del prototipo en Node con las mismas semillas."""
    esperado = {
        ("A", 1): ("A", ["letrero", "placas-atajo", "discos-lanzador", "franja", "cabecera-editorial", "en-vivo"], 4.61),
        ("B", 1): ("B", ["rebote", "superficie-marca", "bento-lanzador", "en-vivo"], 4.8),
        ("C", 1): ("C", ["vidrio", "comandos-lanzador", "cabecera-editorial", "en-vivo", "aurora"], 4.54),
        ("auto", 3): ("A", ["letrero", "vidrio", "discos-lanzador", "en-vivo"], 4.73),
        ("auto", 5): ("A", ["letrero", "placas-atajo", "comandos-lanzador", "franja", "filete-secciones", "en-vivo"],
                      4.51),
    }
    for (direccion, semilla), (elegida, recetas, minimo) in esperado.items():
        informe = motor.componer(METRO, direccion, semilla, fidelidad=0).informe
        assert (informe["direccion"], informe["recetas"], informe["contraste"]["minimo"]) == (elegida, recetas, minimo)


def test_la_misma_semilla_da_el_mismo_tema():
    assert motor.componer(METRO, "auto", 11).css == motor.componer(METRO, "auto", 11).css
    assert motor.componer(METRO, "auto", 11).css != motor.componer(METRO, "auto", 12).css
    uno, otro = Azar(7), Azar(7)
    secuencia = [uno.num() for _ in range(3)]
    assert secuencia == [otro.num() for _ in range(3)] and len(set(secuencia)) == 3
    assert Azar(8).num() != secuencia[0]


def test_contraste_wcag():
    blanco, negro = ok(1, 0, 0), ok(0, 0, 0)
    assert contraste(blanco, negro) == pytest.approx(21, abs=0.01)
    assert contraste(ok(0.5, 0.4, 30), blanco) > 1  # fuera de gama: se mapea, no revienta


MAPA = {"botones_destacados": [{"fondo": "rgb(0, 102, 51)"}], "colores_de_enlace": [{"color": "rgb(20, 20, 20)"}],
        "conteos": {"campos": 3}}


@pytest.mark.parametrize("direccion", ["A", "B", "C", "auto"])
def test_sitio_sin_carpeta(direccion):
    """Solo con el mapa: sin zonas, con tonos derivados de la marca; entran las recetas que no piden zonas."""
    sitio = motor.rasgos_del_sitio("www.ejemplo.invalid", MAPA)
    assert sitio.carpeta is None and sitio.zonas == {} and len(sitio.categorias) == 6
    assert 140 < sitio.marca["h"] < 170  # el verde del botón
    assert sitio.categorias[0]["color"][2] == sitio.marca["h"]
    for semilla in range(1, 31):
        tema = motor.componer(sitio, direccion, semilla)
        assert tema.ok and tema.informe["saneador"]["fuera_de_ambito"] == []
        assert "#home" not in tema.css and "{{" not in tema.css
        assert not set(tema.informe["recetas"]) & {"en-vivo"}
        assert tema.informe["parametros"]["hero"] is None
    assert any("zonas del sitio" in a for a in tema.informe["avisos"])


def test_ajustes_fuera_de_rango_se_recortan():
    tema = motor.componer(METRO, "A", 3, {"tipo.escala": 9, "forma.radio": -4, "densidad": 1, "tinta.croma": 1,
                                          "hero": "carrusel"})
    informe = tema.informe
    assert tema.ok and informe["parametros"]["escala"] == 1.36 and informe["parametros"]["radio"] == 4
    assert informe["parametros"]["densidad"] == 1
    avisos = " | ".join(informe["avisos"])
    assert "tipo.escala=9 fuera de [1.3, 1.36], queda 1.36" in avisos and "forma.radio=-4" in avisos
    assert "tinta.croma no es un rango" in avisos and "hero='carrusel'" in avisos


def test_ajustes_malformados_se_ignoran_con_aviso():
    tema = motor.componer(METRO, "A", 3, {"tipo.escala": "1.3", "forma.radio": float("nan"), "densidad": [1],
                                          "recetas": ["aurora"]})
    avisos = " | ".join(tema.informe["avisos"])
    assert tema.ok and "tipo.escala='1.3' no es un número" in avisos and "forma.radio=nan" in avisos
    assert "densidad=[1]" in avisos and "recetas=['aurora']" in avisos
    for rango in ([1], [1, "2"], "1-2", [1, 2, 3]):
        avisos = []
        direccion = aplicar_ajustes({"tipo": {"escala": rango}}, {"tipo.escala": 1.5}, METRO, avisos)
        assert direccion["tipo"]["escala"] == rango and "no es un rango numérico" in avisos[0], rango


def test_con_varios_atajos_las_recetas_valen_para_todos():
    tema = motor.componer(METRO, "A", 1, vistas={"atajo": ["viaje", "tarifas"], "lanzador": "tareas"})
    assert tema.ok and ':is([data-mt-vista="viaje"], [data-mt-vista="tarifas"])' in tema.css
    assert 'data-mt-vista="planificar"' not in tema.css


def test_la_semilla_del_modelo_queda_entera():
    from disenador.mejora import _pedido

    for semilla, esperada in [("3.7", 3), (3.7, 3), ("12", 12), (0, 1), (-4, 1), ("x", 1), (None, 1), ("inf", 1),
                              ("nan", 1), ([2], 1)]:
        assert _pedido({"semilla": semilla})["semilla"] == esperada, semilla


def test_un_sitio_sin_carpeta_no_hereda_los_ids_de_metro():
    tema = motor.componer(motor.rasgos_del_sitio("ejemplo.cl"), "A", 1)
    assert tema.ok and "planificar" not in tema.css and 'data-mt-vista="mt-sin-atajo"' in tema.css


def test_receta_incompatible_se_ignora_con_aviso():
    tema = motor.componer(METRO, "A", 3, {"recetas": {"agregar": ["bento-lanzador", "inexistente", "aurora"],
                                                      "quitar": ["en-vivo"]}})
    informe = tema.informe
    assert tema.ok and "bento-lanzador" not in informe["recetas"] and "en-vivo" not in informe["recetas"]
    assert "aurora" in informe["recetas"]
    avisos = " | ".join(informe["avisos"])
    assert "bento-lanzador requiere modo claro" in avisos and "no existe la receta inexistente" in avisos
    with pytest.raises(motor.ErrorDeComposicion):
        motor.componer(METRO, "Z", 1)


def test_las_vistas_y_la_regla_de_ocultar():
    tema = motor.componer(METRO, "B", 2, vistas={"atajo": "planificar-viaje"},
                          ocultar=[("planificar-viaje", "#home :has(> * > * > #formPlanificador)")])
    assert tema.ok and 'data-mt-vista="planificar"]' not in tema.css
    regla = ('html.mi-tema:not(.mt-vista-original):has([data-mt-vista="planificar-viaje"])'
             ' #home :has(> * > * > #formPlanificador) {\n  display: none !important;\n}')
    assert regla in tema.css
    assert tema.informe["ocultar"] == [{"vista": "planificar-viaje",
                                        "selector": "#home :has(> * > * > #formPlanificador)"}]


PORTADA = """<!doctype html><body><nav><a href="/">Inicio</a></nav>
<div class="contenedor"><div id="home">
  <div class="col"><div class="tarjeta"><div class="titulo">Planifica tu viaje</div>
    <div class="cuerpo"><form id="formPlanificador"><select id="binicio"></select><select id="fin"></select>
    <button>Ir</button></form></div></div></div>
  <div class="col"><div class="red"><a href="/estado">Estado de la red</a><img alt=""></div></div>
</div></div><main><p>Noticias</p></main></body>"""


async def _bloque(html: str, selectores: list[str], contenedor: str, *otras: str) -> str | None:
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        page = await navegador.new_page()
        await page.set_content(html)
        try:
            return await page.evaluate(BLOQUE_JS, [selectores, [contenedor, *otras]])
        finally:
            await navegador.close()


def test_bloque_reemplazado_derivado_del_select():
    # Sube del formulario a su tarjeta con el título, sin llevarse la columna vecina que tiene enlaces.
    assert asyncio.run(_bloque(PORTADA, ["#binicio", "#fin"], "body > :has(#binicio)")) == (
        "#home :has(> * > * > #formPlanificador)")
    # Si el componente fuera dentro del bloque, ocultarlo se lo llevaría: no hay regla.
    assert asyncio.run(_bloque(PORTADA, ["#binicio"], "#formPlanificador")) is None
    assert asyncio.run(_bloque(PORTADA, ["#no-existe"], "body > :has(#binicio)")) is None
    # Tampoco si dentro queda el ancla de otra vista de la página.
    assert asyncio.run(_bloque(PORTADA, ["#binicio", "#fin"], "body > :has(#binicio)", ".titulo")) is None


WEBFORMS = """<!doctype html><body><form id="form1" action="./" method="post">
<header><nav><a href="/">Inicio</a><a href="/tarifas">Tarifas</a><a href="/contacto">Contacto</a></nav></header>
<div id="contenido"><h1>Planifica tu viaje</h1>
  <select id="binicio"></select><select id="fin"></select><input type="submit" value="Ir">
  <p>Noticias, avisos y todo el resto de la página, dentro del mismo formulario.</p>
  <ul><li><a href="/n/1">Nueva estación</a></li><li><a href="/n/2">Horario de verano</a></li></ul>
  <a href="/noticias">Más noticias</a><a href="/avisos">Avisos</a></div>
<footer><a href="/mapa">Mapa del sitio</a></footer></form></body>"""


def test_un_form_que_envuelve_la_pagina_no_se_oculta():
    # ASP.NET WebForms: todo el body va dentro de un <form>. Ni el form ni un bloque hijo de body son el atajo.
    assert asyncio.run(_bloque(WEBFORMS, ["#binicio", "#fin"], "#contenido")) is None
    assert asyncio.run(_bloque(WEBFORMS.replace('<form id="form1" action="./" method="post">', "<div>")
                               .replace("</form>", "</div>"), ["#binicio", "#fin"], "body > div")) is None


async def _evaluar(html: str, *pedidos: tuple[str, object]) -> list:
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        page = await navegador.new_page()
        await page.route("https://www.ejemplo.cl/", lambda ruta: ruta.fulfill(body=html, content_type="text/html"))
        await page.goto("https://www.ejemplo.cl/")
        try:
            return [await page.evaluate(script, argumento) for script, argumento in pedidos]
        finally:
            await navegador.close()


def test_el_ancla_no_deja_el_kit_sobre_la_cabecera():
    # Sin <main> y con todo dentro de un <form>: `body > :has(h1)` es el form, que envuelve la cabecera; el ancla
    # de respaldo es el bloque donde empieza el contenido.
    form, contenido, cabecera_medida = asyncio.run(_evaluar(
        WEBFORMS, (ANCLA_JS, ["body > :has(h1)", []]), (CONTENIDO_JS, [[]]), (ANCLA_JS, ["#contenido", ["header"]])))
    assert form is False and contenido == "#contenido" and cabecera_medida is True
    # Sin ids: por etiqueta y clases bajo el id más cercano.
    envoltorio = ('<!doctype html><body><div id="todo"><div class="cabecera"><nav><a href="/">Inicio</a></nav>'
                  '<h1 class="logo"></h1></div><div class="cuerpo home"><h2>Accesos</h2></div></div></body>')
    assert asyncio.run(_evaluar(envoltorio, (CONTENIDO_JS, [[".cabecera"]]))) == ["#todo > div.cuerpo.home"]


def test_la_voz_lee_los_enlaces_del_sitio_y_lo_que_ya_esta_a_mano():
    html = ('<!doctype html><body><nav><a href="/menu">Menú</a></nav>'
            '<div><a href="/ipc">Índice de Precios</a><a href="https://otro.cl/x">Fuera</a>'
            '<a href="https://tramites.ejemplo.cl/f22">Renta</a></div>'
            '<div style="margin-top:3000px"><a href="/abajo">Abajo</a></div></body>')
    [voz] = asyncio.run(_evaluar(html, (VOZ_JS, None)))
    # Un subdominio es del mismo sitio; otro sitio y lo que está bajo el primer pantallazo, no.
    assert voz["a_mano"] == ["/ipc", "/f22"]
    assert {m["href"] for m in voz["menu"]} == {"/menu", "/ipc", "/f22"}


class _PaginaFalsa:
    def __init__(self):
        self.pedidos = []

    async def evaluate(self, _script, argumentos):
        self.pedidos.append(argumentos)
        return "#bloque"


def test_ocultar_solo_en_las_paginas_de_la_vista_y_con_todas_sus_anclas():
    from disenador.mejora import _ocultar

    atajo = {"id": "planificar", "componente": "atajo", "rutas": ["/viaje/"], "contenedor": "#a",
             "datos": [{"nombre": "inicio", "opciones": "#binicio"}]}
    lanzador = {"id": "tareas", "componente": "lanzador", "rutas": ["/viaje"], "contenedor": "#b", "datos": []}
    otra = {**lanzador, "id": "otra", "rutas": ["/otra"], "contenedor": "#c"}
    pagina = _PaginaFalsa()
    assert asyncio.run(_ocultar(pagina, "https://ejemplo.cl/viaje", [atajo, lanzador, otra])) == [
        ("planificar", "#bloque")]
    assert pagina.pedidos == [[["#binicio"], ["#a", "#b"]]]
    pagina = _PaginaFalsa()
    assert asyncio.run(_ocultar(pagina, "https://ejemplo.cl/otra", [atajo, lanzador, otra])) == []
    assert pagina.pedidos == []


def _goal(goal_id: str, prominencia: str, entrada: str):
    from shared.catalog.goal import Goal
    return Goal(id=goal_id, host="ejemplo.cl", start_url="https://ejemplo.cl/", description=f"Tarea {goal_id}",
                expected_answer=None, level="user_goal", parent=None, intent="reach_page", evidence=[],
                entry=f"https://ejemplo.cl{entrada}", prominence=prominencia)


def _ruta_verificada(destino: str) -> dict:
    return {"status": "verified", "steps": [{"action": "click", "url_after": f"https://ejemplo.cl{destino}"}]}


def test_orden_del_lanzador_verificada_tasa_y_prominencia():
    goals = [_goal("prominente", "primary", "/a"), _goal("verificada", "secondary", "/b"),
             _goal("facil", "secondary", "/c"), _goal("dificil", "buried", "/d")]
    rutas = {"verificada": _ruta_verificada("/b"), "facil": _ruta_verificada("/c"), "dificil": _ruta_verificada("/d")}
    tasas = {"facil": 1.0, "dificil": 0.0}
    vista = atajos.lanzador(goals, rutas, "https://ejemplo.cl/", set(), tasas)
    # Con ruta verificada antes que sin ella; entre ellas, donde menos llegaron los Visitantes.
    assert [t["enlace"] for t in vista["datos"]] == ["/d", "/b", "/c", "/a"]
    # Sin medidas, manda la prominencia del catálogo.
    assert [t["enlace"] for t in atajos.lanzador(goals, {}, "https://ejemplo.cl/", set())["datos"]][0] == "/a"
    # Lexicográfico: una ruta verificada gana aunque la otra sea más prominente y nadie haya llegado a ella.
    goals = [_goal("prominente", "primary", "/a"), _goal("verificada", "buried", "/b")]
    vista = atajos.lanzador(goals, {"verificada": _ruta_verificada("/b")}, "https://ejemplo.cl/", set(),
                            {"prominente": 0.0, "verificada": 1.0})
    assert [t["enlace"] for t in vista["datos"]] == ["/b", "/a"]


def test_el_lanzador_deja_al_final_lo_que_la_pagina_ya_muestra_y_no_enlaza_noticias_fechadas():
    goals = [_goal("indicador", "primary", "/ipc"), _goal("otra", "buried", "/otra")]
    vista = atajos.lanzador(goals, {}, "https://ejemplo.cl/", set(), a_mano={"/ipc/"})
    assert [t["enlace"] for t in vista["datos"]] == ["/otra", "/ipc"]
    # Si la Guía llegó a una noticia del día, la tarea enlaza la página estable del tema.
    vista = atajos.lanzador(goals[:1], {"indicador": _ruta_verificada("/prensa/2026/11/06/ipc-octubre")},
                            "https://ejemplo.cl/", set())
    assert vista["datos"][0]["enlace"] == "/ipc"


def test_las_hojas_del_motor_solo_usan_marcadores_conocidos():
    for ruta in RAIZ.rglob("*.css"):
        for marcador in re.findall(r"\{\{([^}]*)\}\}", ruta.read_text(encoding="utf-8")):
            assert re.fullmatch(r"[#/](cats|lanz|z\.\w+)|(i|c|nombre|num|sep|ncats)|[zv]\.\w+", marcador), (ruta, marcador)
