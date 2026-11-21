"""Reglas sin modelo del catálogo: validación de lo que propone el modelo, prominencia, barreras y complejidad."""

import re

from route_tree import normalize_url

from mapper.crawl import Outline
from mapper.goals import INTENTS, LEVELS, Goal
from mapper.outline import Link

_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_SCREENS_FOR_SECONDARY = 3   # NN/g: el 81 % del tiempo de lectura ocurre en las tres primeras pantallas


def id_prefix(host: str) -> str:
    """Primer nombre del host sin www, como en los ids de agents/tasks/ (www.wom.cl → wom)."""
    return host.lower().removeprefix("www.").split(".")[0]


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def validate(raw_goals: list[dict], outline: Outline) -> tuple[list[Goal], list[str]]:
    """Convierte lo que propuso el modelo en objetivos válidos. Devuelve también qué se descartó o corrigió y por qué."""
    prefix = id_prefix(outline.host)
    pages = {normalize_url(page.url): page.url for page in outline.pages}
    start_hrefs = {link.href for link in outline.pages[0].links}
    goals: list[Goal] = []
    issues: list[str] = []
    for raw in raw_goals:
        goal_id = _slug(raw.get("id") or "")
        if goal_id and not goal_id.startswith(f"{prefix}-"):
            issues.append(f"{goal_id}: id sin el prefijo «{prefix}-»; se agrega")
            goal_id = f"{prefix}-{goal_id}"
        if not _ID.match(goal_id) or any(goal.id == goal_id for goal in goals):
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
        goals.append(Goal(
            id=goal_id, host=outline.host, start_url=outline.start_url, description=raw["description"].strip(),
            expected_answer=None, level=raw["level"], parent=raw.get("parent"), intent=raw["intent"],
            evidence=list(dict.fromkeys(evidence)), entry=entry,
        ))
    issues += _repair_parents(goals)
    return goals, issues


def _repair_parents(goals: list[Goal]) -> list[str]:
    summaries = {goal.id for goal in goals if goal.level == "summary"}
    issues = []
    for goal in goals:
        if goal.parent is not None and (goal.parent not in summaries or goal.parent == goal.id):
            issues.append(f"{goal.id}: el padre {goal.parent} no es un summary del catálogo; queda sin padre")
            goal.parent = None
    return issues


def link_prominence(link: Link, viewport_height: int) -> str:
    """`primary`: en la primera pantalla. `secondary`: en un menú del encabezado o a tres pantallas o menos. Si no, `buried`."""
    if link.visible and link.top < viewport_height:
        return "primary"
    if (not link.visible and link.zone == "nav") or (link.visible and link.top < _SCREENS_FOR_SECONDARY * viewport_height):
        return "secondary"
    return "buried"


def prominence(goal: Goal, outline: Outline, viewport_height: int) -> str:
    """Por la aparición más destacada de su entrada en la página inicial; sin entrada, `buried`."""
    found = [link_prominence(link, viewport_height) for link in outline.pages[0].links if link.href == goal.entry]
    for level in ("primary", "secondary"):
        if level in found:
            return level
    return "buried"


def gates(goal: Goal, outline: Outline) -> list[str]:
    """Las señales de barrera de sus páginas de evidencia (la inicial solo si es la única).

    Los datos personales y `side_effect` solo cuentan si es `transact`: leer o llegar a una página no exige enviar el
    formulario que tenga.
    """
    pages = [page for page in outline.pages if page.url in goal.evidence]
    own_pages = [page for page in pages if page.url != outline.pages[0].url] or pages
    found = {gate for page in own_pages for gate in page.gates}
    if goal.intent == "transact":
        found.add("side_effect")
    else:
        found.discard("personal_data")
    return [gate for gate in ("login", "personal_data", "side_effect", "bot_check") if gate in found]


def complexity(steps: int | None) -> str | None:
    """Bandas de Online-Mind2Web sobre los pasos de la ruta de referencia: ≤5, 6–10, ≥11."""
    if steps is None:
        return None
    return "easy" if steps <= 5 else ("medium" if steps <= 10 else "hard")


def classify(raw_goals: list[dict], outline: Outline, viewport_height: int) -> tuple[list[Goal], list[str]]:
    """Valida lo que propuso el modelo y completa `prominence` y `gates`."""
    goals, issues = validate(raw_goals, outline)
    for goal in goals:
        goal.prominence = prominence(goal, outline, viewport_height)
        goal.gates = gates(goal, outline)
    return goals, issues
