"""Reglas sin modelo del catálogo: barreras de cada página, validación, prominencia y barreras de cada objetivo."""

import re

from shared.catalog.goal import INTENTS, LEVELS, Goal, fill_evaluation
from shared.catalog.outline import Field, PageOutline, SiteOutline
from shared.catalog.prominence import prominence
from shared.nodes.urls import normalize_url

from cataloger import config

_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

_LOGIN_AUTOCOMPLETE = {"username", "current-password", "new-password", "one-time-code"}
_PERSONAL_AUTOCOMPLETE = re.compile(
    r"^(name|given-name|family-name|additional-name|email|tel(-.*)?|street-address|address-line\d|address-level\d"
    r"|postal-code|country(-name)?|bday(-.*)?|cc-.*)$"
)
# Para formularios sin autocomplete.
_PERSONAL_LABEL = re.compile(
    r"(?<![a-z])(rut|nombres?(?![a-z])(?![\s_-]+del?(?![a-z]))|apellidos?|tel[eé]fono|celular|correo|e-?mail"
    r"|direcci[oó]n)(?![a-z])",
    re.IGNORECASE,
)
_SEARCH_LABEL = re.compile(r"buscar|b[uú]squeda|search", re.IGNORECASE)


def _asks_personal_data(item: Field) -> bool:
    if item.type in ("search", "select") or _SEARCH_LABEL.search(item.label):
        return False
    return bool(_PERSONAL_AUTOCOMPLETE.match(item.autocomplete) or _PERSONAL_LABEL.search(item.label))


def page_gates(page: PageOutline) -> list[str]:
    """Barreras de la página según sus formularios de contenido; los del encabezado y el pie se repiten en todo el sitio."""
    fields = [item for form in page.forms if form.zone == "main" for item in form.fields]
    gates = []
    if any(item.type == "password" or item.autocomplete in _LOGIN_AUTOCOMPLETE for item in fields):
        gates.append("login")
    if any(_asks_personal_data(item) for item in fields):
        gates.append("personal_data")
    if page.captcha:
        gates.append("bot_check")
    return gates


def id_prefix(host: str) -> str:
    """Primer nombre del host sin www, como en los ids de agents/tasks/ (www.wom.cl → wom)."""
    return host.lower().removeprefix("www.").split(".")[0]


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def _goal_id(raw_id: str | None, prefix: str) -> tuple[str, str | None]:
    """El id en kebab-case con el prefijo del sitio, y la corrección si hubo que agregarlo."""
    goal_id = _slug(raw_id or "")
    if goal_id and not goal_id.startswith(f"{prefix}-"):
        return f"{prefix}-{goal_id}", f"{goal_id}: id sin el prefijo «{prefix}-»; se agrega"
    return goal_id, None


def _task_ids() -> set[str]:
    return {path.stem for path in config.TASKS_DIR.glob("*.json")}


def _free_id(goal_id: str, taken: set[str]) -> str:
    number = 2
    while f"{goal_id}-{number}" in taken:
        number += 1
    return f"{goal_id}-{number}"


def validate(raw_goals: list[dict], outline: SiteOutline, reserved: set[str] | None = None) -> tuple[list[Goal], list[str]]:
    """Convierte lo que propuso el modelo en objetivos válidos. Devuelve también qué se descartó o corrigió y por qué.

    `reserved`: ids que no se pueden usar; por defecto, los de agents/tasks/.
    """
    prefix = id_prefix(outline.host)
    reserved = _task_ids() if reserved is None else reserved
    pages = {normalize_url(page.url): page.url for page in outline.pages}
    start_hrefs = {link.href for link in outline.pages[0].links}
    goals: list[Goal] = []
    issues: list[str] = []
    proposed: set[str] = set()
    for raw in raw_goals:
        goal_id, issue = _goal_id(raw.get("id"), prefix)
        issues += [issue] if issue else []
        if not _ID.match(goal_id) or goal_id in proposed:
            issues.append(f"{raw.get('id')!r}: id vacío o repetido; se descarta")
            continue
        if raw.get("level") not in LEVELS or raw.get("intent") not in INTENTS or not (raw.get("description") or "").strip():
            issues.append(f"{goal_id}: nivel, intención o descripción inválidos; se descarta")
            continue
        evidence = [pages[normalize_url(url)] for url in raw.get("evidence") or [] if normalize_url(url) in pages]
        if not evidence:
            issues.append(f"{goal_id}: ninguna URL de evidencia está en el esquema; se descarta")
            continue
        entry = raw.get("entry")
        if entry is not None and entry not in start_hrefs:
            issues.append(f"{goal_id}: la entrada {entry} no es un enlace de la página inicial; queda sin entrada")
            entry = None
        proposed.add(goal_id)
        parent = _goal_id(raw.get("parent"), prefix)[0] or None
        goals.append(Goal(
            id=goal_id, host=outline.host, start_url=outline.start_url,
            description=raw["description"].strip(), expected_answer=None, level=raw["level"], parent=parent,
            intent=raw["intent"], evidence=list(dict.fromkeys(evidence)), entry=entry,
            submits_form=bool(raw.get("submits_form")),
        ))
    issues += _rename_reserved(goals, reserved)
    issues += _repair_parents(goals)
    return goals, issues


def _rename_reserved(goals: list[Goal], reserved: set[str]) -> list[str]:
    """Un id de agents/tasks/ recibe un sufijo numérico: la ruta de un objetivo se escribe en la carpeta de su id."""
    taken = reserved | {goal.id for goal in goals}
    renamed: dict[str, str] = {}
    for goal in goals:
        if goal.id in reserved:
            renamed[goal.id] = _free_id(goal.id, taken)
            taken.add(renamed[goal.id])
            goal.id = renamed[goal.id]
    for goal in goals:
        goal.parent = renamed.get(goal.parent, goal.parent)
    return [f"{old}: ya es una tarea de agents/tasks/; queda {new}" for old, new in renamed.items()]


def _repair_parents(goals: list[Goal]) -> list[str]:
    summaries = {goal.id for goal in goals if goal.level == "summary"}
    issues = []
    for goal in goals:
        if goal.parent is None:
            continue
        if goal.level == "summary":
            issues.append(f"{goal.id}: un summary no tiene padre; queda sin padre")
            goal.parent = None
        elif goal.parent not in summaries:
            issues.append(f"{goal.id}: el padre {goal.parent} no es un summary del catálogo; queda sin padre")
            goal.parent = None
    return issues


def gates(goal: Goal, outline: SiteOutline) -> list[str]:
    """Las señales de barrera de sus páginas de evidencia (la inicial solo si es la única).

    `personal_data` solo si el objetivo envía un formulario; `side_effect` si es `transact`.
    """
    pages = [page for page in outline.pages if page.url in goal.evidence]
    own_pages = [page for page in pages if page.url != outline.pages[0].url] or pages
    found = {gate for page in own_pages for gate in page.gates}
    if not (goal.submits_form or goal.intent == "transact"):
        found.discard("personal_data")
    if goal.intent == "transact":
        found.add("side_effect")
    return [gate for gate in ("login", "personal_data", "side_effect", "bot_check") if gate in found]


def classify(raw_goals: list[dict], outline: SiteOutline, viewport_height: int) -> tuple[list[Goal], list[str]]:
    """Valida lo que propuso el modelo y completa `prominence`, `gates`, `instruction` y `exclusion`."""
    goals, issues = validate(raw_goals, outline)
    for goal in goals:
        goal.prominence = prominence(goal, outline, viewport_height)
        goal.gates = gates(goal, outline)
        fill_evaluation(goal)
    return goals, issues
