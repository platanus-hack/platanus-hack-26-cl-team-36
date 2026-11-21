"""Pruebas de los perfiles exploradores sin llamar a Claude: skill en el prompt, límites propios, volver_a_nodo y ramas."""

import asyncio
import functools
import threading
from contextlib import contextmanager
from dataclasses import replace
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from playwright.async_api import async_playwright

import config
import profiles
from browser import connect_browser
from engines import ActionRequest, AttemptEnded, Turn, decision_to_turn
from harness import SyntheticUser
import report
from profiles import PERFILES_POR_DEFECTO, PROFILES, Profile, system_prompt
from route_tree import build_route_tree

# --- Perfiles y prompt ---------------------------------------------------------------------------------------------


EXPLORADORES = ("explorador", "explorador_buscador", "explorador_pie", "explorador_contenido")


def test_los_perfiles_por_defecto_no_cambian_y_los_exploradores_se_piden_por_nombre():
    assert PERFILES_POR_DEFECTO == ("first_time", "hurried", "mobile")
    assert list(PROFILES) == [*PERFILES_POR_DEFECTO, *EXPLORADORES]
    for key in EXPLORADORES:
        assert PROFILES[key].key == key and PROFILES[key].explora and key not in PERFILES_POR_DEFECTO
    assert "no_existe" not in PROFILES


def test_main_usa_los_por_defecto_y_lista_todos_los_perfiles(capsys, monkeypatch):
    import main

    ayuda = main.build_parser().format_help()
    for key in PROFILES:
        assert key in ayuda
    monkeypatch.setattr("sys.argv", ["main.py", "--url", "https://ejemplo.cl", "--instruction", "x", "--profiles", "nadie"])
    monkeypatch.setattr(main.shutil, "which", lambda _: "/usr/bin/claude")
    with pytest.raises(SystemExit):
        main.main()
    error = capsys.readouterr().err
    assert "perfiles desconocidos: nadie" in error and all(key in error for key in PROFILES)


def test_el_prompt_del_explorador_trae_la_skill_sin_frontmatter_y_sus_limites():
    prompt = system_prompt(PROFILES["explorador"])
    assert "CÓMO EXPLORAR" in prompt and "# Explorar caminos" in prompt
    assert "name: explorar-caminos" not in prompt and "description:" not in prompt
    assert f"{config.EXPLORADOR_MAX_ACCIONES} acciones" in prompt
    assert '"volver_a_nodo"' in prompt
    # con la API no hay volver_a_nodo: se le dice que use alt+Left
    assert "No tienes la acción `volver_a_nodo`" in system_prompt(PROFILES["explorador"], "api")


def test_los_exploradores_empiezan_por_lugares_distintos():
    descripciones = {profile.description for profile in PROFILES.values() if profile.explora}
    assert len(descripciones) == 4


def test_el_prompt_de_los_otros_perfiles_no_cambia():
    prompt = system_prompt(PROFILES["first_time"])
    assert "CÓMO EXPLORAR" not in prompt and "volver_a_nodo" not in prompt
    assert f"Tienes como máximo {config.MAX_STEPS} acciones y {config.MAX_SECONDS // 60} minutos." in prompt


