"""El kit de la mejora: atajo y lanzador derivados de lo medido (datos reales de metro.cl), el esquema del tema.json y
una corrida `--revision` con el modelo guionizado."""

import asyncio
import copy
import functools
import http.server
import json
import threading
from pathlib import Path

import pytest

from shared import store
from shared.catalog.goal import Goal

from conftest import ClaudeGuion
from disenador.modelo import ESQUEMA_KIT, ESQUEMA_MOTOR
from disenador import atajos, tema_json
from disenador.atajos import SelectDePagina

DATOS = Path(__file__).with_name("datos") / "metro"
METRO = "https://www.metro.cl"
INICIO = f"{METRO}/"
REV = "rev-kit"
ESTACIONES = ("SP", "NE", "EL", "LH")


def _goals(base: str = METRO) -> list[Goal]:
    texto = (DATOS / "goals.json").read_text(encoding="utf-8").replace(METRO, base)
    return [Goal(**g) for g in json.loads(texto)["goals"]]


def _route(base: str = METRO) -> dict:
    return json.loads((DATOS / "route.json").read_text(encoding="utf-8").replace(METRO, base))


SELECTS = [
    SelectDePagina("#binicio", id="binicio", name="inicio", etiqueta="Origen", valores=ESTACIONES, elegido="SP"),
    SelectDePagina("#fin", id="fin", name="fin", valores=ESTACIONES, elegido="SP"),
    SelectDePagina("#horario", id="horario", name="horario", valores=("PUNTA", "VALLE", "BAJO"), elegido="PUNTA"),
    SelectDePagina("#dia", id="dia", name="dia", valores=("DL", "SA", "DO"), elegido="DL"),
]


def test_atajo_del_planificador_de_metro():
    vista, razon = atajos.atajo("planificar-viaje", _route(), SELECTS, INICIO)
    assert razon == ""
    assert vista["rutas"] == ["/"] and vista["componente"] == "atajo" and vista["reemplazar"] is False
    assert vista["contenedor"] == "body > :has(#binicio)"
    # Las claves del deep link verificado, en su orden; `inicio` se encuentra por el name de su <select>.
    assert [(c["nombre"], c["opciones"], c["requerido"]) for c in vista["datos"]] == [
        ("inicio", "#binicio", True), ("fin", "#fin", True), ("horario", "#horario", False), ("dia", "#dia", False)]
    assert vista["datos"][0]["etiqueta"] == {"es": "Origen", "en": "Origen"}
    assert vista["opciones"] == {"destino": "/el-viaje/planificador/", "invertir": ["inicio", "fin"]}


def test_sin_la_pagina_solo_valen_los_selects_de_la_ruta():
    vista, _ = atajos.atajo("planificar-viaje", _route(), [], INICIO)
    assert [c["opciones"] for c in vista["datos"]] == ["#fin"]
    assert vista["opciones"]["fijos"] == {"inicio": "SP", "horario": "VALLE", "dia": "DL"}


def test_la_ruta_queda_como_la_ve_el_navegador():
    route = copy.deepcopy(_route())
    for paso in route["steps"][:-1]:
        paso["url_before"] = f"{METRO}/portada/"
    # La página abierta sin la barra final es la misma: valen sus `<select>`.
    vista, _ = atajos.atajo("planificar-viaje", route, SELECTS, f"{METRO}/portada")
    assert vista["rutas"] == ["/portada/"] and len(vista["datos"]) == 4
    assert atajos.misma_ruta("/portada", "/portada/") and not atajos.misma_ruta("/portada", "/portadas")


@pytest.mark.parametrize("cambio, razon", [
    (lambda r: r.update(status="failed"), "no está verificada"),
    (lambda r: r["steps"][0].update(action="fill"), "algo más que elegir"),
    (lambda r: r["steps"][-1].update(url_after="https://otro.cl/x?a=1"), "consulta del mismo sitio"),
    (lambda r: r["steps"][-1].update(url_after=f"{METRO}/el-viaje/planificador/"), "consulta del mismo sitio"),
])
def test_rutas_que_no_dan_un_atajo(cambio, razon):
    route = copy.deepcopy(_route())
    cambio(route)
    vista, motivo = atajos.atajo("planificar-viaje", route, SELECTS, INICIO)
    assert vista is None and razon in motivo


