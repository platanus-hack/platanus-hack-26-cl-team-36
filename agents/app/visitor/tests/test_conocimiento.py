"""Pruebas de los exploradores con nivel de conocimiento del tema, sin llamar a Claude.

Conjuntos de exploradores, reglas de cada nivel en el prompt, la tarea que lee cada nivel, el harness que no deja a
`sin_contexto` escribir términos oficiales que no ha visto, y la regla de oro: ningún nivel sabe DÓNDE está la
respuesta en el sitio.
"""

import asyncio
import json
import re
from dataclasses import replace
from pathlib import Path

import pytest
from playwright.async_api import async_playwright

import main
from shared.browser.session import connect_browser
from shared.catalog.tasks import load_task
from test_explorador import GuionEngine, _clic, _servidor
from visitor import config, report
from visitor.conocimiento import (
    CONOCE_TEMA,
    NIVELES,
    SIN_CONTEXTO,
    ConocimientoDeTarea,
    normalizar,
    tarea_para,
    terminos_en,
)
from visitor.harness import SyntheticUser
from visitor.profiles import (
    CONJUNTOS_EXPLORADORES,
    LUGARES,
    PERFILES_POR_DEFECTO,
    PROFILES,
    cuerpo_de_skill,
    exploradores_del_conjunto,
    system_prompt,
)
from visitor.turns import ActionRequest, Turn

TAREAS = sorted((Path(__file__).resolve().parents[3] / "tasks").glob("*/*.json"))

# --- Conjuntos y perfiles ------------------------------------------------------------------------------------------


def test_el_conjunto_base_son_los_4_de_siempre_y_el_de_conocimiento_8():
    assert CONJUNTOS_EXPLORADORES["base"] == ("explorador", "explorador_buscador", "explorador_pie", "explorador_contenido")
    ocho = CONJUNTOS_EXPLORADORES["conocimiento"]
    assert len(ocho) == 8 == len(set(ocho))
    assert set(ocho) == {f"explorador_{lugar}_{nivel}" for lugar in LUGARES for nivel in NIVELES}
    for key in ocho:
        perfil = PROFILES[key]
        assert perfil.explora and perfil.skill == "explorar-caminos" and perfil.conocimiento in NIVELES
        assert key not in PERFILES_POR_DEFECTO
    for key in CONJUNTOS_EXPLORADORES["base"]:
        assert PROFILES[key].conocimiento is None
    assert config.CONJUNTO_EXPLORADORES in CONJUNTOS_EXPLORADORES
    with pytest.raises(ValueError, match="disponibles: base, conocimiento"):
        exploradores_del_conjunto("seis")


def test_cada_lugar_tiene_un_explorador_por_nivel_con_la_misma_primera_rama_salvo_el_buscador():
    for lugar in LUGARES:
        sin, con = PROFILES[f"explorador_{lugar}_sin_contexto"], PROFILES[f"explorador_{lugar}_conoce_tema"]
        assert sin.description == con.description  # mismo lugar de partida
        if lugar == "buscador":
            assert "nombre oficial" in con.primera_rama and "no nombres oficiales" in sin.primera_rama
        else:
            assert sin.primera_rama == con.primera_rama
    base = PROFILES["explorador"]
    assert PROFILES["explorador_menu_sin_contexto"].primera_rama == base.primera_rama


def test_el_prompt_trae_las_reglas_concretas_de_cada_nivel():
    sin = system_prompt(PROFILES["explorador_menu_sin_contexto"])
    con = system_prompt(PROFILES["explorador_menu_conoce_tema"])
    assert "LO QUE SABES DEL TEMA: nada más que tu objetivo" in sin
    assert "el sistema rechaza esa búsqueda" in sin and "olor alto para ti solo si dice con claridad" in sin
    assert "LO QUE SABES DEL TEMA: lo conoces bien" in con
    assert "escribe el nombre oficial" in con and "no sabes en qué sección ni en qué página" in con
    assert "nada más que tu objetivo" not in con and "lo conoces bien" not in sin
    # el resto del prompt (skill, límites) es el mismo que el de los de siempre
    assert "# Explorar caminos" in sin and "# Explorar caminos" in con
    for key in (*PERFILES_POR_DEFECTO, *CONJUNTOS_EXPLORADORES["base"]):
        assert "LO QUE SABES DEL TEMA" not in system_prompt(PROFILES[key])