def test_una_skill_que_no_existe_da_un_error_claro(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DIR_SKILLS", tmp_path)
    profiles.cuerpo_de_skill.cache_clear()
    try:
        with pytest.raises(FileNotFoundError, match="explorar-caminos"):
            system_prompt(PROFILES["explorador"])
    finally:
        profiles.cuerpo_de_skill.cache_clear()


def test_config_se_importa_fuera_del_repo_como_en_agentcore(monkeypatch):
    """En AgentCore el código queda en /var/task: config.py no tiene tres carpetas por encima ni hay skills.
    Se usa /task y no /var/task porque en macOS /var es un enlace a /private/var y resolve() sumaría una carpeta."""
    fuente = Path(config.__file__).read_text(encoding="utf-8")
    espacio = {"__file__": "/task/config.py", "__name__": "config_en_agentcore"}
    exec(compile(fuente, "/task/config.py", "exec"), espacio)
    assert espacio["DIR_SKILLS"] is None

    monkeypatch.setattr(config, "DIR_SKILLS", None)
    profiles.cuerpo_de_skill.cache_clear()
    try:
        with pytest.raises(FileNotFoundError, match="explorar-caminos"):
            system_prompt(PROFILES["explorador"])
    finally:
        profiles.cuerpo_de_skill.cache_clear()


def test_los_limites_son_por_perfil():
    explorador, primera_vez = PROFILES["explorador"], PROFILES["first_time"]
    assert (explorador.limite_acciones, explorador.limite_segundos, explorador.limite_turnos) == (
        config.EXPLORADOR_MAX_ACCIONES, config.EXPLORADOR_MAX_SEGUNDOS, config.EXPLORADOR_MAX_TURNOS
    )
    assert (primera_vez.limite_acciones, primera_vez.limite_segundos, primera_vez.limite_turnos) == (
        config.MAX_STEPS, config.MAX_SECONDS, config.MAX_TURNS
    )


def test_decision_volver_a_nodo():
    turn = decision_to_turn({"expectation": "Vuelvo al inicio.", "action": "volver_a_nodo", "nodo": "p1"}, 3)
    assert [(r.name, r.input) for r in turn.requests] == [
        ("expectation", {"sentence": "Vuelvo al inicio."}),
        ("volver_a_nodo", {"nodo": "p1"}),
    ]


# --- Ciclo con un motor guionado sobre páginas locales -------------------------------------------------------------

EXPLORADOR = replace(PROFILES["explorador"], key="explorador_prueba", max_acciones=6, max_segundos=60)
NORMAL = Profile("normal_prueba", "Prueba", 1024, 768, False, "")


def _clic(n, x, y, frase="Abro una rama."):
    return Turn(requests=[
        ActionRequest(f"e{n}", "expectation", {"sentence": frase}, False),
        ActionRequest(f"a{n}", "left_click", {"coordinate": [x, y]}, True),
    ])


def _volver(n, nodo):
    return Turn(requests=[
        ActionRequest(f"e{n}", "expectation", {"sentence": f"[vuelvo a {nodo}]"}, False),
        ActionRequest(f"a{n}", "volver_a_nodo", {"nodo": nodo}, True),
    ])


class GuionEngine:
    name = "claude-code"
    model = "fake"

    def __init__(self, turns):
        self.turns = list(turns)
        self.usage: dict = {}
        self.respuestas: list[list[str]] = []

    async def start(self, system_prompt, first_message, screenshot, log_dir):
        pass

    async def decide(self) -> Turn:
        if not self.turns:
            raise AttemptEnded("no_response")
        return self.turns.pop(0)

    async def respond(self, results, screenshot):
        self.respuestas.append([result.text for result in results])

    async def close(self):
        pass


def _sitio(tmp_path):
    enlace = '<a href="{href}" style="position:absolute;left:20px;top:{top}px;font-size:30px">{texto}</a>'
    (tmp_path / "uno.html").write_text(
        "<title>Uno</title>"
        + enlace.format(href="dos.html", top=20, texto="Ir a dos")
        + enlace.format(href="tres.html", top=120, texto="Ir a tres"),
        encoding="utf-8",
    )
    (tmp_path / "dos.html").write_text("<title>Dos</title><h1>Callejón</h1>", encoding="utf-8")
    (tmp_path / "tres.html").write_text("<title>Tres</title><h1>La respuesta</h1>", encoding="utf-8")
    return (tmp_path / "uno.html").as_uri()


@contextmanager
def _servidor(carpeta):
    """Sirve `carpeta` por http://127.0.0.1:<puerto>/: volver_a_nodo solo acepta páginas http(s) del sitio inicial."""
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(carpeta))
    handler.log_message = lambda *args: None
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    try:
        yield f"http://127.0.0.1:{servidor.server_address[1]}/"
    finally:
        servidor.shutdown()
        servidor.server_close()


def _intento(tmp_path, profile, turns, pagina="uno.html"):
    if pagina == "uno.html":
        _sitio(tmp_path)
    engine = GuionEngine(turns)

    async def escenario(url):
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                user = SyntheticUser(engine, browser, profile, url, "Encontrar la respuesta", tmp_path / "run")
                return await user.attempt()
            finally:
                await browser.close()

    with _servidor(tmp_path) as base:
        return asyncio.run(escenario(base + pagina)), engine


