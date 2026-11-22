"""La voz del sitio en el kit: clichés, anclaje léxico con el catálogo real de metro.cl y los textos que vuelven al
sitio."""

import json
from pathlib import Path

import pytest

from disenador import atajos, tema_json, voz
from disenador.atajos import SelectDePagina
from disenador.modelo import ESQUEMA_KIT
from test_kit import INICIO, SELECTS, _goals_reales, _real, kit_derivado

# Lo que el sitio dice en la portada (grabado de metro.cl): el formulario se titula «Planifica tu viaje» en un
# `.card-title` y el menú «MetroServicio» nombra cada página.
PAGINA = {
    "titulo": "Metro de Santiago",
    "titulos": ["La Red en tiempo real", "Planifica tu viaje", "El Viaje", "Guía del Usuario"],
    "menu": [{"texto": "Planificador de Viajes", "href": "/el-viaje/planificador"},
             {"texto": "Estado del Servicio", "href": "/el-viaje/estado-red"},
             {"texto": "Estaciones", "href": "/el-viaje/estaciones"},
             {"texto": "Horarios y Tarifas", "href": "/el-viaje/horarios-y-tarifas"},
             {"texto": "Carga tu bip!", "href": "/el-viaje/carga-bip"}],
    "botones": ["Accesibilidad", "Horarios", "Canales Atención"],
}
SELECTS_CON_VOZ = [SelectDePagina(**{**s.__dict__, "seccion": "Planifica tu viaje"}) for s in SELECTS]


@pytest.mark.parametrize("texto", [
    "¿A dónde vas?", "¿Qué quieres hacer?", "¿Qué vienes a hacer?", "¿Qué necesitas hoy?", "Qué buscas?",
    "Where are you going?", "What do you want to do?", "Where to?", "Lo más buscado", "Most wanted",
    "Accesos rápidos", "Quick links", "Todo lo que necesitas", "Everything you need",
    "Atajos a lo que más se hace en metro.cl.", "Ve directo a lo que viniste a hacer.", "Te llevamos al resultado",
    "Viaja tranquilo 🚇",
])
def test_cliches(texto):
    assert voz.cliche(texto)


@pytest.mark.parametrize("texto", [
    "Planifica tu viaje", "Plan your trip", "Horarios y Tarifas", "MetroServicio", "Buscar en metro.cl",
    "¿Qué hacer en caso de contingencia?", "Estado del Servicio", "Carga tu bip!", "Origen", "Ver ruta",
])
def test_textos_del_sitio_no_son_cliches(texto):
    assert voz.cliche(texto) is None


def test_anclaje_con_el_catalogo_real_de_metro():
    vocabulario = voz.vocabulario({}, _goals_reales())
    # Comparten raíz con un objetivo: «Planifica…», «estaciones», «horarios», la ruta «estado-red».
    for titulo in ("Planifica tu viaje", "Planificador de Viajes", "Estaciones", "Horarios y Tarifas",
                   "Estado de la red"):
        assert voz.anclado(titulo, vocabulario), titulo
    for titulo in ("Tu aventura empieza aquí", "Comienza ahora", "Lo que más se hace", "Where are you going?"):
        assert not voz.anclado(titulo, vocabulario), titulo


def _base_y_voz():
    kit = atajos.derivar(_goals_reales(), {"planificar-viaje": _real("route.json")}, SELECTS_CON_VOZ, INICIO)
    sitio = voz.de_la_pagina(PAGINA, SELECTS_CON_VOZ, kit, _goals_reales())
    vistas = [kit["atajos"][0]["vista"], kit["lanzador"], kit["buscador"]]
    return [voz.con_voz(v, sitio["componentes"].get(v["id"])) for v in vistas], sitio


def test_lo_derivado_toma_la_voz_del_sitio():
    (atajo, lanzador, buscador), sitio = _base_y_voz()
    assert sitio["componentes"]["planificar-viaje"]["seccion"] == "Planifica tu viaje"
    assert atajo["opciones"]["textos"] == {"es": {"titulo": "Planifica tu viaje"}, "en": {"titulo": "Planifica tu viaje"}}
    # Cada tarea con el texto del menú que lleva a su enlace; sin titular inventado para el lanzador ni el buscador.
    titulos = {t["enlace"]: t["titulo"]["es"] for t in buscador["datos"]}
    assert titulos["/el-viaje/estado-red"] == "Estado del Servicio" and titulos["/el-viaje/planificador/"] == \
        "Planificador de Viajes"
    assert "textos" not in lanzador["opciones"] and "textos" not in buscador["opciones"]
    assert tema_json.armar("metro", [atajo, lanzador, buscador])[1] == []


def test_sin_seccion_el_atajo_toma_el_titulo_del_objetivo():
    atajo = kit_derivado()[0]
    con = voz.con_voz(atajo, {"seccion": "", "boton": "", "objetivo": "Planifica tu viaje indicando origen y destino."})
    assert con["opciones"]["textos"]["es"] == {"titulo": "Planifica tu viaje"}
    assert "textos" not in voz.con_voz(atajo, None)["opciones"]


