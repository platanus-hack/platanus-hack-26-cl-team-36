import json

import pytest

from reference import compare, compare_batch, load_reference, report_section, visited_nodes
from route_tree import node_key

URL, INSTRUCTION = "https://s.cl/", "Encuentra el horario."
HOME, HELP, HOURS, OTHER = (
    ("https://s.cl/", "Inicio"),
    ("https://s.cl/ayuda", "Ayuda"),
    ("https://s.cl/ayuda/horario", "Horario"),
    ("https://s.cl/otra", "Otra"),
)
ROUTE = {
    "status": "verified",
    "start_url": URL,
    "instruction": INSTRUCTION,
    "evaluator_profiles": ["first_time", "hurried"],
    "totals": {"min_steps": 2, "distinct_pages": 3},
    "nodes": [node_key(*HOME), node_key(*HELP), node_key(*HOURS)],
    "final_node": node_key(*HOURS),
}


def _run(pages, outcome="success", profile="first_time"):
    return {
        "profile": profile,
        "start": {"url": HOME[0], "title": HOME[1]},
        "steps": [{"url": url, "title": title} for url, title in pages],
        "verdict": {"outcome": outcome},
    }


def test_visited_nodes_collapses_steps_on_the_same_page():
    assert visited_nodes(_run([HOME, HELP, HELP, HOURS])) == ROUTE["nodes"]


def test_optimal_attempt_scores_one_everywhere():
    result = compare(_run([HELP, HOURS]), ROUTE)
    assert (result["efficiency"], result["lostness"], result["similarity"]) == (1.0, 0.0, 1.0)
    assert result["reached_final_node"] and not result["beat_reference"]


def test_detour_lowers_efficiency_and_raises_lostness():
    result = compare(_run([OTHER, HOME, HELP, HOURS]), ROUTE)
    assert result["efficiency"] == 0.5
    assert result["revisits"] == 0.8 and result["detour"] == 0.75
    assert result["lostness"] == pytest.approx((0.8 - 1) ** 2 + (0.75 - 1) ** 2, abs=0.01)
    assert result["similarity"] == 0.6


def test_failed_attempt_has_zero_efficiency_and_reports_progress():
    result = compare(_run([HELP], outcome="abandoned"), ROUTE)
    assert result["efficiency"] == 0.0 and not result["reached_final_node"]


def test_attempt_shorter_than_reference_is_capped_and_flagged():
    result = compare(_run([HOURS]), ROUTE)
    assert result["efficiency"] == 1.0 and result["beat_reference"]


def _write_route(output_dir, viewport="desktop", **changes):
    path = output_dir / "reference" / viewport / "route.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({**ROUTE, **changes}), encoding="utf-8")


def test_load_reference_matches_task_and_profile(tmp_path):
    _write_route(tmp_path)
    assert load_reference(tmp_path, URL, INSTRUCTION, "hurried") is not None
    assert load_reference(tmp_path, URL, INSTRUCTION, "mobile") is None
    assert load_reference(tmp_path, URL, "Otra tarea.", "hurried") is None


def test_unverified_route_is_ignored(tmp_path):
    _write_route(tmp_path, status="unverified")
    assert compare_batch(tmp_path, URL, INSTRUCTION, [_run([HELP, HOURS])]) is None


def test_compare_batch_averages_efficiency_and_renders(tmp_path):
    _write_route(tmp_path)
    runs = [_run([HELP, HOURS]), _run([HELP], outcome="failed", profile="hurried"), _run([HELP, HOURS], profile="mobile")]
    comparison = compare_batch(tmp_path, URL, INSTRUCTION, runs)
    assert comparison["spl"] == 0.5 and [row["profile"] for row in comparison["runs"]] == ["first_time", "hurried"]
    section = "\n".join(report_section(comparison, {"first_time": "Primera vez"}))
    assert "| Primera vez | 2 / 2 | 1.00 | 0.00 | sí | 1.00 |" in section
