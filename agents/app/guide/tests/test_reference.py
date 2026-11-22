"""Exploración, destilación, verificación y minimización con un modelo guionizado en lugar de Claude."""

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

from shared.browser.session import connect_browser

from guide import config, reference
from guide.decider import Decision
from guide.explore import Exploration, _act
from guide.page_view import read_page_view
from guide.reference import Mapping, map_reference
from guide.replay import Replay, Verification
from guide.route import Step
from tests.conftest import DESKTOP, ScriptedDecider

QUOTE = "Para dar de baja llama al 103."


def _map(site, tmp_path, script, on_done=None, start_url=None, extra_routes=0):
    decider = ScriptedDecider(script, on_done)
    mapping = Mapping("prueba", start_url or (site / "index.html").as_uri(), "Encuentra cómo dar de baja", DESKTOP,
                      "guion", "low", tmp_path / "out", extra_routes)

    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await map_reference(browser, mapping, decider)
            finally:
                await browser.close()

    return asyncio.run(main()), decider, mapping.out_dir


def test_detour_and_useless_step_are_removed_and_route_verifies(site, tmp_path):
    document, decider, out_dir = _map(site, tmp_path, [
        ("click", "Ayuda", {}),                     # oculto: se rechaza
        ("click", "Menú", {}),                      # se repite al volver: la destilación corta el primero
        ("click", "Productos", {}),                 # desvío
        ("click", "Volver al inicio", {}),
        ("click", "Menú", {}),
        ("click", "Ayuda", {}),
        ("click", "Imprimir", {}),                  # no hace nada: la minimización lo quita
        ("click", "¿Cómo doy de baja?", {}),         # abre el acordeón al borde del viewport: la cita queda abajo
        ("done", None, {"answer": "Llamar al 103", "quote": "Para dar de baja llama al 104."}),
        ("done", None, {"answer": "Llamar al 103", "quote": QUOTE}),
    ])
    assert "no está a la vista" in decider.prompts[1]
    assert "la cita no está" in decider.prompts[-1]
    assert document["status"] == "verified" and document["quote_found"]
    assert [step["target"]["name"] for step in document["steps"]] == ["Menú", "Ayuda", "¿Cómo doy de baja?"]
    assert [step["in_viewport"] for step in document["steps"]] == [True, True, False]
    assert document["totals"] == {
        "actions": 3, "estimated_scrolls": 1, "quote_scrolls": 1, "min_steps": 5, "distinct_pages": 2,
    }
    assert [node.split(" | ")[1] for node in document["nodes"]] == ["Inicio", "Ayuda"]
    assert document["final_node"] == document["nodes"][-1]
    assert document["verification"] == {"replays": 4, "removed_steps": 1, "error": None}
    assert document["exploration"]["steps"] == 7 and document["exploration"]["turns"] == 10
    assert (document["viewport"], document["viewport_size"]) == ("desktop", "1024x768")
    saved = json.loads((out_dir / "route.json").read_text(encoding="utf-8"))
    assert saved["steps"][2]["node_after"].endswith("ayuda.html | Ayuda")
    assert sorted(path.name for path in out_dir.glob("*.png")) == ["step_00.png", "step_01.png", "step_02.png", "step_03.png"]
    assert "**verified**" in (out_dir / "route.md").read_text(encoding="utf-8")


def test_unanswered_exploration_is_not_found(site, tmp_path):
    document, _, out_dir = _map(site, tmp_path, [("give_up", None, {"text": "No está."})])
    assert document["status"] == "not_found" and document["steps"] == []
    assert document["exploration"]["end_reason"] == "gave_up" and document["verification"] is None
    assert (out_dir / "step_00.png").is_file()


def test_route_that_no_longer_replays_is_unverified(site, tmp_path):
    def remove_link():
        index = site / "index.html"
        index.write_text(index.read_text(encoding="utf-8").replace(">Productos</a>", "></a>"), encoding="utf-8")

    document, _, out_dir = _map(site, tmp_path, [
        ("click", "Productos", {}),
        ("done", None, {"answer": "Se vuelve con el enlace.", "quote": "Volver al inicio"}),
    ], on_done=remove_link)
    assert document["status"] == "unverified" and not document["quote_found"]
    assert "paso 1 (click «Productos»)" in document["verification"]["error"]
    assert [step["label"] for step in document["steps"]] == ["click «Productos»"]
    assert "**unverified**" in (out_dir / "route.md").read_text(encoding="utf-8")


