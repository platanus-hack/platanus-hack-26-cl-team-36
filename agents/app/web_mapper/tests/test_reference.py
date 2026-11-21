"""Exploración, destilación, verificación y minimización con un modelo guionizado en lugar de Claude."""

import asyncio
import json

from playwright.async_api import async_playwright

from browser import connect_browser
from mapper.decider import Decision
from mapper.reference import Mapping, map_reference
from tests.conftest import DESKTOP

QUOTE = "Para dar de baja llama al 103."


class ScriptedDecider:
    """Cada paso del guion elige su acción por el nombre del elemento en la vista que recibe."""

    def __init__(self, script: list[tuple[str, str | None, dict]]):
        self.script = list(script)
        self.prompts: list[str] = []
        self.usage = {"input_tokens": 0}
        self.cost_usd = 0.0

    async def decide(self, text: str, screenshot: bytes) -> Decision:
        self.prompts.append(text)
        action, name, extra = self.script.pop(0)
        ref = None
        if name:
            line = next(line for line in text.splitlines() if f"«{name}»" in line and line.startswith("e"))
            ref = line.split(" · ")[0]
        return Decision(reason="guion", action=action, ref=ref, **extra)


def _map(site, tmp_path, script):
    decider = ScriptedDecider(script)
    mapping = Mapping("prueba", (site / "index.html").as_uri(), "Encuentra cómo dar de baja", "desktop", DESKTOP,
                      "guion", "low", tmp_path / "out")

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
    assert document["exploration"]["steps"] == 6 and document["exploration"]["turns"] == 9
    assert document["evaluator_profiles"] == ["first_time", "hurried"]
    saved = json.loads((out_dir / "route.json").read_text(encoding="utf-8"))
    assert saved["steps"][2]["node_after"].endswith("ayuda.html | Ayuda")
    assert sorted(path.name for path in out_dir.glob("*.png")) == ["step_00.png", "step_01.png", "step_02.png", "step_03.png"]
    assert "**verified**" in (out_dir / "route.md").read_text(encoding="utf-8")


def test_unanswered_exploration_is_not_found(site, tmp_path):
    document, _, out_dir = _map(site, tmp_path, [("give_up", None, {"text": "No está."})])
    assert document["status"] == "not_found" and document["steps"] == []
    assert document["exploration"]["end_reason"] == "gave_up" and document["verification"] is None
    assert (out_dir / "step_00.png").is_file()