def test_lanzador_con_el_catalogo_de_metro():
    kit = atajos.derivar(_goals(), {"planificar-viaje": _route()}, SELECTS, INICIO)
    assert [a["objetivo"] for a in kit["atajos"]] == ["planificar-viaje"] and kit["descartes"] == []
    lanzador = kit["lanzador"]
    enlaces = [t["enlace"] for t in lanzador["datos"]]
    # Primero lo prominente; sin el objetivo del atajo ni lo de otros sitios (metromuv, outlook, mail.metro.cl).
    assert enlaces[0] == "/transparencia-activa/"
    assert "/el-viaje/planificador" not in " ".join(enlaces)
    assert all(e.startswith("/") and not e.startswith("//") for e in enlaces)
    assert len(enlaces) == len(set(enlaces)) <= atajos.MAX_TAREAS and lanzador["opciones"]["max"] == 6
    estaciones = next(t for t in lanzador["datos"] if t["enlace"] == "/el-viaje/estaciones")
    assert estaciones["titulo"]["es"] == "Encuentra información sobre una estación"
    assert estaciones["detalle"]["es"] == "Encuentra información sobre una estación específica del Metro"
    assert lanzador["contenedor"] == kit["atajos"][0]["vista"]["contenedor"]


def test_enlaces_del_mismo_sitio():
    assert atajos.mismo_sitio("https://metro.cl/a?b=1#c", INICIO) == "/a?b=1#c"
    assert atajos.mismo_sitio("/relativa", INICIO) == "/relativa"
    for url in ("https://evil.com/", "//evil.com/x", "javascript:alert(1)", "https://mail.metro.cl/", None):
        assert atajos.mismo_sitio(url, INICIO) is None


def kit_derivado() -> list[dict]:
    """El atajo, el lanzador y el buscador que salen del catálogo y la ruta de metro."""
    kit = atajos.derivar(_goals(), {"planificar-viaje": _route()}, SELECTS, INICIO)
    return [kit["atajos"][0]["vista"], kit["lanzador"], kit["buscador"]]


def test_buscador_con_el_catalogo_de_metro():
    buscador = kit_derivado()[2]
    enlaces = [t["enlace"] for t in buscador["datos"]]
    # Todo el catálogo del mismo sitio, también el objetivo del atajo; sin metromuv, outlook ni mail.metro.cl.
    assert "/el-viaje/planificador" in enlaces and len(enlaces) == len(set(enlaces)) == 8
    assert all(e.startswith("/") and not e.startswith("//") for e in enlaces)
    assert buscador["rutas"] == ["/"] and buscador["contenedor"] == kit_derivado()[1]["contenedor"]
    assert buscador["opciones"] == {"max": 8, "sugeridas": 6} and "teclas" not in buscador["opciones"]
    assert all("grupo" not in t for t in buscador["datos"])


def test_el_buscador_agrupa_por_el_objetivo_padre_y_tiene_tope():
    goals = _goals()
    padre = Goal(**{**goals[0].__dict__, "id": "viajar", "level": "summary", "description": "Viajar en Metro."})
    goals[1].parent = goals[2].parent = "viajar"
    buscador = atajos.buscador(goals, {}, INICIO, [padre, *goals])
    grupos = {t["enlace"]: t.get("grupo") for t in buscador["datos"]}
    assert grupos["/el-viaje/estado-red"] == {"es": "Viajar en Metro", "en": "Viajar en Metro"}
    assert grupos["/el-viaje/planificador"] is None and buscador["opciones"]["agrupar"] is True
    muchos = [Goal(**{**goals[0].__dict__, "id": f"g{i}", "entry": f"{METRO}/t{i}"}) for i in range(50)]
    assert len(atajos.buscador(muchos, {}, INICIO)["datos"]) == atajos.MAX_BUSCADOR


def _vistas_derivadas() -> list[dict]:
    kit = atajos.derivar(_goals(), {"planificar-viaje": _route()}, SELECTS, INICIO)
    return [kit["atajos"][0]["vista"], kit["lanzador"]]


def test_el_kit_derivado_valida():
    tema, descartes = tema_json.armar("metro", kit_derivado())
    assert descartes == [] and [v["id"] for v in tema["features"]["vista"]] == ["planificar-viaje", "tareas", "buscar"]


def test_el_atajo_hecho_a_mano_valida():
    fixture = Path(__file__).parents[4] / "extension" / "test" / "fixtures" / "metro" / "tema.json"
    atajo = json.loads(fixture.read_text(encoding="utf-8"))["features"]["vista"][0]
    assert tema_json.validar_vista(atajo) == (atajo, [])


