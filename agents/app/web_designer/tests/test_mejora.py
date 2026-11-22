"""Etapa de mejora de una revisión: el resumen de lo medido y la corrida de improver en el almacén."""

import asyncio
import functools
import http.server
import json
import threading

import pytest

from shared import store
from shared.nodes.urls import node_key

from conftest import ClaudeGuion
from disenador import config
from disenador.mejora import TemaVacio, _visita, mejorar, peor_objetivo, resumir

REV = "rev-1"


@pytest.fixture
def url(sitio):
    """La página de prueba por HTTP: el almacén necesita un host."""
    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(sitio.parent))
    manejador.log_message = lambda *args: None
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{servidor.server_address[1]}/index.html"
    servidor.shutdown()


def _corrida(backend, prefijo, archivos: dict, revision: str = REV, estado: str = "succeeded") -> store.RunKey:
    run = store.start_run(backend, prefijo, model="guion", revision=revision)
    for nombre, datos in archivos.items():
        ruta = run.workdir / nombre
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(json.dumps(datos), encoding="utf-8")
    store.finish_run(backend, run, estado)
    return run.key


def _goal(url: str, goal_id: str, descripcion: str, **extra) -> dict:
    return {"id": goal_id, "host": "127.0.0.1", "start_url": url, "description": descripcion, "expected_answer": None,
            "level": "user_goal", "parent": None, "intent": "reach_page", "evidence": [], "entry": None, **extra}


def _ruta(url: str, paginas: list[tuple[str, str]]) -> dict:
    nodos = [node_key(url, "Prueba")] + [node_key(u, t) for u, t in paginas]
    return {"status": "verified", "totals": {"min_steps": len(paginas)}, "nodes": nodos, "final_node": nodos[-1],
            "steps": [{"label": f"clic en {t}", "url_after": u, "title_after": t} for u, t in paginas]}


def _intento(url: str, paginas: list[tuple[str, str]], outcome: str) -> dict:
    return {"profile": "desktop", "start": {"url": url, "title": "Prueba"}, "end_reason": "done",
            "verdict": {"outcome": outcome, "justification": f"terminó con {outcome}"},
            "steps": [{"url": u, "title": t, "description": f"clic en {t}"} for u, t in paginas]}


def _sembrar(backend, url: str) -> None:
    pagar, ayuda, error = (url.replace("index", nombre) for nombre in ("pagar", "ayuda", "error"))
    goals = [_goal(url, "pagar", "Pagar la cuenta"), _goal(url, "ayuda", "Encontrar la ayuda"),
             _goal(url, "contacto", "Escribir al soporte"), _goal(url, "buscar", "Buscar un producto"),
             _goal(url, "entrar", "Iniciar sesión", gates=["login"]), _goal(url, "sin-correr", "Otro")]
    _corrida(backend, store.cataloger(url), {"goals.json": {"host": "127.0.0.1", "issues": [], "goals": goals}})
    _corrida(backend, store.cataloger(url), {"goals.json": {"issues": [], "goals": []}}, revision="otra")

    _corrida(backend, store.guide(url, "pagar", "desktop"), {"route.json": _ruta(url, [(pagar, "Pagar")])})
    _corrida(backend, store.visitor(url, "pagar"), {
        "comparison.json": {"runs": [{"profile": "desktop", "reached_final_node": True}]},
        "desktop/run.json": _intento(url, [(pagar, "Pagar")], "success"),
    })
    # De otra revisión: no cuenta aunque sea más nueva.
    _corrida(backend, store.visitor(url, "pagar"), {
        "desktop/run.json": _intento(url, [(error, "Error")], "failed")}, revision="otra")

    _corrida(backend, store.guide(url, "ayuda", "desktop"), {"route.json": _ruta(url, [(ayuda, "Ayuda")])})
    # Sin comparison.json ni reached_final_node (el Visitante anterior): vale el veredicto.
    _corrida(backend, store.visitor(url, "ayuda"), {"desktop/run.json": _intento(url, [(error, "Error")], "failed")})

    _corrida(backend, store.guide(url, "contacto", "desktop"), {}, estado="failed")  # sin ruta
    _corrida(backend, store.guide(url, "buscar", "desktop"), {"route.json": _ruta(url, [(pagar, "Pagar")])})


