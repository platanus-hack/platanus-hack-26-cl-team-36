"""Catálogo sin Claude: validación de lo que propone el modelo, reglas deterministas y selección de rutas."""

import asyncio

from mapper import config
from mapper.catalog import propose_goals, render_outline
from mapper.crawl import Outline
from mapper.goal_routes import instruction, route_summary
from mapper.goal_rules import complexity, gates, id_prefix, link_prominence, prominence, validate
from mapper.goals import Goal, routable
from mapper.goals_output import goals_markdown
from mapper.outline import Link, PageOutline

START = "https://www.sitio.cl/"
HELP = "https://www.sitio.cl/ayuda/"
LOGIN = "https://www.sitio.cl/ingreso/"
FORM = "https://www.sitio.cl/te-llamamos/"
HEIGHT = 768


def _page(url: str, links: list[Link], gates: list[str] | None = None) -> PageOutline:
    return PageOutline(url, url, 0, [], links, [], [], False, gates or [])


OUTLINE = Outline(START, "www.sitio.cl", "1024x768", [
    _page(START, [
        Link("Ayuda", HELP, "footer", True, 3000),
        Link("Ayuda", HELP, "nav", False, 0),
        Link("Ingresar", LOGIN, "nav", True, 20),
    ]),
    _page(HELP, [Link("Ingresar", LOGIN, "nav", True, 20), Link("Baja", HELP + "baja", "main", True, 400)]),
    _page(LOGIN, [], ["login"]),
    _page(FORM, [], ["personal_data"]),
], [])


def _raw(goal_id: str, **changes) -> dict:
    return {"id": goal_id, "description": "Encuentra algo.", "level": "user_goal", "parent": None,
            "intent": "find_info", "evidence": [HELP], "entry": HELP, **changes}


def _goal(goal_id: str, **changes) -> Goal:
    fields = {"id": goal_id, "host": "www.sitio.cl", "start_url": START, "description": "x", "expected_answer": None,
              "level": "user_goal", "parent": None, "intent": "find_info", "evidence": [HELP], "entry": None}
    return Goal(**{**fields, **changes})


def test_validation_repairs_or_drops_invalid_goals_and_says_why():
    goals, issues = validate([
        _raw("sitio-gestionar", level="summary", entry=None),
        _raw("baja", parent="sitio-gestionar"),
        _raw("sitio-baja"),
        _raw("sitio-raro", level="epic"),
        _raw("sitio-inventado", evidence=["https://www.sitio.cl/no-existe/"]),
        _raw("sitio-entrada", entry="https://www.sitio.cl/oculto/", evidence=["https://sitio.cl/ayuda"]),
        _raw("sitio-huerfano", parent="sitio-baja"),
    ], OUTLINE)
    assert [goal.id for goal in goals] == ["sitio-gestionar", "sitio-baja", "sitio-entrada", "sitio-huerfano"]
    assert goals[1].parent == "sitio-gestionar"
    assert goals[2].entry is None and goals[2].evidence == [HELP]
    assert goals[3].parent is None
    assert len(issues) == 6
    assert all(any(goal_id in issue for issue in issues)
               for goal_id in ("baja", "sitio-raro", "sitio-inventado", "sitio-entrada", "sitio-huerfano"))


def test_link_prominence_cut_offs():
    assert link_prominence(Link("a", START, "main", True, 700), HEIGHT) == "primary"
    assert link_prominence(Link("a", START, "main", True, 2000), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "nav", False, 0), HEIGHT) == "secondary"
    assert link_prominence(Link("a", START, "main", True, 2400), HEIGHT) == "buried"
    assert link_prominence(Link("a", START, "footer", False, 0), HEIGHT) == "buried"


def test_goal_prominence_uses_the_most_prominent_occurrence_of_its_entry():
    assert prominence(_goal("sitio-a", entry=HELP), OUTLINE, HEIGHT) == "secondary"
    assert prominence(_goal("sitio-b", entry=LOGIN), OUTLINE, HEIGHT) == "primary"
    assert prominence(_goal("sitio-c"), OUTLINE, HEIGHT) == "buried"


