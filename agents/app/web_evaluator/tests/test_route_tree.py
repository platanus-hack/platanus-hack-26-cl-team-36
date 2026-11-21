import math

from route_tree import branch_cost, build_route_tree, normalize_url


def test_normalize_url_drops_tracking_fragment_and_www():
    url = "https://www.Example.com/sucursales/?utm_source=x&b=2&a=1&gclid=z#mapa"
    assert normalize_url(url) == "https://example.com/sucursales?a=1&b=2"


def test_normalize_url_keeps_spa_routes():
    assert normalize_url("https://app.cl/#/perfil") == "https://app.cl/#/perfil"


def test_branch_cost():
    assert branch_cost(0, 0) == -math.log(1 / 2)
    assert branch_cost(3, 0) < branch_cost(1, 2)


def _step(number, action, description, url, title, seconds, signals=(), text=None, url_before=""):
    return {
        "number": number,
        "action": action,
        "description": description,
        "element": {"text": text} if text else None,
        "url": url,
        "title": title,
        "url_before": url_before,
        "seconds_since_start": seconds,
        "signals": list(signals),
    }


HOME, BRANCHES, SANTIAGO, CONTACT = (
    "https://s.cl/",
    "https://s.cl/sucursales",
    "https://s.cl/sucursales/stgo",
    "https://s.cl/contacto",
)


def _runs():
    succeeded = {
        "profile": "first_time",
        "start": {"url": HOME, "title": "Inicio"},
        "verdict": {"outcome": "success"},
        "steps": [
            _step(1, "scroll", "scroll down x3", HOME, "Inicio", 5.0, signals=["no_effect"]),
            _step(2, "left_click", "clic en (10, 10)", BRANCHES, "Sucursales", 12.0, text="Sucursales"),
            _step(3, "left_click", "clic en (20, 20)", SANTIAGO, "Santiago", 20.0, text="Santiago"),
        ],
    }
    abandoned = {
        "profile": "mobile",
        "start": {"url": HOME, "title": "Inicio"},
        "verdict": {"outcome": "abandoned"},
        "steps": [
            _step(1, "left_click", "clic en (5, 5)", CONTACT, "Contacto", 8.0, text="Contacto"),
            _step(2, "key", "atrás", HOME, "Inicio", 11.0, signals=["went_back"]),
            _step(3, "left_click", "clic en (6, 6)", BRANCHES, "Sucursales", 15.0, text="SUCURSALES"),
        ],
    }
    return [succeeded, abandoned]


def _node_ids_by_title(tree):
    return {node["title"]: node["id"] for node in tree["nodes"]}


def test_merges_branches_by_element_text_ignoring_case():
    tree = build_route_tree(_runs())
    ids = _node_ids_by_title(tree)
    home_to_branches = [
        b for b in tree["branches"] if b["source"] == ids["Inicio"] and b["target"] == ids["Sucursales"]
    ]
    assert len(home_to_branches) == 1
    branch = home_to_branches[0]
    # El éxito no cuenta porque en el tramo hubo un scroll sin efecto; el otro recorrido no terminó en éxito.
    assert (branch["successes"], branch["failures"]) == (0, 2)
    assert branch["times_s"] == [12.0, 4.0]
    assert branch["median_time_s"] == 8.0


def test_dead_end_and_going_back_count_as_failures():
    tree = build_route_tree(_runs())
    ids = _node_ids_by_title(tree)
    to_contact = next(b for b in tree["branches"] if b["target"] == ids["Contacto"])
    from_contact = next(b for b in tree["branches"] if b["source"] == ids["Contacto"])
    assert to_contact["failures"] == 1 and from_contact["failures"] == 1


def test_recommended_route_reaches_the_success_node():
    tree = build_route_tree(_runs())
    nodes_by_id = {node["id"]: node for node in tree["nodes"]}
    route = tree["recommended_route"]
    assert route is not None
    assert nodes_by_id[route["start_node"]]["title"] == "Inicio"
    assert nodes_by_id[route["end_node"]]["title"] == "Santiago"
    assert [step["action"] for step in route["steps"]] == ["clic «Sucursales»", "clic «Santiago»"]
    assert 0 < route["estimated_probability"] < 1


def test_route_prefers_branches_with_more_successes():
    def run(profile, via, outcome):
        return {
            "profile": profile,
            "start": {"url": HOME, "title": "Inicio"},
            "verdict": {"outcome": outcome},
            "steps": [
                _step(1, "left_click", "clic", via, via, 5.0, text=via),
                _step(2, "left_click", "clic", SANTIAGO, "Santiago", 9.0, text="Santiago"),
            ],
        }

    tree = build_route_tree([
        run("a", "https://s.cl/x", "success"),
        run("b", "https://s.cl/x", "success"),
        run("c", "https://s.cl/y", "success"),
    ])
    assert tree["recommended_route"]["steps"][0]["action"] == "clic «https://s.cl/x»"


def test_no_route_without_successes():
    runs = _runs()
    runs[0]["verdict"] = {"outcome": "failed"}
    assert build_route_tree(runs)["recommended_route"] is None
