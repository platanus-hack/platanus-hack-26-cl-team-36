import math

from visitor.route_tree import branch_cost, build_route_tree, recommended_route, registrable_domain


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


# --- Exploradores: saltos y ramas abandonadas en un intento con éxito ------------------------------------------------

A, C, F = "https://s.cl/a", "https://s.cl/a/c", "https://s.cl/respuesta"


def _explorador(steps, outcome="success"):
    return {"profile": "explorador", "start": {"url": HOME, "title": "Inicio"}, "verdict": {"outcome": outcome},
            "steps": steps}


def _por_par(tree):
    titulos = {node["id"]: node["title"] for node in tree["nodes"]}
    return {(titulos[b["source"]], titulos[b["target"]]): b for b in tree["branches"]}


def test_un_salto_desde_lo_profundo_deja_como_fallo_toda_la_rama_y_no_es_camino():
    tree = build_route_tree([_explorador([
        _step(1, "left_click", "clic", A, "A", 5.0, text="A"),
        _step(2, "left_click", "clic", C, "C", 9.0, text="C"),                       # rama de 2 clics, callejón
        _step(3, "volver_a_nodo", "volver a «Inicio»", HOME, "Inicio", 11.0, signals=["went_back"]),
        _step(4, "left_click", "clic", F, "Respuesta", 15.0, text="Respuesta"),
    ])])
    ramas = _por_par(tree)
    assert (ramas[("Inicio", "A")]["failures"], ramas[("A", "C")]["failures"]) == (1, 1)
    salto = ramas[("C", "Inicio")]
    assert salto["salto"] is True and salto["action"] == "volver a «Inicio»"
    assert (ramas[("Inicio", "Respuesta")]["successes"], ramas[("Inicio", "Respuesta")]["failures"]) == (1, 0)
    assert "salto" not in ramas[("Inicio", "Respuesta")]


def test_volver_al_inicio_con_un_clic_no_vuelve_exitosa_una_rama_abandonada():
    tree = build_route_tree([_explorador([
        _step(1, "left_click", "clic", A, "A", 5.0, text="A"),
        _step(2, "left_click", "clic", HOME, "Inicio", 8.0, signals=["revisit"], text="logo"),
        _step(3, "left_click", "clic", BRANCHES, "Sucursales", 12.0, text="Sucursales"),
        _step(4, "left_click", "clic", F, "Respuesta", 15.0, text="Respuesta"),
        _step(5, "volver_a_nodo", "volver a «A»", A, "A", 17.0, signals=["went_back"]),
        _step(6, "left_click", "clic", F, "Respuesta", 20.0, signals=["revisit"], text="Otra vez"),
    ])])
    ramas = _por_par(tree)
    assert ramas[("Inicio", "A")]["successes"] == 1  # desde A sí llegó a la respuesta (paso 6)
    assert ramas[("A", "Inicio")]["failures"] == 1   # el logo no es avance
    assert ramas[("Inicio", "Sucursales")]["successes"] == ramas[("Sucursales", "Respuesta")]["successes"] == 1
    assert ramas[("A", "Respuesta")]["successes"] == 1

    sin_paso_6 = build_route_tree([_explorador([
        _step(1, "left_click", "clic", A, "A", 5.0, text="A"),
        _step(2, "left_click", "clic", HOME, "Inicio", 8.0, signals=["revisit"], text="logo"),
        _step(3, "left_click", "clic", F, "Respuesta", 12.0, text="Respuesta"),
    ])])
    assert _por_par(sin_paso_6)[("Inicio", "A")]["failures"] == 1  # rama explorada y abandonada


def test_la_ruta_recomendada_nunca_usa_un_salto():
    nodes = [
        {"id": "n1", "is_start": True, "endings": {"success": 0, "failed": 0, "abandoned": 0}},
        {"id": "n2", "is_start": False, "endings": {"success": 0, "failed": 0, "abandoned": 0}},
        {"id": "n3", "is_start": False, "endings": {"success": 5, "failed": 0, "abandoned": 0}},
    ]

    def rama(source, target, successes, salto=False):
        return {"source": source, "target": target, "action": f"{source}>{target}", "successes": successes,
                "failures": 0, "median_time_s": 1.0, "cost": branch_cost(successes, 0), "preceding_actions": [],
                **({"salto": True} if salto else {})}

    route = recommended_route(nodes, [rama("n1", "n3", 50, salto=True), rama("n1", "n2", 1), rama("n2", "n3", 1)])
    assert [step["target"] for step in route["steps"]] == ["n2", "n3"]


def test_dominio_registrable():
    assert registrable_domain("https://www.bibliotecanacional.gob.cl/x") == "bibliotecanacional.gob.cl"
    assert registrable_domain("http://descubre.bibliotecanacional.gob.cl/") == "bibliotecanacional.gob.cl"
    assert registrable_domain("https://patrimoniocultural.gob.cl/") == "patrimoniocultural.gob.cl"
    assert registrable_domain("https://www.metro.cl/el-viaje") == "metro.cl"
    assert registrable_domain("http://127.0.0.1:8000/") == "127.0.0.1"
    assert registrable_domain("chrome-error://chromewebdata/") is None
    assert registrable_domain("file:///tmp/uno.html") is None
