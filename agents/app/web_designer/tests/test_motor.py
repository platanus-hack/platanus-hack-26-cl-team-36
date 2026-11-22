"""El motor de direcciones de arte: barrido de semillas, sitio sin carpeta, ajustes acotados, recetas incompatibles,
la regla que oculta el bloque reemplazado y el orden del lanzador. Sin red ni Claude."""

import asyncio
import re

import pytest
from playwright.async_api import async_playwright

from disenador import atajos, motor
from disenador.mejora import BLOQUE_JS
from disenador.motor.azar import Azar
from disenador.motor.color import contraste, ok
from disenador.motor.componer import RAIZ

METRO = motor.rasgos_del_sitio("www.metro.cl")
SEMILLAS = range(1, 201)


@pytest.mark.parametrize("direccion", ["A", "B", "C", "auto"])
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
        informe = motor.componer(METRO, direccion, semilla).informe
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
    sitio = motor.rasgos_del_sitio("www.ejemplo.invalid", MAPA)
    assert sitio.carpeta is None and sitio.zonas == {} and sitio.categorias == []
    assert 140 < sitio.marca["h"] < 170  # el verde del botón
    for semilla in range(1, 31):
        tema = motor.componer(sitio, direccion, semilla)
        assert tema.ok and tema.informe["saneador"]["fuera_de_ambito"] == []
        assert "#home" not in tema.css and "{{" not in tema.css
        recetas = tema.informe["recetas"]
        # Sin zonas ni categorías no entran las recetas que las piden.
        assert not set(recetas) & {"letrero", "en-vivo", "vidrio", "placas-atajo", "discos-lanzador", "franja",
                                   "bento-lanzador", "rebote", "filete-secciones"}
        assert tema.informe["parametros"]["hero"] is None
    assert any("zonas del sitio" in a or "requiere categorías" in a for a in tema.informe["avisos"])


def test_ajustes_fuera_de_rango_se_recortan():
    tema = motor.componer(METRO, "A", 3, {"tipo.escala": 9, "forma.radio": -4, "densidad": 1, "tinta.croma": 1,
                                          "hero": "carrusel"})
    informe = tema.informe
    assert tema.ok and informe["parametros"]["escala"] == 1.36 and informe["parametros"]["radio"] == 4
    assert informe["parametros"]["densidad"] == 1
    avisos = " | ".join(informe["avisos"])
    assert "tipo.escala=9 fuera de [1.3, 1.36], queda 1.36" in avisos and "forma.radio=-4" in avisos
    assert "tinta.croma no es un rango" in avisos and "hero='carrusel'" in avisos


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


async def _bloque(html: str, selectores: list[str], contenedor: str) -> str | None:
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        page = await navegador.new_page()
        await page.set_content(html)
        try:
            return await page.evaluate(BLOQUE_JS, [selectores, contenedor])
        finally:
            await navegador.close()


def test_bloque_reemplazado_derivado_del_select():
    # Sube del formulario a su tarjeta con el título, sin llevarse la columna vecina que tiene enlaces.
    assert asyncio.run(_bloque(PORTADA, ["#binicio", "#fin"], "body > :has(#binicio)")) == (
        "#home :has(> * > * > #formPlanificador)")
    # Si el componente fuera dentro del bloque, ocultarlo se lo llevaría: no hay regla.
    assert asyncio.run(_bloque(PORTADA, ["#binicio"], "#formPlanificador")) is None
    assert asyncio.run(_bloque(PORTADA, ["#no-existe"], "body > :has(#binicio)")) is None


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


def test_las_hojas_del_motor_solo_usan_marcadores_conocidos():
    for ruta in RAIZ.rglob("*.css"):
        for marcador in re.findall(r"\{\{([^}]*)\}\}", ruta.read_text(encoding="utf-8")):
            assert re.fullmatch(r"[#/](cats|lanz)|(i|c|nombre|num|sep|ncats)|[zv]\.\w+", marcador), (ruta, marcador)
