from mapper.route import Step, distill, totals


def _step(name: str, before: str, after: str, in_viewport: bool | None = True, action: str = "click") -> Step:
    return Step(action, name, None, f"https://s.cl/{before}", before, f"https://s.cl/{after}", after, in_viewport)


def _values(steps):
    return [step.value for step in steps]


def test_distill_cuts_a_detour_back_to_a_visited_page():
    steps = [_step("productos", "a", "p"), _step("volver", "p", "a"), _step("ayuda", "a", "h")]
    assert _values(distill(steps)) == ["ayuda"]


def test_distill_keeps_in_page_steps_done_before_leaving():
    steps = [
        _step("menú", "a", "a"),
        _step("ayuda", "a", "h"),
        _step("pregunta", "h", "q"),
        _step("atrás", "q", "h", None, "back"),
        _step("acordeón", "h", "h"),
    ]
    assert _values(distill(steps)) == ["menú", "ayuda", "acordeón"]


def test_distill_cuts_nested_loops_and_a_return_to_the_start():
    steps = [
        _step("x", "a", "b"), _step("y", "b", "c"), _step("z", "c", "b"),
        _step("w", "b", "a"), _step("abrir", "a", "a"), _step("ir", "a", "d"),
    ]
    assert _values(distill(steps)) == ["abrir", "ir"]


def test_totals_count_ui_actions_like_the_evaluator():
    steps = [_step("menú", "a", "a"), _step("buscar", "a", "a", False, "fill"), _step("ir", "a", "b")]
    assert totals(steps, steps[0].node_before) == {
        "actions": 3, "estimated_scrolls": 1, "min_steps": 1 + (2 + 1) + 1, "distinct_pages": 2,
    }