# --- La tarea de cada nivel ----------------------------------------------------------------------------------------

CONOCIMIENTO = ConocimientoDeTarea(
    description_sin_contexto="Quieres que te perdonen el impuesto de la casa.",
    terminos_oficiales=("contribuciones", "exención"),
    conocimiento_del_tema="El impuesto de la casa se llama contribuciones.",
)


def test_la_tarea_de_cada_nivel():
    original = "Pide la exención de contribuciones."
    assert tarea_para(None, original, CONOCIMIENTO) == tarea_para(None, original) == type(tarea_para(None, original))(original)

    sin = tarea_para(SIN_CONTEXTO, original, CONOCIMIENTO)
    assert sin.instruccion == CONOCIMIENTO.description_sin_contexto and sin.coloquial is True
    assert sin.terminos_vetados == ("contribuciones", "exención") and sin.contexto is None

    sin_version = tarea_para(SIN_CONTEXTO, original, ConocimientoDeTarea())
    assert sin_version.instruccion == original and sin_version.coloquial is False and sin_version.terminos_vetados == ()

    con = tarea_para(CONOCE_TEMA, original, CONOCIMIENTO)
    assert con.instruccion == original and con.coloquial is None and con.terminos_vetados == ()
    assert con.contexto == ("El impuesto de la casa se llama contribuciones. "
                            "Nombres oficiales que conoces: contribuciones, exención.")
    assert tarea_para(CONOCE_TEMA, original).contexto is None

    with pytest.raises(ValueError, match="nivel de conocimiento desconocido"):
        tarea_para("experto", original)


def test_terminos_en_ignora_tildes_y_mayusculas_admite_plural_y_exige_palabras_completas():
    assert normalizar("  Exención\n de  CONTRIBUCIONES ") == "exencion de contribuciones"
    assert terminos_en("exencion contribuciones", ["exención", "contribuciones", "avalúo"]) == ["exención", "contribuciones"]
    assert terminos_en("hazte Socios", ["socio"]) == ["socio"]
    assert terminos_en("vivienda principal", ["IPC"]) == []          # «ipc» no es palabra completa en «principal»
    assert terminos_en("¿cuándo sale el IPC?", ["IPC"]) == ["IPC"]
    assert terminos_en("asociación", ["socio"]) == []


def test_de_tarea_lee_los_campos_y_tolera_que_falten():
    assert ConocimientoDeTarea.de_tarea({"description": "x"}) == ConocimientoDeTarea()
    assert ConocimientoDeTarea.de_tarea(None) == ConocimientoDeTarea()
    leido = ConocimientoDeTarea.de_tarea({"description_sin_contexto": " a ", "terminos_oficiales": ["b", " "]})
    assert leido == ConocimientoDeTarea("a", ("b",), None)


def test_de_tarea_lee_la_tarea_cargada_de_agents_tasks():
    tarea = load_task("sii.cl/exencion-contribuciones")
    conocimiento = ConocimientoDeTarea.de_tarea(tarea)
    assert "contribuciones" in conocimiento.terminos_oficiales and conocimiento.description_sin_contexto


# --- Regla de oro: el conocimiento es del tema, nunca del sitio ----------------------------------------------------

# Palabras que delatan dónde está algo en un sitio: secciones, menús, enlaces, URLs.
_PISTAS_DE_LUGAR = re.compile(
    r"(https?:|www\.|\.cl\b|\.com\b|/|>|\bmen[uú]\b|\bsecci[oó]n|\bpesta[nñ]a|\bpie de p[aá]gina|\bbuscador|\benlace"
    r"|\blink\b|\bbot[oó]n|\bp[aá]gina|\bportal\b|\bsitio\b|\bclic\b|\bbanner|\bagenda\b|\bcalendario\b)",
    re.IGNORECASE,
)