def test_step_limit_still_lets_the_model_answer(site, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MAX_STEPS", 1)
    document, decider, _ = _map(site, tmp_path, [
        ("click", "Productos", {}),
        ("click", "Volver al inicio", {}),
        ("done", None, {"answer": "Está en Productos.", "quote": "Volver al inicio"}),
    ])
    assert "máximo de acciones" in decider.prompts[2]
    assert document["status"] == "verified" and document["exploration"]["steps"] == 1


def test_step_limit_ends_after_one_warning_even_if_a_done_was_rejected(site, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MAX_STEPS", 1)
    document, decider, _ = _map(site, tmp_path, [
        ("click", "Productos", {}),
        ("click", "Volver al inicio", {}),
        ("done", None, {"answer": "x", "quote": "No está en la página"}),
        ("click", "Volver al inicio", {}),
        ("click", "Volver al inicio", {}),
    ])
    assert document["exploration"]["end_reason"] == "step_limit" and document["exploration"]["turns"] == 4
    assert len(decider.script) == 1 and document["status"] == "not_found"


def test_verify_falls_back_to_the_cut_where_the_page_was_left(monkeypatch):
    def step(name, before, after, action="click"):
        return Step(action, name, None, f"https://s.cl/{before}", before, f"https://s.cl/{after}", after, True)

    steps = [step("menú", "a", "a"), step("productos", "a", "p"), step("atrás", "p", "a", "back"), step("ayuda", "a", "h")]
    tried = []

    async def fake_verify(browser, profile, url, candidate, final_node, quote, log):
        tried.append([item.value for item in candidate])
        verified = len(candidate) == 2
        return Verification(verified, candidate, Replay(), 1, 0, None if verified else "terminó en otra página")

    monkeypatch.setattr(reference, "verify_and_minimise", fake_verify)
    mapping = Mapping("prueba", "https://s.cl/a", "x", DESKTOP, "m", "low", Path("."))
    exploration = Exploration(steps=steps, final_node=steps[-1].node_after, quote="q")
    verification = asyncio.run(reference._verify(None, mapping, exploration, lambda text: None))
    assert tried == [["ayuda"], ["menú", "ayuda"]] and verification.verified


def test_browser_error_ends_the_exploration_and_still_writes_the_route(site, tmp_path):
    document, _, out_dir = _map(site, tmp_path, [], start_url="http://127.0.0.1:9/")
    assert document["status"] == "not_found" and document["exploration"]["end_reason"] == "browser_error"
    assert (out_dir / "route.json").is_file() and not (out_dir / "step_00.png").exists()


def test_press_with_a_ref_does_not_record_an_element(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        step = await _act(session, Decision(reason="", action="press", ref=view.elements[0].ref, text="Tab"), view)
        assert step.target is None and step.in_viewport is None

    with_session("index.html", body)


def test_answer_inside_a_collapsed_accordion_needs_the_click_that_opens_it(site, tmp_path):
    answer = {"answer": "42", "quote": "La respuesta es 42."}
    document, decider, _ = _map(site, tmp_path, [
        ("done", None, answer),
        ("click", "Ver respuesta", {}),
        ("done", None, answer),
    ], start_url=(site / "acordeon.html").as_uri())
    assert "La respuesta es 42." not in decider.prompts[0] and "la cita no está" in decider.prompts[1]
    assert document["status"] == "verified" and [step["label"] for step in document["steps"]] == ["click «Ver respuesta»"]


def test_link_to_another_site_is_rejected(site, tmp_path):
    document, decider, _ = _map(site, tmp_path, [
        ("click", "Otro sitio", {}),
        ("give_up", None, {"text": "No está."}),
    ], start_url=(site / "acordeon.html").as_uri())
    assert "otro sitio" in decider.prompts[1] and document["exploration"]["steps"] == 0
