"""trace.json de la Guía: la exploración en curso paso a paso y, al terminar, la ruta de route.json."""

import asyncio

from shared import store

from guide.explore import Exploration
from guide.output import step_record


class GuideTrace:
    """Con `--shorter` refleja la exploración en curso: al empezar otra, vuelve a `step_00.png` y sin pasos."""

    def __init__(self, live: store.LiveTrace):
        self.live = live
        self.start: dict = {}
        self.steps: list[dict] = []
        self.captures: set[str] = set()   # las capturas publicadas al momento

    async def explored(self, exploration: Exploration) -> None:
        """Publica lo nuevo de `exploration`: su inicio, o su último paso."""
        await asyncio.to_thread(self._explored, exploration)

    def _explored(self, exploration: Exploration) -> None:
        number = len(exploration.steps)
        png = exploration.steps[-1].screenshot if number else exploration.start_screenshot
        name = f"step_{number:02d}.png"
        if number == 0:
            self.start = {"url": exploration.start_url, "title": exploration.start_title,
                          "screenshot": name if png else None}
            self.steps = []
        else:
            self.steps.append(step_record(number, exploration.steps[-1]))
        if png:
            (self.live.directory / name).write_bytes(png)
            self.captures.add(name)
        self.live.write("running", self.start, self.steps, publish=[name] if png else [])

    def route(self, document: dict) -> None:
        """Pasa a la ruta de route.json y quita las capturas de la exploración que la ruta no usa."""
        start = document["start"]
        self.start = {"url": start["url"], "title": start["title"], "screenshot": start["screenshot"]}
        self.steps = document["steps"]
        used = {start["screenshot"], *(step["screenshot"] for step in self.steps)}
        self.live.discard(sorted(self.captures - used))

    def finish(self, status: store.Status) -> None:
        """El estado final queda en la carpeta de trabajo; lo sube `finish_run`."""
        if self.start:
            self.live.write(status, self.start, self.steps)
