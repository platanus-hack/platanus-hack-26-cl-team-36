"""Pruebas del ciclo de un usuario con un motor falso (sin llamar a Claude)."""

import asyncio
from datetime import datetime

from playwright.async_api import async_playwright

from shared.browser.session import BrowserSession, connect_browser
from shared.browser.viewports import SCREENS

from visitor import report
from visitor.harness import SyntheticUser
from visitor.profiles import Profile
from visitor.turns import ActionRequest, AttemptEnded, Turn

DESKTOP = Profile("test_desktop", "Prueba", SCREENS["desktop"], "")


class ScriptedEngine:
    """Pide un clic sobre el enlace, espera un poco como si pensara, y declara que terminó."""

    name = "claude-code"
    model = "fake"

    def __init__(self, think_s: float = 0.3):
        self.think_s = think_s
        self.usage: dict = {}
        self.turns = [
            Turn(requests=[
                ActionRequest("1", "expectation", {"sentence": "Ir a la página dos."}, False),
                ActionRequest("2", "left_click", {"coordinate": [40, 35]}, True),
            ]),
            Turn(final=("done", "Listo.")),
        ]

    async def start(self, system_prompt, first_message, screenshot, log_dir):
        pass

    async def decide(self) -> Turn:
        await asyncio.sleep(self.think_s)
        if not self.turns:
            raise AttemptEnded("no_response")
        return self.turns.pop(0)

    async def respond(self, results, screenshot):
        pass

    async def close(self):
        pass


def _site(tmp_path):
    (tmp_path / "two.html").write_text("<title>Dos</title><h1>Página dos</h1>", encoding="utf-8")
    (tmp_path / "one.html").write_text(
        """<title>Uno</title>
        <a href="two.html" style="position:absolute;left:20px;top:20px;font-size:30px">Ir a dos</a>""",
        encoding="utf-8",
    )
    return (tmp_path / "one.html").as_uri()


def _attempt(tmp_path, record_video: bool):
    url = _site(tmp_path)

    async def scenario():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                user = SyntheticUser(ScriptedEngine(), browser, DESKTOP, url, "Ir a dos", tmp_path / "run", record_video)
                return await user.attempt()
            finally:
                await browser.close()

    return asyncio.run(scenario())


def test_step_timestamps_are_ordered_and_absolute(tmp_path):
    run = _attempt(tmp_path, record_video=False)
    assert run.end_reason == "done"
    assert len(run.steps) == 1
    step = run.steps[0]
    assert step.title == "Dos"

    started = datetime.fromisoformat(run.started_at)
    assert started.tzinfo is not None and run.start["at"] == run.started_at
    # el modelo "pensó" 0.3 s antes de decidir; la acción va después y la página se estabiliza al final
    assert 0.3 <= step.decided_s <= step.executed_s <= step.settled_s
    assert step.settled_s == step.seconds_since_start
    for seconds, iso in ((step.decided_s, step.decided_at), (step.executed_s, step.executed_at), (step.settled_s, step.settled_at)):
        moment = datetime.fromisoformat(iso)
        assert abs((moment - started).total_seconds() - seconds) < 0.01


def test_report_shows_clock_and_exact_video_second(tmp_path):
    run = _attempt(tmp_path, record_video=True)
    assert run.videos == ["video.webm"]
    data = run.to_dict()
    data["verdict"] = {"outcome": "success", "justification": "ok"}
    text = report.generate(
        {"url": "u", "instruction": "i", "task_id": None, "timestamp": "t", "engine": "claude-code",
         "user_model": "fake", "judge_model": "fake", "effort": "low"},
        {"criterion": "c", "checks": []},
        [data],
        {"nodes": [], "branches": [], "recommended_route": None},
    )
    step = run.steps[0]
    expected_second = int(run.video_offset_s + step.executed_s)
    row = next(line for line in text.splitlines() if line.startswith("| 1 |"))
    assert f"| {step.executed_at[11:19]} |" in row
    assert row.endswith(f" {expected_second // 60}:{expected_second % 60:02d} |")
    assert "**Inicio del intento:**" in text


def test_failure_closing_the_browser_keeps_the_result(tmp_path, monkeypatch):
    async def broken_save_videos(self, run_dir, incidents):
        raise OSError("disco lleno")

    monkeypatch.setattr(BrowserSession, "save_videos", broken_save_videos)
    run = _attempt(tmp_path, record_video=True)
    assert run.end_reason == "done"
    assert any("disco lleno" in incident for incident in run.incidents)
    saved = (tmp_path / "run" / "run.json").read_text(encoding="utf-8")
    assert '"end_reason": "done"' in saved and "disco lleno" in saved