def test_resumen_de_lo_medido(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    resumen, entradas = resumir(backend, url, REV)

    objetivos = {o["id"]: o for o in resumen["objetivos"]}
    assert list(objetivos) == ["pagar", "ayuda", "contacto", "buscar"]   # sin el excluido ni el que no se corrió
    assert objetivos["pagar"]["tasa_llegada"] == 1 and objetivos["pagar"]["visitas"][0]["se_desvio_en"] is None
    ayuda = objetivos["ayuda"]["visitas"][0]
    assert objetivos["ayuda"]["tasa_llegada"] == 0 and ayuda["llego"] is False
    assert "Error" in ayuda["se_desvio_en"] and "Error" in ayuda["se_detuvo_en"] and ayuda["por_que"]
    assert objetivos["contacto"]["ruta"] is None and objetivos["contacto"]["visitas"] == []
    assert objetivos["buscar"]["ruta"]["estado"] == "verified" and objetivos["buscar"]["tasa_llegada"] is None
    assert peor_objetivo(resumen)["id"] == "ayuda"
    assert len(entradas) == 7 and all(store.read_manifest(backend, k).revision == REV for k in entradas)

    # Sin visitas medidas, uno sin ruta va antes que uno con ruta.
    sin_visitas = {"objetivos": [objetivos["buscar"], objetivos["contacto"]]}
    assert peor_objetivo(sin_visitas)["id"] == "contacto"


def test_varios_intentos_y_perfiles_por_objetivo(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    pagar, error = url.replace("index", "pagar"), url.replace("index", "error")
    _corrida(backend, store.visitor(url, "pagar"), {
        "comparison.json": {"runs": [{"profile": "desktop", "run": "desktop", "reached_final_node": False},
                                     {"profile": "desktop", "run": "desktop-2", "reached_final_node": True},
                                     {"profile": "mobile", "run": "mobile", "reached_final_node": False}]},
        "desktop/run.json": _intento(url, [(error, "Error")], "failed"),
        "desktop-2/run.json": _intento(url, [(pagar, "Pagar")], "success"),
        "mobile/run.json": {**_intento(url, [(error, "Error")], "failed"), "profile": "mobile"},
        "explorador/run.json": {**_intento(url, [(error, "Error")], "unmeasured"), "profile": "explorador"},
    })
    pagar_medido = {o["id"]: o for o in resumir(backend, url, REV)[0]["objetivos"]}["pagar"]

    # Cada intento con su fila, no con la del último intento de su perfil.
    # Primero el intento 1 de cada perfil.
    assert [(v["perfil"], v["llego"]) for v in pagar_medido["visitas"]] == [
        ("desktop", False), ("explorador", None), ("mobile", False), ("desktop", True)]
    assert pagar_medido["intentos"] == 4
    assert pagar_medido["tasa_llegada"] == 0.33
    assert pagar_medido["tasa_por_perfil"] == {"desktop": 0.5, "mobile": 0.0}
    # El explorador no se mide, pero queda dónde se salió de la ruta.
    assert "Error" in pagar_medido["visitas"][1]["se_desvio_en"]


def test_con_muchos_intentos_la_tasa_usa_todos_y_el_modelo_ve_cada_perfil(tmp_path, url, monkeypatch):
    monkeypatch.setattr(config, "MAX_VISITAS", 2)
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    pagar, error = url.replace("index", "pagar"), url.replace("index", "error")
    archivos = {"comparison.json": {"runs": [
        {"run": "desktop", "reached_final_node": True}, {"run": "desktop-2", "reached_final_node": True},
        {"run": "desktop-3", "reached_final_node": True}, {"run": "mobile", "reached_final_node": False}]}}
    for carpeta in ("desktop", "desktop-2", "desktop-3"):
        archivos[f"{carpeta}/run.json"] = _intento(url, [(pagar, "Pagar")], "success")
    archivos["mobile/run.json"] = {**_intento(url, [(error, "Error")], "failed"), "profile": "mobile"}
    _corrida(backend, store.visitor(url, "pagar"), archivos)
    pagar_medido = {o["id"]: o for o in resumir(backend, url, REV)[0]["objetivos"]}["pagar"]
    assert [v["perfil"] for v in pagar_medido["visitas"]] == ["desktop", "mobile"]
    assert pagar_medido["tasa_llegada"] == 0.75 and pagar_medido["intentos"] == 4


def test_las_corridas_en_curso_no_cuentan(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    store.start_run(backend, store.visitor(url, "buscar"), model="guion", revision=REV)
    sin_ruta = store.start_run(backend, store.guide(url, "sin-correr", "desktop"), model="guion", revision=REV)
    (sin_ruta.workdir / "route.json").write_text(json.dumps(_ruta(url, [])), encoding="utf-8")
    resumen, entradas = resumir(backend, url, REV)

    objetivos = {o["id"]: o for o in resumen["objetivos"]}
    assert list(objetivos) == ["pagar", "ayuda", "contacto", "buscar"]
    assert objetivos["buscar"]["ruta"]["estado"] == "verified" and objetivos["buscar"]["visitas"] == []
    assert len(entradas) == 7 and all(store.read_manifest(backend, k).status != "running" for k in entradas)


def test_el_mensaje_del_visitante_va_antes_que_la_justificacion():
    intento = {"profile": "desktop", "steps": [], "final_message": "los campos están fuera del área visible",
               "verdict": {"outcome": "abandoned", "justification": "Se detuvo sin llegar a la página final."}}
    assert _visita(intento, {}, [])["por_que"] == "los campos están fuera del área visible"
    del intento["final_message"]
    assert _visita(intento, {}, [])["por_que"] == "Se detuvo sin llegar a la página final."


def test_sin_corridas_de_la_revision(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    resumen, entradas = resumir(backend, url, "nadie")
    assert resumen["objetivos"] == [] and entradas == [] and peor_objetivo(resumen) is None

    # Un catálogo sin ninguna ruta ni visita: van sus objetivos, sin medidas.
    _corrida(backend, store.cataloger(url), {"goals.json": {"issues": [], "goals": [_goal(url, "solo", "Solo")]}},
             revision="nueva")
    resumen, _ = resumir(backend, url, "nueva")
    assert [o["id"] for o in resumen["objetivos"]] == ["solo"] and resumen["objetivos"][0]["visitas"] == []


def test_corrida_de_mejora_en_el_almacen(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    disenador = ClaudeGuion()
    manifest = asyncio.run(mejorar(backend, url, REV, None, disenador, "guion", modo="libre"))

    assert manifest.status == "succeeded" and manifest.revision == REV and manifest.agent == "improver"
    assert store.revision_run(backend, store.improver(url), REV) == manifest.key
    tema = backend.read_text(manifest.key.file("tema.css"))
    assert tema.strip() and "url(" not in tema and "html.mi-tema footer p" in tema
    mejora = backend.read_json(manifest.key.file("mejora.json"))
    assert mejora["tarea"]["id"] == "ayuda" and mejora["decisiones"] == ["oscuro", "letra 18 px"]
    assert [o["id"] for o in mejora["resumen"]["objetivos"]][:2] == ["pagar", "ayuda"]

    texto, captura = disenador.llamadas[0]["partes"]
    assert "Encontrar la ayuda" in texto and config.GUSTOS_MEJORA in texto and '"se_desvio_en"' in texto
    assert captura.startswith(b"\x89PNG") and "viewport 1024x768" in texto


def test_css_vacio_falla(tmp_path, url):
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    with pytest.raises(TemaVacio):
        asyncio.run(mejorar(backend, url, REV, None, ClaudeGuion(css="@import 'x.css'; @layer a, b;"), "guion",
                            modo="libre"))
    run = store.revision_run(backend, store.improver(url), REV)
    assert store.read_manifest(backend, run).status == "failed"
    assert not backend.exists(run.file("tema.css"))
    mejora = backend.read_json(run.file("mejora.json"))
    assert mejora["error"].startswith("TemaVacio") and mejora["rechazos"]


def test_sin_capturas_la_mejora_sigue(tmp_path, url, monkeypatch):
    monkeypatch.setattr(config, "EXTENSION_SRC", tmp_path / "sin-extension")
    backend = store.LocalBackend(tmp_path / "almacen")
    _sembrar(backend, url)
    manifest = asyncio.run(mejorar(backend, url, REV, None, ClaudeGuion(), "guion", modo="libre"))

    assert manifest.status == "succeeded" and backend.exists(manifest.key.file("tema.json"))
    assert "vistas" not in backend.read_json(manifest.key.file("mejora.json"))
    assert backend.read_json(manifest.key.file("informe.json"))["vistas"].startswith("sin capturas: ")
    assert not backend.exists(manifest.key.file("escritorio-antes.png", "vistas"))
