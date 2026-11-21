"""Búsqueda de una ruta más corta con un modelo guionizado: gana la verificada con menos pasos mínimos."""

import asyncio

from playwright.async_api import async_playwright

from browser import connect_browser
from mapper.reference import Mapping, map_reference
from tests.conftest import DESKTOP, ScriptedDecider

QUOTE = "Para dar de baja llama al 103."
PAGES = {
    "index.html": """<title>Inicio</title>
        <button aria-controls="nav" onclick="document.getElementById('nav').hidden = false">Menú</button>
        <nav id="nav" hidden><a href="servicios.html">Servicios</a></nav>
        <a href="baja.html" style="display:block;font-size:40px">Ver más</a>""",
    "servicios.html": """<title>Servicios</title><a href="baja.html">Dar de baja</a>""",
    "baja.html": f"""<title>Baja</title><p>{QUOTE}</p>""",
}
LONG = [("click", "Menú", {}), ("click", "Servicios", {}), ("click", "Dar de baja", {}),
        ("done", None, {"answer": "Llamar al 103", "quote": QUOTE})]
SHORT = [("click", "Ver más", {}), ("done", None, {"answer": "Llamar al 103", "quote": QUOTE})]


def map_site(tmp_path, script, on_done=None, extra_routes=1):
    for name, html in PAGES.items():
        (tmp_path / name).write_text(f'<meta charset="utf-8">{html}', encoding="utf-8")
    decider = ScriptedDecider(script, on_done)
    mapping = Mapping("prueba", (tmp_path / "index.html").as_uri(), "Encuentra cómo dar de baja", "desktop", DESKTOP,
                      "guion", "low", tmp_path / "out", extra_routes)

    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await map_reference(browser, mapping, decider)
            finally:
                await browser.close()

    return asyncio.run(main()), decider


def test_shorter_verified_route_replaces_the_first(tmp_path):
    document, decider = map_site(tmp_path, LONG + SHORT)
    assert "Ya hay una ruta verificada de 3 pasos mínimos" in decider.prompts[4]
    assert "3. click «Dar de baja» → «Baja»" in decider.prompts[4]
    assert document["status"] == "verified" and document["totals"]["min_steps"] == 1
    assert [step["target"]["name"] for step in document["steps"]] == ["Ver más"]
    assert document["search"]["tried"] == 2 and document["search"]["chosen"] == 2
    assert [route["min_steps"] for route in document["search"]["routes"]] == [3, 1]
    assert "Rutas exploradas: 2 (pasos mínimos: 3, 1; se eligió la 2)" in (tmp_path / "out" / "route.md").read_text()


def test_shorter_route_that_does_not_verify_keeps_the_first(tmp_path):
    dones = []

    def remove_shortcut():
        dones.append(1)
        if len(dones) == 2:
            index = tmp_path / "index.html"
            index.write_text(index.read_text(encoding="utf-8").replace(">Ver más</a>", "></a>"), encoding="utf-8")

    document, _ = map_site(tmp_path, LONG + SHORT, remove_shortcut)
    assert document["status"] == "verified" and document["totals"]["min_steps"] == 3
    assert document["search"]["chosen"] == 1
    assert [route["status"] for route in document["search"]["routes"]] == ["verified", "unverified"]


def test_no_extra_exploration_after_an_unanswered_first(tmp_path):
    document, decider = map_site(tmp_path, [("give_up", None, {"text": "No está."})])
    assert document["status"] == "not_found" and document["search"]["tried"] == 1 and len(decider.prompts) == 1