def test_volver_a_nodo_abre_ramas_desde_la_misma_pagina(tmp_path):
    run, engine = _intento(tmp_path, EXPLORADOR, [
        _clic(1, 40, 35),          # p1 Uno -> p2 Dos (callejón)
        _volver(2, "p1"),          # p2 -> p1
        _clic(3, 40, 135),         # p1 -> p3 Tres (respuesta)
        _volver(4, "p1"),          # sale de la respuesta para explorar
        _clic(5, 40, 135),         # vuelve a Tres con un clic: revisita, no error
        Turn(final=("done", "RESPUESTA: La respuesta")),
    ])
    assert run.end_reason == "done"
    assert [step.title for step in run.steps] == ["Dos", "Uno", "Tres", "Uno", "Tres"]
    assert run.steps[1].description == "volver a «Uno»" and "went_back" in run.steps[1].signals
    assert run.steps[4].signals == ["revisit"]
    # el presupuesto y las páginas vistas llegan tras cada acción
    assert engine.respuestas[0][-1].startswith("OK. Llevas 1 de 6 acciones: te quedan 5 acciones")
    assert "p1 «Uno», p2 «Dos»" in engine.respuestas[0][-1] and "Estás en p2." in engine.respuestas[0][-1]

    data = run.to_dict()
    data["verdict"] = {"outcome": "success"}
    tree = build_route_tree([data])
    ids = {node["title"]: node["id"] for node in tree["nodes"]}
    salientes = [b for b in tree["branches"] if b["source"] == ids["Uno"]]
    assert {b["target"] for b in salientes} == {ids["Dos"], ids["Tres"]}  # el inicio se ramifica
    por_destino = {(b["source"], b["target"]): b for b in tree["branches"]}
    assert por_destino[(ids["Uno"], ids["Dos"])]["failures"] == 1         # callejón
    assert por_destino[(ids["Dos"], ids["Uno"])]["action"] == "volver a «Uno»"  # el retroceso queda como rama
    uno_tres = por_destino[(ids["Uno"], ids["Tres"])]
    # salir de la respuesta para explorar no la vuelve callejón, y volver a ella con un clic tampoco es error
    assert (uno_tres["successes"], uno_tres["failures"]) == (2, 0)
    route = tree["recommended_route"]
    assert [step["target"] for step in route["steps"]] == [ids["Tres"]]


def test_el_explorador_respeta_su_propio_limite_de_acciones(tmp_path):
    turnos = [_clic(1, 40, 35), _volver(2, "p1")] * 5
    run, _ = _intento(tmp_path, replace(EXPLORADOR, max_acciones=3), turnos)
    assert run.end_reason == "step_limit" and len(run.steps) == 3


def test_volver_a_nodo_desconocido_o_en_perfil_normal_es_error(tmp_path):
    run, engine = _intento(tmp_path, replace(EXPLORADOR, max_acciones=1), [_volver(1, "p9"), Turn(final=("give_up", "nada"))])
    assert run.steps == [] and "p9" in engine.respuestas[0][-1]

    run, engine = _intento(tmp_path, NORMAL, [_volver(1, "p1"), _clic(2, 40, 35), _clic(3, 40, 35),
                                              Turn(final=("done", "ok"))])
    assert "no está disponible" in engine.respuestas[0][-1]
    assert engine.respuestas[1] == ["OK", "OK"]  # los perfiles normales no reciben presupuesto


