from visitor.claude_code_engine import decision_to_turn


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


def _png_header(width: int, height: int) -> bytes:
    """Lo justo de un PNG para que api_engine.png_size lea su tamaño."""
    import struct

    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height) + b"\x08\x02\x00\x00\x00"


class _FakeMessages:
    """Responde siempre lo mismo y guarda los pedidos."""

    def __init__(self, content):
        self.calls = []
        self.content = content

    async def create(self, **kwargs):
        from types import SimpleNamespace

        self.calls.append(kwargs)
        usage = SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        return SimpleNamespace(stop_reason="tool_use", content=self.content, usage=usage)


def test_api_engine_marks_only_the_last_block_for_caching(tmp_path):
    import asyncio
    from types import SimpleNamespace

    from visitor.api_engine import ApiEngine

    messages = _FakeMessages([SimpleNamespace(type="text", text="TERMINADO: listo")])
    engine = ApiEngine(SimpleNamespace(messages=messages), "us.anthropic.claude-haiku-5-5", "medium")
    asyncio.run(engine.start("sistema", "primer mensaje", b"png", tmp_path))
    turn = asyncio.run(engine.decide())

    assert turn.final == ("done", "listo")
    request = messages.calls[0]
    # Bedrock (bedrock-runtime) no acepta la caché automática: el punto va a mano, solo en el último bloque.
    assert "cache_control" not in request and request["tools"][0]["type"] == "computer_toolset_20260801"
    blocks = request["messages"][-1]["content"]
    assert [block.get("cache_control") for block in blocks] == [None, {"type": "ephemeral"}]
    assert all("cache_control" not in block for block in engine.messages[0]["content"])  # el historial queda igual




def test_api_engine_uses_the_legacy_computer_tool_on_bedrock(tmp_path):
    """El modelo de AWS (anterior a Opus 4.7) no acepta el toolset: va la herramienta `computer`, con beta."""
    import asyncio
    from types import SimpleNamespace

    from visitor import config
    from visitor.api_engine import ApiEngine
    from visitor.turns import ActionResult

    click = SimpleNamespace(type="tool_use", id="t1", name="computer", input={"action": "left_click", "coordinate": [10, 20]})
    messages = _FakeMessages([click])
    model = config.BEDROCK_MODEL_PREFIX + config.BEDROCK_USER_MODEL
    engine = ApiEngine(SimpleNamespace(beta=SimpleNamespace(messages=messages)), model, "medium")
    asyncio.run(engine.start("sistema", "primer mensaje", _png_header(390, 844), tmp_path))
    turn = asyncio.run(engine.decide())

    request = messages.calls[0]
    assert request["betas"] == ["computer-use-2025-11-24"]
    assert request["tools"][0] == {
        "type": "computer_20251124", "name": "computer", "display_width_px": 390, "display_height_px": 844,
    }
    [action] = turn.requests
    assert (action.name, action.input, action.is_computer) == ("left_click", {"coordinate": [10, 20]}, True)

    asyncio.run(engine.respond([ActionResult(action, "OK")], _png_header(390, 844)))
    [result] = engine.messages[-1]["content"]
    assert result["tool_use_id"] == "t1" and "toolset_name" not in result




def test_api_engine_sends_errors_as_text_and_the_screenshot_apart(tmp_path):
    """Un tool_result con `is_error` solo puede llevar texto (Sonnet 4.6 responde 400): la captura va aparte."""
    import asyncio
    from types import SimpleNamespace

    from visitor.api_engine import ApiEngine
    from visitor.turns import ActionRequest, ActionResult

    engine = ApiEngine(SimpleNamespace(), "us.anthropic.claude-sonnet-4-6", "medium")
    click = ActionRequest("t1", "left_click", {"coordinate": [10, 20]}, True)
    asyncio.run(engine.respond([ActionResult(click, "falta la expectativa", True, b"captura")], b"pantalla"))
    result, screenshot = engine.messages[-1]["content"]
    assert result == {"type": "tool_result", "tool_use_id": "t1", "content": "falta la expectativa", "is_error": True}
    assert screenshot["type"] == "image"
