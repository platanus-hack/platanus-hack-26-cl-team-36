"""Adopción de una ruta propuesta por el Visitante, sobre el sitio local de la búsqueda de rutas más cortas."""

import asyncio
import shutil

import pytest
from playwright.async_api import async_playwright

from shared import store
from shared.browser.session import connect_browser
from shared.nodes.urls import node_key

from guide.adopt import Unresolvable, adopt, derive_steps
from tests.test_candidates import LONG, map_site


def _raw(number, action, element=None, text=None, url="u", title="t"):
    return {"number": number, "action": action, "action_input": {"text": text} if text else {},
            "description": action, "element": element, "url_before": "u0", "title_before": "t0", "url": url, "title": title}


def test_derive_steps_merges_typing_skips_scroll_and_maps_back():
    steps = derive_steps({"steps": [
        _raw(1, "left_click", {"tag": "input", "text": "Buscar", "role": None, "href": None}),
        _raw(2, "type", text="baja"),
        _raw(3, "scroll"),
        _raw(4, "key", text="alt+Left"),
        _raw(5, "left_click", {"tag": "a", "text": "Ayuda", "href": "/ayuda"}),
    ]})
    assert [(step.action, step.value) for step in steps] == [("fill", "baja"), ("back", None), ("click", None)]
    assert [locator["by"] for locator in steps[2].target.locators] == ["href", "role", "text"]
    with pytest.raises(Unresolvable, match="paso 1"):
        derive_steps({"steps": [_raw(1, "left_click", {"tag": "div", "text": None, "href": None})]})


def _propose(tmp_path, element):
    """Publica la ruta de `map_site` como corrida de guide, propone `element` y adopta."""
    backend = store.LocalBackend(tmp_path / "almacen")
    route_run = store.start_run(backend, store.guide("sitio.cl", "prueba", "desktop"), model="guion")
    for path in (tmp_path / "out").iterdir():
        shutil.copy(path, route_run.workdir)
    store.finish_run(backend, route_run, "succeeded")
    visitor_run = store.start_run(backend, store.visitor("sitio.cl", "prueba"), model="m")
    store.finish_run(backend, visitor_run, "succeeded")
    route = backend.read_json(route_run.key.file("route.json"))
    baja = (tmp_path / "baja.html").as_uri()
    proposal = {
        "route": str(route_run.key), "instruction": route["instruction"], "start_url": route["start_url"],
        "profile": "first_time", "steps_count": 1, "reference_min_steps": 3, "final_node": node_key(baja, "Baja"),
        "steps": [_raw(1, "left_click", element, url=baja, title="Baja")],
    }

    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await adopt(browser, backend, route_run.key, proposal, visitor_run.key, print)
            finally:
                await browser.close()

    status = asyncio.run(main())
    return status, backend, route_run.key, visitor_run.key


def test_shorter_proposal_that_replays_becomes_a_new_guide_run(tmp_path):
    map_site(tmp_path, LONG, extra_routes=0)
    status, backend, previous, visitor_run = _propose(tmp_path, {"tag": "a", "text": "Ver más", "href": "baja.html"})
    adopted = store.latest_run(backend, previous.prefix)
    route = backend.read_json(adopted.file("route.json"))
    assert status == "promoted" and adopted != previous
    assert store.read_manifest(backend, adopted).inputs == (str(previous), str(visitor_run))
    assert route["status"] == "verified" and route["totals"]["min_steps"] == 1
    assert route["adopted_from"] == {"run": str(visitor_run), "profile": "first_time", "previous_min_steps": 3}
    assert route["steps"][0]["locators"][0] == {"by": "href", "value": "baja.html", "nth": 0}
    assert sorted(path.name for path in (tmp_path / "almacen" / str(adopted)).glob("step_*.png")) == [
        "step_00.png", "step_01.png"]
    assert "Adoptada del Visitante" in backend.read_text(adopted.file("route.md"))


def test_proposal_that_does_not_replay_stays_unverified(tmp_path, capsys):
    map_site(tmp_path, LONG, extra_routes=0)
    status, backend, previous, _ = _propose(tmp_path, {"tag": "a", "text": "No existe", "href": "otra.html"})
    assert status == "unverified" and "paso 1" in capsys.readouterr().out
    assert store.latest_run(backend, previous.prefix) == previous