@pytest.mark.parametrize("ruta", TAREAS, ids=lambda ruta: f"{ruta.parent.name}/{ruta.stem}")
def test_cada_tarea_trae_su_conocimiento_sin_pistas_de_lugar(ruta):
    tarea = json.loads(ruta.read_text(encoding="utf-8"))
    conocimiento = ConocimientoDeTarea.de_tarea(tarea)
    assert conocimiento.description_sin_contexto and conocimiento.terminos_oficiales and conocimiento.conocimiento_del_tema
    textos = [conocimiento.description_sin_contexto, conocimiento.conocimiento_del_tema, *conocimiento.terminos_oficiales]
    for texto in textos:
        assert not _PISTAS_DE_LUGAR.search(texto), f"{ruta.stem}: pista de lugar en «{texto}»"
    # la versión coloquial no trae ningún término oficial
    assert terminos_en(conocimiento.description_sin_contexto, conocimiento.terminos_oficiales) == []
    # el conocimiento del tema usa los términos oficiales, pero no trae la respuesta (ningún número de ella)
    assert terminos_en(conocimiento.conocimiento_del_tema, conocimiento.terminos_oficiales)
    numeros_de_la_respuesta = set(re.findall(r"\d+", tarea["expected_answer"]))
    assert not numeros_de_la_respuesta & set(re.findall(r"\d+", conocimiento.conocimiento_del_tema))
    # lo que lee cada nivel tampoco trae pistas de lugar
    for nivel in NIVELES:
        leida = tarea_para(nivel, tarea["description"], conocimiento)
        assert not _PISTAS_DE_LUGAR.search(leida.contexto or "")


def test_el_prompt_de_un_nivel_no_trae_nada_de_una_tarea():
    """Las reglas son las mismas para todas las tareas: lo propio de cada una va en el primer mensaje."""
    terminos = {t for ruta in TAREAS for t in json.loads(ruta.read_text(encoding="utf-8"))["terminos_oficiales"]}
    for key in CONJUNTOS_EXPLORADORES["conocimiento"]:
        prompt = system_prompt(PROFILES[key])
        seccion = prompt[prompt.index("LO QUE SABES DEL TEMA"):prompt.index("CÓMO EXPLORAR")]
        assert terminos_en(seccion, terminos) == []


# Palabras del tema de cada tarea, además de sus términos oficiales, y rótulos de las rutas de sus sitios: los ejemplos
# de explorar-caminos van en cada prompt de explorador, así que no pueden usar ninguno (serían una pista de dónde está
# la respuesta).
_PALABRAS_DE_LAS_TAREAS = [
    "fibra", "baja", "IPC", "arancel", "matrícula", "contribuciones", "avalúo", "despido", "retracto", "tarifa",
    "horario", "socio", "préstamo",
]
_ROTULOS_DE_LAS_RUTAS = ["Ayuda", "Centro de ayuda", "Preguntas frecuentes", "Agenda estadística", "Mapa del sitio"]


@pytest.mark.parametrize("ruta", TAREAS, ids=lambda ruta: ruta.stem)
def test_los_ejemplos_de_explorar_caminos_no_traen_palabras_de_ninguna_tarea(ruta):
    cuerpo = cuerpo_de_skill("explorar-caminos")
    terminos = json.loads(ruta.read_text(encoding="utf-8"))["terminos_oficiales"]
    assert terminos_en(cuerpo, terminos) == [], f"{ruta.stem}: la skill usa sus términos oficiales"
    assert terminos_en(cuerpo, _PALABRAS_DE_LAS_TAREAS) == []
    for rotulo in _ROTULOS_DE_LAS_RUTAS:
        assert f"«{normalizar(rotulo)}»" not in normalizar(cuerpo), f"la skill nombra la sección «{rotulo}»"


# --- El harness: tarea por nivel y términos vetados ---------------------------------------------------------------


class GuionConInicio(GuionEngine):
    async def start(self, system_prompt, first_message, screenshot, log_dir):
        self.primer_mensaje = first_message


def _escribir(n, texto):
    return Turn(requests=[
        ActionRequest(f"e{n}", "expectation", {"sentence": "Busco."}, False),
        ActionRequest(f"a{n}", "type", {"text": texto}, True),
    ])


