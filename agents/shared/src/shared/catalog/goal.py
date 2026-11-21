"""Un objetivo del catálogo, con el esquema de docs/agents/niveles-de-tarea.md (sección 3)."""

from dataclasses import dataclass, field

LEVELS = ("summary", "user_goal", "subfunction")
INTENTS = ("find_info", "reach_page", "transact")
PROMINENCE_ORDER = ("buried", "secondary", "primary")
EXCLUDING_GATES = ("login", "personal_data", "bot_check")  # el Visitante no puede intentarlos

# La Guía no envía formularios: en un objetivo `transact` la ruta llega hasta el paso anterior al envío.
_SUFFIXES = {
    "transact": " Llega hasta el último paso antes de enviar, pagar o confirmar, sin hacerlo, y termina citando el texto"
                " de esa pantalla.",
    "reach_page": " Termina en esa página y cita su título o encabezado principal.",
}


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
    # Lo que leen la Guía y el Visitante sin repetir estas reglas: la tarea que reciben y por qué no se intenta.
    instruction: str = ""
    exclusion: str | None = None


def instruction(goal: Goal) -> str:
    return goal.description + _SUFFIXES.get(goal.intent, "")


def exclusion(goal: Goal) -> str | None:
    """Por qué el Visitante no lo intenta (nivel o barrera), o None si lo intenta."""
    if goal.level != "user_goal":
        return f"nivel {goal.level}"
    blocking = [gate for gate in EXCLUDING_GATES if gate in goal.gates]
    return f"barrera {', '.join(blocking)}" if blocking else None


def fill_evaluation(goal: Goal) -> None:
    goal.instruction = instruction(goal)
    goal.exclusion = exclusion(goal)


def routable(goals: list[Goal], limit: int | None) -> list[Goal]:
    """Los que el Visitante puede intentar, los más escondidos primero y luego por id; `limit` None es todos."""
    candidates = [goal for goal in goals if exclusion(goal) is None]
    candidates.sort(key=lambda goal: (PROMINENCE_ORDER.index(goal.prominence), goal.id))
    return candidates[:limit]
