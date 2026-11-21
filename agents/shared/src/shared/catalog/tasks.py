"""Tareas escritas a mano: cada una es un objetivo de su host, en `agents/tasks/<host>/<goal>.json`."""

import json
from dataclasses import dataclass
from pathlib import Path

from shared.store.keys import InvalidKey, validate_goal, validate_host

TASKS_DIR = Path(__file__).resolve().parents[4] / "tasks"


@dataclass(frozen=True)
class Task:
    id: str
    host: str
    start_url: str
    description: str
    expected_answer: str | None = None

    @property
    def ref(self) -> str:
        return f"{self.host}/{self.id}"


def available_tasks() -> list[str]:
    """Las tareas como `<host>/<goal>`."""
    return sorted(f"{path.parent.name}/{path.stem}" for path in TASKS_DIR.glob("*/*.json"))


def task_ids(host: str) -> set[str]:
    return {path.stem for path in (TASKS_DIR / host).glob("*.json")}


def load_task(ref: str) -> Task | None:
    """La tarea `<host>/<goal>`, o None si no existe."""
    host, _, goal = ref.partition("/")
    try:
        validate_host(host)
        validate_goal(goal)
    except InvalidKey:
        return None
    path = TASKS_DIR / host / f"{goal}.json"
    return Task(**json.loads(path.read_text(encoding="utf-8"))) if path.is_file() else None
