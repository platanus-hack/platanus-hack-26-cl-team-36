"""Pruebas de los perfiles exploradores sin llamar a Claude: skill en el prompt, límites propios, volver_a_nodo y ramas."""

import asyncio
from dataclasses import replace

import pytest
from playwright.async_api import async_playwright

import config
import profiles
from browser import connect_browser
from engines import ActionRequest, AttemptEnded, Turn, decision_to_turn
from harness import SyntheticUser
from profiles import PROFILES, Profile, system_prompt
from route_tree import build_route_tree

# --- Perfiles y prompt ---------------------------------------------------------------------------------------------


def test_los_perfiles_por_defecto_no_cambian_y_los_exploradores_se_piden_por_nombre():
    assert list(PROFILES) == ["first_time", "hurried", "mobile"]
    assert ",".join(PROFILES) == "first_time,hurried,mobile"
    for key in ("explorador", "explorador_buscador", "explorador_pie", "explorador_contenido"):
        assert key in PROFILES and PROFILES[key].key == key and PROFILES[key].explora
    assert "no_existe" not in PROFILES


def test_el_prompt_del_explorador_trae_la_skill_sin_frontmatter_y_sus_limites():
    prompt = system_prompt(PROFILES["explorador"])
    assert "CÓMO EXPLORAR" in prompt and "# Explorar caminos" in prompt
    assert "name: explorar-caminos" not in prompt and "description:" not in prompt
    assert f"{config.EXPLORADOR_MAX_ACCIONES} acciones" in prompt
    assert '"volver_a_nodo"' in prompt
    # con la API no hay volver_a_nodo: se le dice que use alt+Left
    assert "No tienes la acción `volver_a_nodo`" in system_prompt(PROFILES["explorador"], "api")


def test_los_exploradores_empiezan_por_lugares_distintos():
    descripciones = {PROFILES[key].description for key in PROFILES.todos() if PROFILES[key].explora}
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


def _intento(tmp_path, profile, turns):
    url = _sitio(tmp_path)
    engine = GuionEngine(turns)

    async def escenario():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                user = SyntheticUser(engine, browser, profile, url, "Encontrar la respuesta", tmp_path / "run")
                return await user.attempt()
            finally:
                await browser.close()

    return asyncio.run(escenario()), engine


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
    run, engine = _intento(tmp_path, EXPLORADOR, [_volver(1, "p9"), Turn(final=("give_up", "nada"))])
    assert run.steps == [] and "p9" in engine.respuestas[0][-1]

    run, engine = _intento(tmp_path, NORMAL, [_volver(1, "p1"), _clic(2, 40, 35), _clic(3, 40, 35),
                                              Turn(final=("done", "ok"))])
    assert "no está disponible" in engine.respuestas[0][-1]
    assert engine.respuestas[1] == ["OK", "OK"]  # los perfiles normales no reciben presupuesto
