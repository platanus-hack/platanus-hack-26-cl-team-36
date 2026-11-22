import asyncio
import io
import json

import pytest

from shared.claude import bedrock, engines
from shared.claude import caller as caller_module
from shared.claude.bedrock import BedrockCaller
from shared.claude.caller import ClaudeCallError, ClaudeCaller
from shared.claude.fake import FakeCaller, from_schema

SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["done", "give_up"]},
        "parent": {"type": ["string", "null"]},
        "items": {"type": "array", "items": {"type": "string"}},
        "score": {"type": "integer", "minimum": 1},
        "note": {"type": "string"},
    },
    "required": ["action", "parent", "items", "score"],
    "additionalProperties": False,
}
DONE = {"action": "done", "parent": None, "items": ["a"], "score": 3}
GIVE_UP = {**DONE, "action": "give_up"}


class ClientError(Exception):
    """Como botocore.exceptions.ClientError: el código viaja en `response`."""

    def __init__(self, code: str):
        super().__init__(f"An error occurred ({code})")
        self.response = {"Error": {"Code": code}}


class FakeBedrock:
    """bedrock-runtime falso: responde en orden lo que se le dio, o lanza los errores."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests: list[dict] = []

    def invoke_model(self, **request):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return {"body": io.BytesIO(json.dumps(outcome).encode())}


def _tool_response(output: dict) -> dict:
    return {
        "content": [{"type": "text", "text": "listo"}, {"type": "tool_use", "id": "t1", "name": "responder", "input": output}],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 120, "output_tokens": 30},
    }


def _sleeps():
    waits: list[float] = []

    async def sleep(seconds):
        waits.append(seconds)

    return waits, sleep


@pytest.fixture
def no_engine_env(monkeypatch):
    monkeypatch.delenv(engines.ENGINE_VAR, raising=False)
    monkeypatch.delenv(engines.MODEL_VAR, raising=False)


def test_the_default_engine_is_claude_code_with_the_agents_model(no_engine_env, tmp_path):
    caller = engines.make_caller("claude-opus-5-5", "high", tmp_path, tmp_path / "log")
    assert isinstance(caller, ClaudeCaller) and caller.model == "claude-opus-5-5" and engines.needs_claude_cli()


def test_bedrock_uses_agents_model_instead_of_the_fixed_one(no_engine_env, monkeypatch, tmp_path):
    monkeypatch.setenv(engines.ENGINE_VAR, "bedrock")
    monkeypatch.setattr(bedrock, "bedrock_client", lambda region, timeout: FakeBedrock())
    assert engines.model_for("claude-opus-5-5") == engines.DEFAULT_BEDROCK_MODEL
    monkeypatch.setenv(engines.MODEL_VAR, "us.anthropic.claude-sonnet-4-6")
    caller = engines.make_caller("claude-opus-5-5", "high", tmp_path, tmp_path / "log")
    assert isinstance(caller, BedrockCaller) and caller.model == "us.anthropic.claude-sonnet-4-6"
    assert not engines.needs_claude_cli()


def test_fake_engine_and_unknown_engine(no_engine_env, monkeypatch, tmp_path):
    monkeypatch.setenv(engines.ENGINE_VAR, "fake")
    assert isinstance(engines.make_caller("m", "low", tmp_path, tmp_path / "log"), FakeCaller)
    monkeypatch.setenv(engines.ENGINE_VAR, "openai")
    with pytest.raises(engines.UnknownEngine, match="claude-code, bedrock, fake"):
        engines.make_caller("m", "low", tmp_path, tmp_path / "log")


def test_bedrock_forces_the_answer_tool_with_the_schema_and_sends_images(tmp_path):
    client = FakeBedrock(_tool_response(DONE))
    caller = BedrockCaller("us.anthropic.claude-haiku-4-5-20251001-v1:0", "high", tmp_path / "log", client=client)
    output = asyncio.run(caller.ask("sistema", SCHEMA, "la página", b"\x89PNG"))
    assert output == DONE
    request = client.requests[0]
    body = json.loads(request["body"])
    assert request["modelId"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert body["system"] == "sistema" and body["tools"][0]["input_schema"] == SCHEMA
    assert body["tool_choice"] == {"type": "tool", "name": "responder"}
    assert [block["type"] for block in body["messages"][0]["content"]] == ["text", "image"]
    assert "effort" not in request["body"]   # Haiku 4.5 no lo acepta
    assert caller.usage["input_tokens"] == 120 and caller.usage["output_tokens"] == 30
    assert json.loads((tmp_path / "log").read_text().splitlines()[-1])["stop_reason"] == "tool_use"


def test_bedrock_retries_throttling_with_growing_waits(tmp_path):
    client = FakeBedrock(ClientError("ThrottlingException"), ClientError("InternalServerException"),
                         _tool_response(GIVE_UP))
    waits, sleep = _sleeps()
    caller = BedrockCaller("modelo", "high", tmp_path / "log", client=client, sleep=sleep)
    answer = asyncio.run(caller.answer("s", SCHEMA, ["texto"]))
    assert answer.output == GIVE_UP and len(client.requests) == 3
    assert len(waits) == 2 and waits[0] < waits[1] <= bedrock.BACKOFF_MAX_S


def test_bedrock_gives_up_after_the_last_attempt_and_on_other_errors(tmp_path):
    client = FakeBedrock(*[ClientError("ThrottlingException")] * bedrock.MAX_ATTEMPTS)
    waits, sleep = _sleeps()
    caller = BedrockCaller("modelo", "high", tmp_path / "log", client=client, sleep=sleep)
    with pytest.raises(ClaudeCallError, match="ThrottlingException"):
        asyncio.run(caller.ask("s", SCHEMA, "texto"))
    assert len(client.requests) == bedrock.MAX_ATTEMPTS and len(waits) == bedrock.MAX_ATTEMPTS - 1

    client = FakeBedrock(ClientError("ValidationException"))
    caller = BedrockCaller("modelo", "high", tmp_path / "log", client=client, sleep=sleep)
    with pytest.raises(ClaudeCallError, match="ValidationException"):
        asyncio.run(caller.ask("s", SCHEMA, "texto"))
    assert len(client.requests) == 1


def test_bedrock_without_the_answer_tool_is_an_error(tmp_path):
    client = FakeBedrock({"content": [{"type": "text", "text": "no"}], "stop_reason": "max_tokens", "usage": {}})
    caller = BedrockCaller("modelo", "high", tmp_path / "log", client=client)
    with pytest.raises(ClaudeCallError, match="max_tokens"):
        asyncio.run(caller.ask("s", SCHEMA, "texto"))


def test_bedrock_cut_by_max_tokens_or_missing_required_keys_is_an_error(tmp_path):
    cut = {**_tool_response({"action": "done"}), "stop_reason": "max_tokens"}
    client = FakeBedrock(cut, _tool_response({"action": "done"}))
    caller = BedrockCaller("modelo", "high", tmp_path / "log", client=client)
    with pytest.raises(ClaudeCallError, match="max_tokens"):
        asyncio.run(caller.ask("s", SCHEMA, "texto"))
    with pytest.raises(ClaudeCallError, match="sin parent, items, score"):
        asyncio.run(caller.ask("s", SCHEMA, "texto"))


class ScriptedProcess:
    """`ClaudeCodeProcess` falso que termina con el evento `result` dado."""

    event: dict = {}

    @classmethod
    async def open(cls, *args):
        return cls()

    async def send_content(self, content):
        pass

    async def wait_for_result(self, timeout_s):
        return self.event

    async def close(self):
        pass


@pytest.mark.parametrize("event, error", [
    ({"subtype": "success", "structured_output": DONE}, None),
    ({"subtype": "success", "result": "```json\n" + json.dumps(DONE) + "\n```"}, None),
    ({"subtype": "success", "result": '{"action": "done"}'}, "sin parent"),
    ({"subtype": "error_max_turns", "is_error": False, "structured_output": DONE}, "error_max_turns"),
    ({"subtype": "success", "is_error": True, "result": json.dumps(DONE)}, "estructurada"),
])
def test_claude_code_reads_the_result_event(monkeypatch, tmp_path, event, error):
    monkeypatch.setattr(caller_module, "ClaudeCodeProcess", type("P", (ScriptedProcess,), {"event": event}))
    caller = ClaudeCaller("m", "low", tmp_path, tmp_path / "log")
    if error is None:
        assert asyncio.run(caller.ask("s", SCHEMA, "texto")) == DONE
    else:
        with pytest.raises(ClaudeCallError, match=error):
            asyncio.run(caller.ask("s", SCHEMA, "texto"))


def test_fake_answers_the_script_then_the_responder_then_the_schema():
    seen = []

    def responder(system_prompt, schema, parts):
        seen.append(parts)
        return GIVE_UP if "rendirse" in parts[0] else None

    caller = FakeCaller("m", "low", responder, script=[DONE])
    answers = [asyncio.run(caller.ask("s", SCHEMA, text)) for text in ("uno", "rendirse", "otro")]
    assert answers[0] == DONE and answers[1] == GIVE_UP
    assert answers[2] == {"action": "done", "parent": None, "items": [], "score": 1}
    assert seen == [["rendirse"], ["otro"]] and len(caller.calls) == 3


def test_from_schema_is_deterministic():
    assert from_schema(SCHEMA) == from_schema(SCHEMA) == {"action": "done", "parent": None, "items": [], "score": 1}
