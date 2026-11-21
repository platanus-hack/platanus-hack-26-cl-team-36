from engines import decision_to_turn


def test_click_produces_expectation_and_left_click():
    turn = decision_to_turn({"expectation": "Se abre el menú.", "action": "click", "x": 10, "y": 20}, 1)
    assert turn.final is None
    assert [(request.name, request.input) for request in turn.requests] == [
        ("expectation", {"sentence": "Se abre el menú."}),
        ("left_click", {"coordinate": [10, 20]}),
    ]
    assert turn.requests[1].is_computer


def test_scroll_and_key():
    scroll = decision_to_turn({"expectation": "Veo más.", "action": "scroll", "direction": "down"}, 2).requests[1]
    assert (scroll.name, scroll.input) == ("scroll", {"scroll_direction": "down", "scroll_amount": 3})
    key = decision_to_turn({"expectation": "Vuelvo.", "action": "key", "text": "alt+Left"}, 3).requests[1]
    assert (key.name, key.input) == ("key", {"text": "alt+Left"})


def test_final_actions():
    assert decision_to_turn({"expectation": "x", "action": "done", "text": "Listo."}, 4).final == ("done", "Listo.")
    assert decision_to_turn({"expectation": "Pide login.", "action": "blocked"}, 5).final == ("blocked", "Pide login.")
    assert decision_to_turn({"expectation": "x", "action": "give_up", "text": "No está."}, 6).final == ("gave_up", "No está.")


def test_api_engine_marks_only_the_last_block_for_caching(tmp_path):
    import asyncio
    from types import SimpleNamespace

    import config
    from engines import ApiEngine

    calls = []

    class FakeMessages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            usage = SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0, cache_creation_input_tokens=0)
            text = SimpleNamespace(type="text", text="TERMINADO: listo")
            return SimpleNamespace(stop_reason="end_turn", content=[text], usage=usage)

    model = config.BEDROCK_MODEL_PREFIX + config.BEDROCK_USER_MODEL
    engine = ApiEngine(SimpleNamespace(messages=FakeMessages()), model, "medium")
    asyncio.run(engine.start("sistema", "primer mensaje", b"png", tmp_path))
    turn = asyncio.run(engine.decide())

    assert turn.final == ("done", "listo")
    request = calls[0]
    # Bedrock (bedrock-runtime) no acepta la caché automática: el punto va a mano, solo en el último bloque.
    assert "cache_control" not in request and request["model"] == "us.anthropic.claude-haiku-5-5"
    blocks = request["messages"][-1]["content"]
    assert [block.get("cache_control") for block in blocks] == [None, {"type": "ephemeral"}]
    assert all("cache_control" not in block for block in engine.messages[0]["content"])  # el historial queda igual