def test_el_buscador_hecho_a_mano_valida():
    fixture = Path(__file__).parents[4] / "extension" / "test" / "fixtures" / "metro" / "tema.json"
    vistas = json.loads(fixture.read_text(encoding="utf-8"))["features"]["vista"]
    buscador = next(v for v in vistas if v["componente"] == "buscador")
    assert len(buscador["datos"]) > tema_json.MAX_ITEMS["lanzador"]
    assert tema_json.validar_vista(buscador) == (buscador, [])


@pytest.mark.parametrize("enlace", ["//evil.com/x", "/\\evil.com", "https://evil.com/", "javascript:alert(1)",
                                    "/con espacio", "relativa"])
def test_enlaces_fuera_del_sitio_se_descartan(enlace):
    atajo, lanzador = _vistas_derivadas()
    lanzador["datos"][0]["enlace"] = enlace
    tema, descartes = tema_json.armar("metro", [atajo, lanzador])
    assert len(tema["features"]["vista"][1]["datos"]) == len(lanzador["datos"]) - 1
    assert "item descartado" in descartes[0] and "enlace" in descartes[0]


@pytest.mark.parametrize("cambio, motivo", [
    (lambda v: v.update(componente="cartelera"), "componente no permitido"),
    (lambda v: v.update(id="Planificar"), "$.id"),
    (lambda v: v.update(contenedor="div " * 60), "$.contenedor"),
    (lambda v: v["opciones"].update(destino="//evil.com/x"), "$.opciones.destino"),
    (lambda v: v["opciones"].update(invertir=["inicio", "otro"]), "invertir"),
    (lambda v: v["opciones"].update(textos={"es": {"titulo": "x" * 200}}), "$.opciones.textos.es.titulo"),
    (lambda v: v.update(datos=[{"nombre": "a", "etiqueta": {"es": "Desde"}, "opciones": "#a"}]), "$.datos"),
    (lambda v: v.update(datos=[{"nombre": "inicio", "etiqueta": {"es": "A", "en": "A"}}]), "$.datos"),
    (lambda v: v.update(script="alert(1)"), "clave no permitida"),
    # Los mismos topes que tema-remoto.js: un `\n` final no pasa el patrón (fullmatch, no search).
    (lambda v: v.update(id="planificar\n"), "$.id"),
    (lambda v: v["opciones"].update(destino="/" + "a" * 200), "$.opciones.destino"),
    (lambda v: v["opciones"].update(fijos={f"k{i}": "x" for i in range(7)}), "$.opciones.fijos"),
    (lambda v: v["opciones"].update(fijos={"a b": "x"}), "$.opciones.fijos.a b"),
])
def test_vistas_invalidas_se_descartan_con_razon(cambio, motivo):
    atajo, lanzador = _vistas_derivadas()
    cambio(atajo)
    tema, descartes = tema_json.armar("metro", [atajo, lanzador])
    assert [v["id"] for v in tema["features"]["vista"]] == ["tareas"]
    assert motivo in descartes[-1]


def test_casos_limite_que_si_validan():
    atajo, _ = _vistas_derivadas()
    atajo["datos"][0]["nombre"] = "q[inicio]"
    atajo["opciones"].pop("invertir")
    atajo["opciones"]["fijos"] = {f"k{i}": "x" for i in range(6)}
    atajo["opciones"]["destino"] = "/" + "a" * 199
    assert tema_json.validar_vista(atajo) == (atajo, [])


def test_sin_imagen_ni_ids_repetidos():
    atajo, lanzador = _vistas_derivadas()
    lanzador["datos"][0]["imagen"] = "/logo.png"
    tema, descartes = tema_json.armar("metro", [atajo, lanzador, dict(lanzador)])
    assert len(tema["features"]["vista"]) == 2 and "imagen" not in json.dumps(tema)
    assert any("'imagen'" in d for d in descartes) and "repetida" in descartes[-1]


