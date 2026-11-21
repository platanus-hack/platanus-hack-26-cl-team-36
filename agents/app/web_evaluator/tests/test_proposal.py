import json

from proposal import write_proposals
from reference import compare_batch, report_section
from route_tree import node_key

URL, INSTRUCTION = "https://s.cl/", "Encuentra el horario."
HOME, HELP, HOURS = ("https://s.cl/", "Inicio"), ("https://s.cl/ayuda", "Ayuda"), ("https://s.cl/horario", "Horario")
ROUTE = {
    "status": "verified", "start_url": URL, "instruction": INSTRUCTION, "evaluator_profiles": ["first_time", "hurried"],
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


def _setup(tmp_path):
    folder = tmp_path / "reference" / "desktop"
    folder.mkdir(parents=True)
    (folder / "route.json").write_text(json.dumps(ROUTE), encoding="utf-8")
    return folder / "proposed.json"


def _propose(tmp_path, runs, batch="2026-01-01_00-00-00"):
    comparison = compare_batch(tmp_path, URL, INSTRUCTION, runs)
    return comparison, write_proposals(tmp_path, tmp_path / batch, runs, comparison)


def test_the_shortest_run_that_beats_the_reference_is_proposed(tmp_path):
    path = _setup(tmp_path)
    comparison, written = _propose(tmp_path, [_run([HELP, HOURS]), _run([HOURS], "hurried"), _run([HOURS], "mobile")])
    assert written == ["reference/desktop/proposed.json"]
    document = json.loads(path.read_text(encoding="utf-8"))
    assert (document["profile"], document["batch"], document["steps_count"], document["reference_min_steps"]) == (
        "hurried", "2026-01-01_00-00-00", 1, 3)
    assert document["nodes"] == [node_key(*HOME), node_key(*HOURS)] and document["final_node"] == node_key(*HOURS)
    assert document["steps"][0]["element"] == {"tag": "a", "text": "Horario", "href": HOURS[0]}
    comparison["proposals"] = written
    assert "queda propuesto en `reference/desktop/proposed.json`" in "\n".join(report_section(comparison, {}))


def test_no_proposal_without_a_successful_shorter_run(tmp_path):
    path = _setup(tmp_path)
    assert _propose(tmp_path, [_run([HELP, HOURS, HOURS]), _run([HOURS], "hurried", "failed")])[1] == []
    assert not path.exists()


def test_an_earlier_shorter_proposal_is_kept(tmp_path):
    path = _setup(tmp_path)
    _propose(tmp_path, [_run([HOURS])], "primera")
    _propose(tmp_path, [_run([HELP, HOURS])], "segunda")
    assert json.loads(path.read_text(encoding="utf-8"))["batch"] == "primera"
