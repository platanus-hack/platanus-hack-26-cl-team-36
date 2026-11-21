from shared import store
from shared.nodes.urls import node_key

from visitor.comparison import compare_batch, report_section
from visitor.proposal import proposals

URL, INSTRUCTION = "https://s.cl/", "Encuentra el horario."
HOME, HELP, HOURS = ("https://s.cl/", "Inicio"), ("https://s.cl/ayuda", "Ayuda"), ("https://s.cl/horario", "Horario")
ROUTE = {
    "status": "verified", "start_url": URL, "instruction": INSTRUCTION, "viewport": "desktop",
    "totals": {"min_steps": 3, "distinct_pages": 3}, "nodes": [node_key(*HOME), node_key(*HELP), node_key(*HOURS)],
    "final_node": node_key(*HOURS),
}


def _run(pages, profile="first_time", outcome="success"):
    steps = [{"number": number, "action": "left_click", "action_input": {"coordinate": [10, 10]},
              "description": "clic en (10, 10)", "element": {"tag": "a", "text": title, "href": url},
              "url_before": "", "title_before": "", "url": url, "title": title, "signals": []}
             for number, (url, title) in enumerate(pages, 1)]
    return {"profile": profile, "start_url": URL, "instruction": INSTRUCTION, "start": {"url": HOME[0], "title": HOME[1]},
            "steps": steps, "verdict": {"outcome": outcome}}


DESKTOP_RUN = store.guide("s.cl", "horario", "desktop").run("2026-01-01T00-00-00Z")
MOBILE_RUN = store.guide("s.cl", "horario", "mobile").run("2026-01-01T00-00-00Z")


def _propose(runs, references=None):
    references = references or {"desktop": (DESKTOP_RUN, ROUTE)}
    comparison = compare_batch(references, runs)
    return comparison, proposals(runs, comparison, references)


def test_the_shortest_run_that_beats_the_reference_is_proposed():
    comparison, found = _propose([_run([HELP, HOURS]), _run([HOURS], "hurried"), _run([HOURS, HOURS])])
    [document] = found
    assert (document["route"], document["profile"], document["steps_count"], document["reference_min_steps"]) == (
        str(DESKTOP_RUN), "hurried", 1, 3)
    assert document["nodes"] == [node_key(*HOME), node_key(*HOURS)] and document["final_node"] == node_key(*HOURS)
    assert document["steps"][0]["element"] == {"tag": "a", "text": "Horario", "href": HOURS[0]}
    comparison["proposals"] = [document["route"]]
    assert f"menos pasos que la ruta `{DESKTOP_RUN}`" in "\n".join(report_section(comparison, {}))


def test_no_proposal_without_a_successful_shorter_run():
    assert _propose([_run([HELP, HOURS, HOURS]), _run([HOURS], "hurried", "failed")])[1] == []


def test_each_beaten_route_gets_its_own_proposal():
    references = {"desktop": (DESKTOP_RUN, ROUTE), "mobile": (MOBILE_RUN, {**ROUTE, "viewport": "mobile"})}
    found = _propose([_run([HOURS]), _run([HOURS], "mobile")], references)[1]
    assert [(item["route"], item["profile"]) for item in found] == [(str(DESKTOP_RUN), "first_time"),
                                                                    (str(MOBILE_RUN), "mobile")]
