from guide.route import Step, distill, route_nodes, totals


def _step(name: str, before: str, after: str, in_viewport: bool | None = True, action: str = "click") -> Step:
    return Step(action, name, None, f"https://s.cl/{before}", before, f"https://s.cl/{after}", after, in_viewport)


def _values(steps):
    return [step.value for step in steps]


def test_distill_cuts_a_detour_back_to_a_visited_page():
    steps = [_step("productos", "a", "p"), _step("volver", "p", "a"), _step("ayuda", "a", "h")]
    assert _values(distill(steps)) == ["ayuda"]


def test_distill_cuts_to_where_a_revisited_page_was_entered():
    steps = [
        _step("menú", "a", "a"),
        _step("productos", "a", "p"),
        _step("volver", "p", "a"),
        _step("menú otra vez", "a", "a"),
        _step("ayuda", "a", "h"),
    ]
    assert _values(distill(steps)) == ["menú otra vez", "ayuda"]
    assert _values(distill(steps, keep_steps_before_leaving=True)) == ["menú", "menú otra vez", "ayuda"]


def test_distill_can_keep_what_was_done_before_going_back():
    steps = [
        _step("menú", "a", "a"),
        _step("ayuda", "a", "h"),
        _step("pregunta", "h", "q"),
        _step("atrás", "q", "h", None, "back"),
        _step("acordeón", "h", "h"),
    ]
    assert _values(distill(steps)) == ["menú", "ayuda", "acordeón"]
    steps = [_step("menú", "a", "a"), _step("productos", "a", "p"), _step("atrás", "p", "a", None, "back"),
             _step("ayuda", "a", "h")]
    assert _values(distill(steps)) == ["ayuda"]
    assert _values(distill(steps, keep_steps_before_leaving=True)) == ["menú", "ayuda"]


def test_distill_cuts_nested_loops_and_a_return_to_the_start():
    steps = [
        _step("x", "a", "b"), _step("y", "b", "c"), _step("z", "c", "b"),
        _step("w", "b", "a"), _step("abrir", "a", "a"), _step("ir", "a", "d"),
    ]
    assert _values(distill(steps)) == ["abrir", "ir"]


def test_totals_count_ui_actions_like_the_visitor():
    steps = [_step("menú", "a", "a"), _step("buscar", "a", "a", False, "fill"), _step("ir", "a", "b")]
    assert totals(steps, steps[0].node_before, 1) == {
        "actions": 3, "estimated_scrolls": 1, "quote_scrolls": 1, "min_steps": 1 + (2 + 1) + 1 + 1, "distinct_pages": 2,
    }


def test_route_nodes_are_distinct_and_ordered():
    steps = [_step("menú", "a", "a"), _step("ir", "a", "b"), _step("abrir", "b", "b"), _step("seguir", "b", "c")]
    assert [node.split(" | ")[1] for node in route_nodes(steps, steps[0].node_before)] == ["a", "b", "c"]