def _intento(tmp_path, profile, turns, conocimiento):
    enlace = '<a href="tres.html" style="position:absolute;left:20px;top:120px;font-size:30px">Ir a tres</a>'
    (tmp_path / "uno.html").write_text(f"<title>Uno</title><input>{enlace}", encoding="utf-8")
    (tmp_path / "tres.html").write_text("<title>Tres</title><h1>La Respuesta Oficial</h1>", encoding="utf-8")
    engine = GuionConInicio(turns)

    async def escenario(url):
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                user = SyntheticUser(engine, browser, profile, url, "Tarea original", tmp_path / "run",
                                     conocimiento=conocimiento)
                return await user.attempt()
            finally:
                await browser.close()

    with _servidor(tmp_path) as base:
        return asyncio.run(escenario(base + "uno.html")), engine


CONOCIMIENTO_LOCAL = ConocimientoDeTarea(
    description_sin_contexto="Tarea con mis palabras",
    terminos_oficiales=("respuesta oficial",),
    conocimiento_del_tema="Lo oficial se llama respuesta oficial.",
)


def test_sin_contexto_no_puede_escribir_un_termino_oficial_hasta_verlo_en_el_sitio(tmp_path):
    perfil = replace(PROFILES["explorador_buscador_sin_contexto"], max_acciones=4, max_segundos=60)
    run, engine = _intento(tmp_path, perfil, [
        _escribir(1, "la Respuesta Oficial"),    # no la ha visto: se rechaza y no cuenta como acción
        _escribir(2, "mis palabras"),
        _clic(3, 40, 135),                      # p1 -> Tres, que muestra «La Respuesta Oficial»
        _escribir(4, "respuestas oficiales"),   # ya la vio: se escribe
        Turn(final=("done", "RESPUESTA: listo")),
    ], CONOCIMIENTO_LOCAL)
    assert engine.respuestas[0][-1].startswith("No se escribió: «respuesta oficial» es un nombre oficial")
    assert [step.action for step in run.steps] == ["type", "left_click", "type"]
    assert run.terminos_rechazados == ["respuesta oficial"]
    assert any("sin haberlo visto en el sitio" in incidente for incidente in run.incidents)
    assert run.instruction == "Tarea con mis palabras" and run.conocimiento == SIN_CONTEXTO and run.tarea_coloquial
    assert engine.primer_mensaje.startswith("Tu tarea: Tarea con mis palabras\n\nEsta es la pantalla inicial")
    guardado = json.loads((tmp_path / "run" / "run.json").read_text(encoding="utf-8"))
    assert guardado["conocimiento"] == SIN_CONTEXTO and guardado["terminos_rechazados"] == ["respuesta oficial"]


def test_conoce_tema_lee_la_tarea_original_con_lo_que_sabe_y_escribe_sin_restriccion(tmp_path):
    perfil = replace(PROFILES["explorador_buscador_conoce_tema"], max_acciones=1, max_segundos=60)
    run, engine = _intento(tmp_path, perfil, [_escribir(1, "respuesta oficial"), Turn(final=("done", "ok"))],
                           CONOCIMIENTO_LOCAL)
    assert [step.action for step in run.steps] == ["type"] and run.terminos_rechazados == []
    assert run.instruction == "Tarea original" and run.conocimiento == CONOCE_TEMA and run.tarea_coloquial is None
    assert engine.primer_mensaje == (
        "Tu tarea: Tarea original\n\nLo que ya sabes del tema (no del sitio): Lo oficial se llama respuesta oficial. "
        "Nombres oficiales que conoces: respuesta oficial.\n\nEsta es la pantalla inicial del sitio."
    )


def test_un_explorador_de_siempre_lee_la_tarea_original(tmp_path):
    perfil = replace(PROFILES["explorador_buscador"], max_acciones=1, max_segundos=60)
    run, engine = _intento(tmp_path, perfil, [_escribir(1, "respuesta oficial"), Turn(final=("done", "ok"))],
                           CONOCIMIENTO_LOCAL)
    assert run.instruction == "Tarea original" and run.conocimiento is None and run.terminos_rechazados == []
    assert engine.primer_mensaje == "Tu tarea: Tarea original\n\nEsta es la pantalla inicial del sitio."


