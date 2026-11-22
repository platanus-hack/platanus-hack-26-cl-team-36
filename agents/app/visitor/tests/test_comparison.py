import pytest

from shared import store
from shared.nodes.urls import node_key

from visitor.comparison import (
    compare, compare_batch, find_references, reached, reference_for, report_section, visited_nodes,
)

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
    "viewport": "desktop",
    "totals": {"min_steps": 2, "distinct_pages": 3},
    "nodes": [node_key(*HOME), node_key(*HELP), node_key(*HOURS)],
    "final_node": node_key(*HOURS),
}


def _run(pages, outcome="success", profile="desktop"):
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
    assert result["lostness"] == pytest.approx(((0.8 - 1) ** 2 + (0.75 - 1) ** 2) ** 0.5, abs=0.01)
    assert result["similarity"] == 0.6


def test_lostness_matches_the_uxtweak_example():
    # T = 8 páginas visitadas, N = 5 distintas, R = 3 en la ruta: √((5/8 − 1)² + (3/5 − 1)²) ≈ 0,55.
    pages = [(f"https://s.cl/{name}", name) for name in "BCDEDCB"]
    route = {**ROUTE, "totals": {"min_steps": 2, "distinct_pages": 3}}
    assert compare(_run(pages), route)["lostness"] == 0.55


def test_failed_attempt_has_zero_efficiency_and_misses_the_final_node():
    result = compare(_run([HELP], outcome="abandoned"), ROUTE)
    assert result["efficiency"] == 0.0 and not result["reached_final_node"]


def test_attempt_that_stops_early_is_not_lost():
    assert compare(_run([], outcome="abandoned"), ROUTE)["lostness"] == 0.0


def test_answer_on_the_start_page():
    route = {**ROUTE, "totals": {"min_steps": 0, "distinct_pages": 1}, "nodes": ROUTE["nodes"][:1],
             "final_node": ROUTE["nodes"][0]}
    assert compare(_run([]), route)["efficiency"] == 1.0
    assert compare(_run([HELP, HOME]), route)["efficiency"] == 0.0


def test_attempt_shorter_than_reference_is_capped_and_flagged():
    result = compare(_run([HOURS]), ROUTE)
    assert result["efficiency"] == 1.0 and result["beat_reference"]


def _publish(backend, run_status="succeeded", **changes):
    run = store.start_run(backend, store.guide(URL, "horario", "desktop"), model="m")
    backend.write_json(run.key.file("route.json"), {**ROUTE, **changes})
    store.finish_run(backend, run, run_status)
    return run.key


def test_find_references_match_goal_instruction_and_viewport(tmp_path):
    backend = store.LocalBackend(tmp_path)
    run = _publish(backend)
    assert find_references(backend, URL, "horario", INSTRUCTION, ["desktop", "mobile"]) == {"desktop": (run, ROUTE)}
    assert find_references(backend, URL, "horario", "Otra tarea.", ["desktop"]) == {}
    assert find_references(backend, URL, "otro", INSTRUCTION, ["desktop"]) == {}
    assert find_references(backend, URL, "horario", INSTRUCTION, ["explorador"]) == {}
    assert reference_for({"desktop": (run, ROUTE)}, "explorador") is None


def test_a_failed_newer_guide_run_does_not_hide_the_last_good_one(tmp_path):
    backend = store.LocalBackend(tmp_path)
    good = _publish(backend)
    _publish(backend, run_status="failed")
    assert find_references(backend, URL, "horario", INSTRUCTION, ["desktop"])["desktop"][0] == good


def test_unverified_route_is_ignored(tmp_path):
    backend = store.LocalBackend(tmp_path)
    _publish(backend, status="unverified")
    references = find_references(backend, URL, "horario", INSTRUCTION, ["desktop"])
    assert references == {} and compare_batch(references, [_run([HELP, HOURS])]) is None


def test_compare_batch_averages_efficiency_and_renders():
    runs = [_run([HELP, HOURS]), _run([HELP], outcome="failed", profile="hurried"), _run([HELP, HOURS], profile="explorador")]
    comparison = compare_batch({"desktop": (None, ROUTE)}, runs)
    # `hurried` es un perfil retirado: una corrida vieja se sigue comparando con la ruta de su pantalla.
    assert comparison["spl"] == 0.5 and [row["profile"] for row in comparison["runs"]] == ["desktop", "hurried"]
    section = "\n".join(report_section(comparison, {"desktop": "Escritorio"}))
    assert "| Escritorio | 2 / 2 | 1.00 | 0.00 | sí | 1.00 |" in section


def test_mobile_without_its_own_route_is_measured_against_desktop():
    route = {**ROUTE, "viewport": "mobile"}
    assert reference_for({"desktop": ("d", ROUTE)}, "mobile") == ("d", ROUTE)
    assert reference_for({"desktop": ("d", ROUTE), "mobile": ("m", route)}, "mobile") == ("m", route)
    [row] = compare_batch({"desktop": (None, ROUTE)}, [_run([HELP, HOURS], profile="mobile")])["runs"]
    assert row["reference_viewport"] == "desktop" and row["reached_final_node"]


def test_an_interrupted_attempt_is_not_compared():
    runs = [_run([HELP, HOURS]), _run([HELP], outcome="interrupted", profile="hurried")]
    comparison = compare_batch({"desktop": (None, ROUTE)}, runs)
    assert comparison["spl"] == 1.0 and [row["profile"] for row in comparison["runs"]] == ["desktop"]
    assert compare_batch({"desktop": (None, ROUTE)}, runs[1:]) is None


def test_a_submitted_form_with_other_values_reaches_the_final_page():
    """Planificar un viaje termina en `?inicio=..&fin=..`: otras estaciones (y otro título) también son llegar."""
    final = node_key("https://metro.cl/el-viaje/planificador?dia=DL&fin=EL&horario=VALLE&inicio=SP", "Viaje San Pablo")
    otras = ("https://www.metro.cl/el-viaje/planificador/?inicio=BA&fin=LH&horario=PUNTA&dia=DS", "Viaje Baquedano")
    sin_fin = ("https://metro.cl/el-viaje/planificador?inicio=BA", "Planificador")
    otra_ruta = ("https://metro.cl/el-viaje/otra?dia=DL&fin=EL&horario=VALLE&inicio=SP", "Otra")
    assert reached(final, _run([otras]))
    assert not reached(final, _run([sin_fin, otra_ruta]))
    # Esa misma URL con un error HTTP (el WAF del sitio) no es llegar.
    bloqueada = _run([(otras[0], "Acceso restringido")])
    bloqueada["steps"][0]["error_detail"] = "HTTP 403"
    assert not reached(final, bloqueada)
    # Sin query, la página final se compara completa, como siempre.
    assert not reached(node_key(*HOURS), _run([("https://s.cl/ayuda/horario", "Otro título")]))