def test_el_reporte_usa_los_limites_de_cada_perfil(tmp_path):
    run, _ = _intento(tmp_path, replace(EXPLORADOR, key="explorador"), [_clic(1, 40, 35), Turn(final=("done", "ok"))])
    explorador = run.to_dict()
    explorador["verdict"] = {"outcome": "success", "justification": "ok"}
    normal = {**explorador, "profile": "first_time", "profile_name": "Primera vez", "end_reason": "step_limit"}
    meta = {"url": "u", "instruction": "i", "task_id": None, "timestamp": "t", "engine": "claude-code",
            "user_model": "fake", "judge_model": "fake", "effort": "low"}
    vacio = {"nodes": [], "branches": [], "recommended_route": None}
    texto = report.generate(meta, {"criterion": "c"}, [explorador, normal], vacio)
    acciones, segundos = config.EXPLORADOR_MAX_ACCIONES, config.EXPLORADOR_MAX_SEGUNDOS
    assert f"Explorador: {acciones} acciones y {segundos // 60} minutos" in texto
    assert f"Primera vez: {config.MAX_STEPS} acciones y {config.MAX_SECONDS // 60} minutos" in texto
    assert f"| 1 de {acciones} |" in texto and f"s de {segundos} s |" in texto
    assert f"Se agotaron las {config.MAX_STEPS} acciones" in texto
    # una tanda con un solo tipo de perfil da una sola frase
    assert f"**Límites por usuario:** {acciones} acciones y {segundos // 60} minutos" in report.generate(
        meta, {"criterion": "c"}, [explorador], vacio
    )


def test_el_explorador_no_puede_terminar_en_la_fase_de_abanico(tmp_path):
    explorador = replace(EXPLORADOR, max_acciones=5)
    run, engine = _intento(tmp_path, explorador, [
        _clic(1, 40, 135),                          # p1 -> p3 Tres: ya ve la respuesta
        Turn(final=("done", "RESPUESTA: temprano")),  # le quedan 4 de 5: se rechaza
        _volver(2, "p1"),
        _clic(3, 40, 35),                           # rama 2
        _volver(4, "p1"),
        Turn(final=("done", "RESPUESTA: ahora")),     # le queda 1 de 5: se acepta
    ])
    assert run.end_reason == "done" and run.final_message == "RESPUESTA: ahora"
    assert len(run.steps) == 4
    rechazo = engine.respuestas[1][0]
    assert rechazo.startswith("Todavía no puedes terminar") and "abriste 1 rama(s)" in rechazo
    assert any("se le pidió seguir explorando" in incidente for incidente in run.incidents)


def test_el_fin_temprano_se_acepta_tras_varios_rechazos_y_en_perfiles_normales(tmp_path):
    finales = [Turn(final=("gave_up", "nada"))] * 4
    run, engine = _intento(tmp_path, EXPLORADOR, finales)
    assert run.end_reason == "gave_up" and len(engine.respuestas) == 3  # MAX_FINES_RECHAZADOS

    run, engine = _intento(tmp_path, NORMAL, [Turn(final=("done", "ok"))])
    assert run.end_reason == "done" and engine.respuestas == []


def test_un_enlace_roto_queda_como_error_visible(tmp_path):
    (tmp_path / "roto.html").write_text(
        '<title>Roto</title><a href="http://no-existe.invalid/" style="font-size:30px">Catálogo</a>', encoding="utf-8"
    )
    run, _ = _intento(tmp_path, NORMAL, [_clic(1, 40, 20), Turn(final=("gave_up", "nada"))], pagina="roto.html")
    assert run.steps[0].url.startswith("chrome-error://")
    assert "visible_error" in run.steps[0].signals and "enlace roto" in run.steps[0].error_detail


def test_volver_a_nodo_solo_a_paginas_del_mismo_sitio(tmp_path):
    # El enlace cambia 127.0.0.1 por localhost: otro sitio para el harness, aunque lo sirva el mismo servidor.
    (tmp_path / "afuera.html").write_text(
        "<title>Uno</title><a href=\"#\" onclick=\"location.href = location.href.replace('127.0.0.1', 'localhost')"
        ".replace('afuera', 'dos'); return false\" style=\"font-size:30px\">Salir</a>",
        encoding="utf-8",
    )
    (tmp_path / "dos.html").write_text("<title>Dos</title><h1>Otro sitio</h1>", encoding="utf-8")
    run, engine = _intento(tmp_path, EXPLORADOR, [
        _clic(1, 40, 20),
        _volver(2, "p2"),
        Turn(final=("gave_up", "nada")),
    ], pagina="afuera.html")
    assert run.steps[0].title == "Dos" and "localhost" in run.steps[0].url
    assert "Páginas vistas: p1 «Uno»." in engine.respuestas[0][-1]  # la página de otro sitio no tiene id
    assert "No hay una página vista con id 'p2'" in engine.respuestas[1][-1]
