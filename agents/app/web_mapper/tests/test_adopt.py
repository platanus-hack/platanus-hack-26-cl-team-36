"""Adopción de una ruta propuesta por el evaluador, sobre el sitio local de la búsqueda de rutas más cortas."""

import asyncio
import json

import pytest
from playwright.async_api import async_playwright

from browser import connect_browser
from mapper import config
from mapper.adopt import Unresolvable, adopt, derive_steps
from route_tree import node_key
from tests.conftest import DESKTOP
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
    folder = tmp_path / "out"
    route = json.loads((folder / "route.json").read_text(encoding="utf-8"))
    baja = (tmp_path / "baja.html").as_uri()
    (folder / "proposed.json").write_text(json.dumps({
        "status": "proposed", "instruction": route["instruction"], "start_url": route["start_url"], "batch": "b",
        "profile": "first_time", "steps_count": 1, "reference_min_steps": 3, "final_node": node_key(baja, "Baja"),
        "steps": [_raw(1, "left_click", element, url=baja, title="Baja")],
    }), encoding="utf-8")

    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                return await adopt(browser, folder, print)
            finally:
                await browser.close()

    status = asyncio.run(main())
    return status, json.loads((folder / "route.json").read_text(encoding="utf-8")), json.loads(
        (folder / "proposed.json").read_text(encoding="utf-8"))


def test_shorter_proposal_that_replays_becomes_the_reference(tmp_path, monkeypatch):
    monkeypatch.setitem(config.VIEWPORTS, "desktop", DESKTOP)
    map_site(tmp_path, LONG, extra_routes=0)
    status, route, proposal = _propose(tmp_path, {"tag": "a", "text": "Ver más", "href": "baja.html"})
    assert status == "promoted" and proposal["status"] == "promoted"
    assert route["status"] == "verified" and route["totals"]["min_steps"] == 1
    assert route["adopted_from"] == {"batch": "b", "profile": "first_time", "previous_min_steps": 3}
    assert route["steps"][0]["locators"][0] == {"by": "href", "value": "baja.html", "nth": 0}
    assert sorted(path.name for path in (tmp_path / "out").glob("step_*.png")) == ["step_00.png", "step_01.png"]
    assert "Adoptada del evaluador" in (tmp_path / "out" / "route.md").read_text(encoding="utf-8")


def test_proposal_that_does_not_replay_stays_unverified(tmp_path, monkeypatch):
    monkeypatch.setitem(config.VIEWPORTS, "desktop", DESKTOP)
    map_site(tmp_path, LONG, extra_routes=0)
    status, route, proposal = _propose(tmp_path, {"tag": "a", "text": "No existe", "href": "otra.html"})
    assert status == "unverified" and "paso 1" in proposal["reason"]
    assert route["totals"]["min_steps"] == 3
