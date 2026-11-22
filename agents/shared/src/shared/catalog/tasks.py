"""Tareas escritas a mano: cada una es un objetivo de su host, en `agents/tasks/<host>/<goal>.json`."""

import json
from dataclasses import dataclass
from pathlib import Path

from shared.catalog.goal import is_free_goal_id
from shared.store.keys import InvalidKey, validate_goal, validate_host

TASKS_DIR = Path(__file__).resolve().parents[4] / "tasks"


@dataclass(frozen=True)
class Task:
    id: str
    host: str
    start_url: str
    description: str
    expected_answer: str | None = None
    # Para los exploradores con nivel de conocimiento del Visitante (agents/app/visitor/visitor/conocimiento.py): la
    # tarea con palabras de todos los días, los nombres oficiales que `sin_contexto` no conoce y lo que sabe del tema
    # `conoce_tema`. Opcionales: una tarea sin ellos sigue siendo válida.
    description_sin_contexto: str | None = None
    terminos_oficiales: tuple[str, ...] = ()
    conocimiento_del_tema: str | None = None

    def __post_init__(self) -> None:
        # En el JSON es una lista; se guarda como tupla para que la tarea siga siendo inmutable.
        object.__setattr__(self, "terminos_oficiales", tuple(self.terminos_oficiales or ()))

    @property
    def ref(self) -> str:
        return f"{self.host}/{self.id}"


def available_tasks() -> list[str]:
    """Las tareas como `<host>/<goal>`."""
    return sorted(f"{path.parent.name}/{path.stem}" for path in TASKS_DIR.glob("*/*.json") if not is_free_goal_id(path.stem))


def task_ids(host: str) -> set[str]:
    return {path.stem for path in (TASKS_DIR / host).glob("*.json") if not is_free_goal_id(path.stem)}


def load_task(ref: str) -> Task | None:
    """La tarea `<host>/<goal>`, o None si no existe."""
    host, _, goal = ref.partition("/")
    if is_free_goal_id(goal):
        return None
    try:
        validate_host(host)
        validate_goal(goal)
    except InvalidKey:
        return None
    path = TASKS_DIR / host / f"{goal}.json"
    return Task(**json.loads(path.read_text(encoding="utf-8"))) if path.is_file() else None