# --- Reporte y línea de comandos -----------------------------------------------------------------------------------


def _run(perfil, nivel, resultado, rechazos=()):
    return {"profile": perfil, "profile_name": PROFILES[perfil].name, "viewport": "1024x768", "steps": [],
            "duration_s": 100.0, "end_reason": "done", "final_message": "", "turns": 1, "verdict": {"outcome": resultado},
            "token_usage": {}, "final_screenshot": "step_00.png", "conocimiento": nivel,
            "terminos_rechazados": list(rechazos)}


def test_el_reporte_separa_los_resultados_por_nivel():
    meta = {"url": "u", "instruction": "i", "task_id": None, "timestamp": "t", "engine": "claude-code",
            "user_model": "fake", "judge_model": "fake", "effort": "medium", "tarea_sin_contexto": "con mis palabras"}
    vacio = {"nodes": [], "branches": [], "recommended_route": None}
    runs = [_run("explorador_menu_sin_contexto", SIN_CONTEXTO, "success", ["contribuciones"]),
            _run("explorador_pie_sin_contexto", SIN_CONTEXTO, "failed"),
            _run("explorador_menu_conoce_tema", CONOCE_TEMA, "success")]
    texto = report.generate(meta, {"criterion": "c"}, runs, vacio)
    assert "| Perfil | Viewport | Conocimiento | Resultado |" in texto
    assert "| Explorador del menú (sin contexto) | 1024x768 | sin contexto | éxito |" in texto
    assert "## Resultado por nivel de conocimiento" in texto
    assert "Tarea que leyó el nivel «sin contexto»: con mis palabras" in texto
    assert "| sin contexto | 2 | 1 | 0 | 100 s | 1 |" in texto and "| conoce el tema | 1 | 1 | 0 | 100 s | 0 |" in texto

    sin_nivel = report.generate(meta, {"criterion": "c"}, [_run("explorador", None, "success")], vacio)
    assert "Conocimiento" not in sin_nivel and "por nivel de conocimiento" not in sin_nivel


class _CorridaFalsa:
    def file(self, nombre: str) -> str:
        return f"/tmp/tanda/{nombre}"


def _main_con(monkeypatch, *args) -> dict:
    llamada = {}

    async def run_batch_falso(backend, prefix, url, instruction, profile_keys, references, **kwargs):
        llamada.update(kwargs, profile_keys=profile_keys)
        return _CorridaFalsa()

    monkeypatch.setattr(main, "run_batch", run_batch_falso)
    monkeypatch.setattr(main, "find_references", lambda *args: {})
    monkeypatch.setattr(main.store, "open_backend", lambda: None)
    monkeypatch.setattr(main.shutil, "which", lambda _: "/usr/bin/claude")
    monkeypatch.setattr("sys.argv", ["main.py", "--task", "sii.cl/exencion-contribuciones", *args])
    main.main()
    return llamada


def test_main_elige_el_conjunto_de_exploradores_y_pasa_el_conocimiento_de_la_tarea(monkeypatch):
    llamada = _main_con(monkeypatch, "--exploradores", "conocimiento")
    assert llamada["profile_keys"] == list(CONJUNTOS_EXPLORADORES["conocimiento"])
    assert llamada["conjunto_exploradores"] == "conocimiento"
    assert "perdonar el impuesto" in llamada["conocimiento"].description_sin_contexto

    llamada = _main_con(monkeypatch, "--exploradores")  # sin nombre: el de config
    assert llamada["profile_keys"] == list(CONJUNTOS_EXPLORADORES[config.CONJUNTO_EXPLORADORES])

    llamada = _main_con(monkeypatch, "--profiles", "first_time,explorador", "--exploradores", "base")
    assert llamada["profile_keys"] == ["first_time", "explorador", "explorador_buscador", "explorador_pie",
                                       "explorador_contenido"]

    llamada = _main_con(monkeypatch)  # sin --exploradores, lo de siempre
    assert llamada["profile_keys"] == list(PERFILES_POR_DEFECTO) and llamada["conjunto_exploradores"] is None