def test_gates_come_from_own_evidence_pages_and_transact():
    assert gates(_goal("sitio-a", evidence=[START, LOGIN]), OUTLINE) == ["login"]
    assert gates(_goal("sitio-b", evidence=[START, HELP], intent="transact"), OUTLINE) == ["side_effect"]
    assert gates(_goal("sitio-c", evidence=[HELP]), OUTLINE) == []
    assert gates(_goal("sitio-d", evidence=[FORM]), OUTLINE) == []
    assert gates(_goal("sitio-e", evidence=[FORM], intent="transact"), OUTLINE) == ["personal_data", "side_effect"]


def test_complexity_bands():
    assert [complexity(steps) for steps in (None, 5, 6, 10, 11)] == [None, "easy", "medium", "medium", "hard"]


def test_routable_order_buried_first_then_id_without_blocking_gates():
    goals = [
        _goal("sitio-z", prominence="buried"),
        _goal("sitio-a", prominence="primary"),
        _goal("sitio-b", prominence="buried"),
        _goal("sitio-m", prominence="secondary", gates=["side_effect"]),
        _goal("sitio-login", prominence="buried", gates=["login"]),
        _goal("sitio-grupo", prominence="buried", level="summary"),
        _goal("sitio-buscar", prominence="buried", level="subfunction"),
    ]
    assert [goal.id for goal in routable(goals, 10)] == ["sitio-b", "sitio-z", "sitio-m", "sitio-a"]
    assert [goal.id for goal in routable(goals, 2)] == ["sitio-b", "sitio-z"]


def test_outline_text_lists_each_link_once_and_the_page_gates():
    text = render_outline(OUTLINE)
    assert text.count(f"Ingresar → {LOGIN}") == 1 and "Barreras: login" in text
    assert f"PÁGINA 2 (profundidad 0): «{HELP}» {HELP}" in text


def test_catalog_with_a_scripted_model():
    class ScriptedCaller:
        async def ask(self, system_prompt, schema, text, image=None):
            assert '"sitio-"' in system_prompt and "PÁGINA 1" in text
            return {"goals": [_raw("sitio-baja", intent="transact"), _raw("sitio-baja")]}

    raw = asyncio.run(propose_goals(ScriptedCaller(), OUTLINE, id_prefix(OUTLINE.host)))
    goals, issues = validate(raw, OUTLINE)
    assert [goal.intent for goal in goals] == ["transact"] and "repetido" in issues[0]


def test_markdown_groups_goals_under_their_summary():
    goals = [_goal("sitio-grupo", level="summary", description="Gestiona tu servicio"),
             _goal("sitio-baja", parent="sitio-grupo", gates=["side_effect"]), _goal("sitio-suelto")]
    markdown = goals_markdown({"host": "www.sitio.cl", "pages": 3, "model": "m", "catalog_cost_usd": 0.1}, goals, ["x"])
    grouped, loose = markdown.split("## Sin grupo")
    assert "Gestiona tu servicio (`sitio-grupo`)" in grouped and "`sitio-baja`" in grouped and "side_effect" in grouped
    assert "`sitio-suelto`" in loose and "- x" in loose


def test_transact_routes_stop_before_submitting_and_route_summary_shape():
    assert instruction(_goal("sitio-a")) == "x"
    assert "sin hacerlo" in instruction(_goal("sitio-b", intent="transact"))
    document = {"status": "verified", "totals": {"min_steps": 6, "distinct_pages": 3},
                "nodes": ["a", "b", "c"], "final_node": "c"}
    assert route_summary(document, config.RUNS_DIR / "x" / "route.json") == {
        "status": "verified", "steps": 6, "pages": 3, "nodes": ["a", "b", "c"], "key_nodes": ["c"],
        "route": ".runs/x/route.json",
    }
