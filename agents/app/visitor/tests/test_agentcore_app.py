import asyncio
import json
from types import SimpleNamespace

import pytest

from shared import store

import agentcore_app
from agentcore_app import InvalidRequest, parse_request
from visitor.batch import models_for
from visitor.judge import ApiJudge
from visitor.profiles import PERFILES_POR_DEFECTO


def test_parse_request_fills_defaults():
    request = parse_request({"url": "https://ejemplo.cl", "instruction": "  Encontrar el horario  "})
    assert request["instruction"] == "Encontrar el horario"
    assert request["profiles"] == list(PERFILES_POR_DEFECTO)
    assert request["goal"].startswith("libre-encontrar-el-horario-")
    assert request["effort"] == "medium"
    assert "model" not in request  # en AWS el modelo no se elige por pedido: siempre Sonnet 4.6


@pytest.mark.parametrize("payload", [
    "no es un objeto",
    {"instruction": "x"},
    {"url": "ftp://ejemplo.cl", "instruction": "x"},
    {"url": "https://ejemplo.cl", "instruction": "   "},
    {"url": "https://ejemplo.cl", "instruction": "x", "profiles": ["astronauta"]},
    {"url": "https://ejemplo.cl", "instruction": "x", "profiles": ["explorador"]},  # su skill no se despliega
    {"url": "https://ejemplo.cl", "instruction": "x", "effort": "turbo"},
    {"url": "https://ejemplo.cl", "instruction": "x", "effort": "xhigh"},  # Sonnet 4.6 no lo acepta
    {"url": "https://ejemplo.cl", "instruction": "x", "task_id": "wom.cl/baja-fibra"},
])
def test_parse_request_rejects_bad_payloads(payload):
    with pytest.raises(InvalidRequest):
        parse_request(payload)


def test_aws_uses_only_sonnet_4_6():
    assert models_for("bedrock") == ("claude-sonnet-4-6", "claude-sonnet-4-6")
    assert models_for("api") == ("claude-sonnet-5-5", "claude-opus-5-5")
    assert models_for("claude-code", "claude-haiku-5-5") == ("claude-haiku-5-5", "claude-opus-5-5")


def _collect(payload) -> list[dict]:
    async def run():
        return [event async for event in agentcore_app.invoke(payload, None)]
    return asyncio.run(run())


def test_invoke_streams_an_error_for_a_bad_request():
    assert _collect({"url": "nada"}) == [{"error": "falta `url`, con http:// o https://"}]


def test_invoke_streams_progress_and_report(tmp_path, monkeypatch):
    async def fake_batch(backend, prefix, url, instruction, profile_keys, **kwargs):
        assert kwargs.get("user_model") is None  # run_batch elige Sonnet 4.6 con el motor bedrock
        run = store.start_run(backend, prefix, model=None)
        (run.workdir / "mobile").mkdir()
        (run.workdir / "mobile" / "run.json").write_text(json.dumps({"profile": "mobile", "verdict": {"outcome": "success"}}))
        (run.workdir / "report.md").write_text("# Reporte")
        store.finish_run(backend, run, "succeeded")
        return run.key

    monkeypatch.setenv(store.ENV_VAR, tmp_path.as_uri())
    monkeypatch.setattr(agentcore_app, "run_batch", fake_batch)
    events = _collect({"url": "https://ejemplo.cl", "instruction": "x", "profiles": ["mobile"], "model": "claude-opus-5-5"})
    assert events[0]["status"] == "running"
    assert events[-1]["status"] == "done"
    assert events[-1]["outcomes"] == {"mobile": "success"}
    assert events[-1]["report"] == "# Reporte"


def test_invoke_removes_its_temporary_store(tmp_path, monkeypatch):
    folder = tmp_path / "almacen"
    folder.mkdir()
    seen = []

    async def fake_batch(backend, prefix, url, instruction, profile_keys, **kwargs):
        seen.append(backend.root)
        with store.running(backend, prefix, model=None) as run:
            (run.workdir / "report.md").write_text("# Reporte")
        return run.key

    monkeypatch.delenv(store.ENV_VAR, raising=False)
    monkeypatch.setattr(agentcore_app.tempfile, "mkdtemp", lambda prefix: str(folder))
    monkeypatch.setattr(agentcore_app, "run_batch", fake_batch)
    events = _collect({"url": "https://ejemplo.cl", "instruction": "x"})
    assert events[-1]["report"] == "# Reporte" and seen == [folder] and not folder.exists()


def test_invoke_streams_batch_errors(monkeypatch):
    async def failing_batch(*args, **kwargs):
        raise RuntimeError("sin credenciales")

    monkeypatch.setattr(agentcore_app, "run_batch", failing_batch)
    events = _collect({"url": "https://ejemplo.cl", "instruction": "x"})
    assert events[-1] == {"status": "error", "error": "RuntimeError: sin credenciales"}


class _FakeMessages:
    def __init__(self):
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        text = SimpleNamespace(type="text", text='{"outcome": "success", "justification": "ok"}')
        return SimpleNamespace(stop_reason="end_turn", content=[text])


def test_judge_without_fallbacks_uses_plain_messages_api():
    messages, beta_messages = _FakeMessages(), _FakeMessages()
    client = SimpleNamespace(messages=messages, beta=SimpleNamespace(messages=beta_messages))
    judge = ApiJudge(client, model="us.anthropic.claude-haiku-5-5", fallbacks=False)
    assert asyncio.run(judge.ask_json("sistema", "texto", b"png", {"type": "object"}))["outcome"] == "success"
    assert beta_messages.calls == []
    assert "fallbacks" not in messages.calls[0] and messages.calls[0]["model"] == "us.anthropic.claude-haiku-5-5"