def test_la_propuesta_del_modelo_pone_las_palabras():
    atajo, lanzador = _vistas_derivadas()
    atajo = tema_json.con_propuesta(atajo, {
        "contenedor": "", "textos": {"es": {"titulo": "¿A dónde vas?", "subtitulo": "", "boton": "Ver ruta"},
                                     "en": {"titulo": "Where to?", "subtitulo": "", "boton": "See route"}},
        "etiquetas": [{"nombre": "inicio", "es": "Desde", "en": "From"}, {"nombre": "fin", "es": "Hasta", "en": ""}]})
    assert atajo["contenedor"] == "body > :has(#binicio)"
    assert atajo["opciones"]["textos"] == {"es": {"titulo": "¿A dónde vas?", "boton": "Ver ruta"},
                                           "en": {"titulo": "Where to?", "boton": "See route"}}
    # Una etiqueta sin inglés deja la derivada.
    assert [c["etiqueta"]["en"] for c in atajo["datos"][:2]] == ["From", "Fin"]
    lanzador = tema_json.con_propuesta(lanzador, {"contenedor": "main", "tareas": [
        {"enlace": "/el-viaje/estaciones", "titulo_es": "Estaciones", "titulo_en": "Stations", "detalle_es": "",
         "detalle_en": ""}]})
    estaciones = next(t for t in lanzador["datos"] if t["enlace"] == "/el-viaje/estaciones")
    assert lanzador["contenedor"] == "main" and estaciones["titulo"] == {"es": "Estaciones", "en": "Stations"}
    assert tema_json.armar("metro", [atajo, lanzador])[1] == []


PORTADA = """<!doctype html><meta charset="utf-8"><title>Metro de Santiago</title>
<body><header><h1>Metro</h1></header>
<div class="portada"><div class="hero"><video></video></div><div id="home"><form id="formPlanificador" action="/el-viaje/planificador/">
<label for="binicio">Origen</label>
<select id="binicio" name="inicio"><option value="SP">San Pablo</option><option value="EL">Estación Central</option>
</select>
<select id="fin" name="fin"><option value="SP">San Pablo</option><option value="EL">Estación Central</option>
</select>
<select id="horario" name="horario"><option value="PUNTA">Punta</option><option value="VALLE">Valle</option></select>
<select id="dia" name="dia"><option value="DL">Laboral</option><option value="SA">Sábado</option></select>
<button>Ir</button></form></div></div>
<main><p>Noticias</p></main></body>"""


@pytest.fixture
def metro_local(tmp_path):
    carpeta = tmp_path / "metro"
    carpeta.mkdir()
    (carpeta / "index.html").write_text(PORTADA, encoding="utf-8")
    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(carpeta))
    manejador.log_message = lambda *args: None
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{servidor.server_address[1]}"
    servidor.shutdown()


def _corrida(backend, prefijo, archivos: dict) -> None:
    run = store.start_run(backend, prefijo, model="guion", revision=REV)
    for nombre, datos in archivos.items():
        ruta = run.workdir / nombre
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    store.finish_run(backend, run, "succeeded")


def texto_del_modelo(disenador) -> str:
    return disenador.llamadas[0]["partes"][0]


MENSAJE = "Los campos para destino, hora y día de salida están fuera del área visible."


def _sembrar_revision(backend, url: str, metro_local: str) -> None:
    goals = json.loads((DATOS / "goals.json").read_text(encoding="utf-8").replace(METRO, metro_local))
    _corrida(backend, store.cataloger(url), {"goals.json": goals})
    _corrida(backend, store.guide(url, "planificar-viaje", "desktop"), {"route.json": _route(metro_local)})
    _corrida(backend, store.visitor(url, "planificar-viaje"), {
        "comparison.json": {"runs": [{"profile": "desktop", "reached_final_node": False}]},
        "desktop/run.json": {"profile": "desktop", "steps": [], "end_reason": "blocked", "final_message": MENSAJE,
                             "verdict": {"outcome": "abandoned", "justification": "Se detuvo sin llegar."}},
    })


COMPONENTES = [
        {"id": "planificar-viaje", "contenedor": "#no-existe",
         "textos": {"es": {"titulo": "¿A dónde vas?", "subtitulo": "", "boton": "Ver ruta"},
                    "en": {"titulo": "Where to?", "subtitulo": "", "boton": "See route"}},
         "etiquetas": [{"nombre": "inicio", "es": "Desde", "en": "From"}], "tareas": []},
        {"id": "tareas", "contenedor": "main",
         "textos": {"es": {"titulo": "Lo más buscado", "subtitulo": "", "boton": ""},
                    "en": {"titulo": "Most wanted", "subtitulo": "", "boton": ""}},
         "etiquetas": [], "tareas": []},
]
OCULTAR = 'html.mi-tema:not(.mt-vista-original):has([data-mt-vista="planificar-viaje"]) #home'