def test_los_cliches_y_los_titulos_sin_anclaje_vuelven_al_sitio():
    (atajo, lanzador, buscador), _ = _base_y_voz()
    vocabulario = voz.vocabulario({"titulos": PAGINA["titulos"], "menu": [m["texto"] for m in PAGINA["menu"]]},
                                  _goals_reales())
    propuesto = tema_json.con_propuesta(atajo, {
        "textos": {"es": {"titulo": "¿A dónde vas?", "subtitulo": "Te llevamos al resultado", "boton": "Ver ruta"},
                   "en": {"titulo": "Where are you going?", "subtitulo": "We take you there", "boton": "See route"}},
        "etiquetas": [{"nombre": "inicio", "es": "Origen", "en": "Origin"}, {"nombre": "fin", "es": "🚩", "en": "🚩"}]})
    verificado, reemplazos = voz.verificar(propuesto, atajo, vocabulario)
    assert verificado["opciones"]["textos"] == {"es": {"titulo": "Planifica tu viaje", "boton": "Ver ruta"},
                                                "en": {"titulo": "Planifica tu viaje", "boton": "See route"}}
    assert [c["etiqueta"] for c in verificado["datos"][:2]] == [{"es": "Origen", "en": "Origin"},
                                                                atajo["datos"][1]["etiqueta"]]
    assert {(r["texto"], r["razon"]) for r in reemplazos} == {
        ("titulo", "pregunta retórica a la persona"), ("subtitulo", "frase de app"), ("etiqueta:fin", "emoji")}

    tareas = {"/el-viaje/estaciones": {"enlace": "/el-viaje/estaciones", "titulo_es": "Tu aventura empieza aquí",
                                       "titulo_en": "Your adventure starts here", "detalle_es": "Todo lo que necesitas",
                                       "detalle_en": "Everything you need"},
              "/el-viaje/carga-bip": {"enlace": "/el-viaje/carga-bip", "titulo_es": "Carga tu bip!",
                                      "titulo_en": "Top up your bip!", "detalle_es": "", "detalle_en": ""}}
    propuesto = tema_json.con_propuesta(lanzador, {"textos": {"es": {"titulo": "Lo más buscado"},
                                                              "en": {"titulo": "Most wanted"}}}, tareas)
    verificado, reemplazos = voz.verificar(propuesto, lanzador, vocabulario)
    por_enlace = {t["enlace"]: t for t in verificado["datos"]}
    # Sin titular del sitio para el lanzador: se quita y el componente va sin él.
    assert "textos" not in verificado["opciones"]
    assert por_enlace["/el-viaje/estaciones"]["titulo"] == {"es": "Estaciones"}
    assert "detalle" in por_enlace["/el-viaje/estaciones"] and voz.cliche(
        por_enlace["/el-viaje/estaciones"]["detalle"]["es"]) is None
    assert por_enlace["/el-viaje/carga-bip"]["titulo"] == {"es": "Carga tu bip!", "en": "Top up your bip!"}
    assert {r["texto"]: r["razon"] for r in reemplazos} == {
        "titulo": "«Lo más buscado»",
        "tarea:/el-viaje/estaciones:titulo": "no comparte ninguna palabra con la página ni con los objetivos",
        "tarea:/el-viaje/estaciones:detalle": "«Todo lo que necesitas»"}
    assert tema_json.armar("metro", [verificado])[1] == []


def test_el_kit_real_de_metro_conserva_lo_que_ya_era_del_sitio():
    vistas = {v["id"]: v for v in _real("tema.json")["features"]["vista"]}
    vocabulario = voz.vocabulario({}, _goals_reales())
    for vista in vistas.values():
        verificado, reemplazos = voz.verificar(vista, vista, vocabulario)
        assert reemplazos == [] and verificado == vista


def test_el_kit_de_ejemplo_de_la_extension_habla_como_metro():
    fixture = Path(__file__).parents[4] / "extension" / "test" / "fixtures" / "metro" / "tema.json"
    vistas = {v["id"]: v for v in json.loads(fixture.read_text(encoding="utf-8"))["features"]["vista"]}
    textos = [t for v in vistas.values() for por_idioma in v["opciones"].get("textos", {}).values()
              for t in por_idioma.values()]
    textos += [t for v in vistas.values() for item in v["datos"] for clave in ("titulo", "detalle", "etiqueta")
               for t in (item.get(clave) or {}).values()]
    assert textos and [t for t in textos if voz.cliche(t)] == []
    assert vistas["planificar"]["opciones"]["textos"]["es"]["titulo"] == "Planifica tu viaje"
    assert vistas["tareas"]["opciones"]["textos"]["es"] == {"titulo": "MetroServicio"}


def test_el_modelo_dice_de_donde_sale_cada_texto():
    item = ESQUEMA_KIT["properties"]["componentes"]["items"]
    assert "fuentes" in item["required"]
    assert item["properties"]["fuentes"]["items"]["properties"]["fuente"]["enum"] == list(voz.FUENTES)
    propuestas = [{"id": "planificar-viaje", "fuentes": [
        {"texto": "titulo", "fuente": "sitio", "origen": "Planifica tu viaje"},
        {"texto": "boton", "fuente": "inventada", "origen": ""}]}, None, {"id": "x"}]
    assert voz.fuentes(propuestas) == [{"vista": "planificar-viaje", "texto": "titulo", "fuente": "sitio",
                                        "origen": "Planifica tu viaje"}]
