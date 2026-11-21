"""Un objetivo del catálogo, con el esquema de docs/agents/niveles-de-tarea.md (sección 3)."""

from dataclasses import dataclass, field

LEVELS = ("summary", "user_goal", "subfunction")
INTENTS = ("find_info", "reach_page", "transact")
PROMINENCE_ORDER = ("buried", "secondary", "primary")
EXCLUDING_GATES = {"login", "personal_data", "bot_check"}  # el evaluador no puede intentarlos


@dataclass
class Goal:
    # Los cinco primeros son la forma de una tarea de agents/tasks/: un objetivo se promueve copiándolo.
    id: str
    host: str
    start_url: str
    description: str
    expected_answer: str | None
    level: str
    parent: str | None
    intent: str
    evidence: list[str]       # URLs del esquema donde aparece
    entry: str | None         # href de la página inicial que lleva hacia él
    submits_form: bool = False  # no se cumple sin llenar y enviar un formulario
    prominence: str = "buried"
    gates: list[str] = field(default_factory=list)
    complexity: str | None = None
    reference_route: dict | None = None


def routable(goals: list[Goal], limit: int) -> list[Goal]:
    """Los `user_goal` que el evaluador puede intentar, los más escondidos primero y luego por id."""
    candidates = [goal for goal in goals if goal.level == "user_goal" and not EXCLUDING_GATES & set(goal.gates)]
    candidates.sort(key=lambda goal: (PROMINENCE_ORDER.index(goal.prominence), goal.id))
    return candidates[:limit]