def test_corrida_revision_deja_el_kit(tmp_path, metro_local):
    from disenador.mejora import mejorar

    url = f"{metro_local}/"
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar_revision(backend, url, metro_local)
    disenador = ClaudeGuion(componentes=COMPONENTES, eleccion={"direccion": "B", "semilla": 4,
                                                               "ajustes": {"tipo.escala": 2}})
    manifest = asyncio.run(mejorar(backend, url, REV, None, disenador, "guion"))
    assert manifest.status == "succeeded"

    archivos = {n: manifest.key.file(n) for n in ("tema.css", "tema.json", "atajos.json", "diagnostico.json",
                                                  "mejora.json", "informe.json")}
    assert all(backend.exists(clave) for clave in archivos.values())
    vistas = {v["id"]: v for v in backend.read_json(archivos["tema.json"])["features"]["vista"]}
    atajo, lanzador = vistas["planificar-viaje"], vistas["tareas"]
    # El ancla propuesta no existe: queda la derivada, que sí está en la página.
    assert atajo["contenedor"] == "body > :has(#binicio)" and lanzador["contenedor"] == "main"
    assert atajo["datos"][0]["etiqueta"] == {"es": "Desde", "en": "From"}
    assert atajo["datos"][1]["etiqueta"]["es"] == "Fin"
    assert atajo["opciones"]["destino"] == "/el-viaje/planificador/" and "fijos" not in atajo["opciones"]
    assert lanzador["opciones"]["textos"]["en"]["titulo"] == "Most wanted"
    # El buscador no pasa por el modelo: va con su ancla derivada, que existe en la página.
    buscador = vistas["buscar"]
    assert buscador["contenedor"] == "body > :has(#binicio)" and len(buscador["datos"]) == 8
    assert "buscar" not in texto_del_modelo(disenador)

    diag = backend.read_json(archivos["diagnostico.json"])
    assert diag["viewport"] == {"width": 1024, "height": 768}
    assert diag["mensajes_visitante"][0]["mensaje"] == MENSAJE
    assert "Close" in diag["obstaculos"][0]["paso"]
    mejora = backend.read_json(archivos["mejora.json"])
    assert mejora["kit"] == {"vistas": ["planificar-viaje", "tareas", "buscar"], "descartes": []}
    assert backend.read_json(archivos["atajos.json"])["atajos"][0]["objetivo"] == "planificar-viaje"

    texto = disenador.llamadas[0]["partes"][0]
    assert MENSAJE in texto and "/el-viaje/planificador/" in texto and "componentes" in disenador.llamadas[0]["sistema"]

    # El modelo eligió dirección; el código compuso, recortó el ajuste y ocultó el planificador original.
    assert disenador.llamadas[0]["esquema"] is ESQUEMA_MOTOR and len(disenador.llamadas) == 1
    informe = backend.read_json(archivos["informe.json"])
    assert informe["modo"] == "motor" and informe["direccion"] == "B" and informe["semilla"] == 4
    assert informe["parametros"]["escala"] == 1.27 and any("tipo.escala=2" in a for a in informe["avisos"])
    assert informe["contraste"]["fallas"] == [] and informe["contraste"]["minimo"] >= 4.5 and informe["tokens"]
    assert informe["ocultar"] == [{"vista": "planificar-viaje", "selector": "#home"}]
    tema_css = backend.read_text(archivos["tema.css"])
    assert OCULTAR in tema_css and '[data-mt-vista="tareas"]' in tema_css and "#home :has(> h1)" not in tema_css


def test_si_el_motor_falla_cae_al_css_libre(tmp_path, metro_local):
    from disenador.mejora import mejorar

    url = f"{metro_local}/"
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar_revision(backend, url, metro_local)
    disenador = ClaudeGuion(componentes=COMPONENTES, eleccion={"direccion": "Z", "semilla": 1, "ajustes": {}})
    manifest = asyncio.run(mejorar(backend, url, REV, None, disenador, "guion"))
    assert manifest.status == "succeeded"
    assert [llamada["esquema"] for llamada in disenador.llamadas] == [ESQUEMA_MOTOR, ESQUEMA_KIT]
    informe = backend.read_json(manifest.key.file("informe.json"))
    assert informe["modo"] == "libre" and "dirección desconocida" in informe["respaldo"]
    tema_css = backend.read_text(manifest.key.file("tema.css"))
    assert "background: #111" in tema_css and OCULTAR in tema_css
