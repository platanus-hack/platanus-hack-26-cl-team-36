import threading
import time

import pytest
from bedrock_agentcore.runtime.models import PingStatus

import agentcore_app

PAYLOAD = {"stage": "catalog", "revision": "rev-1", "url": "https://www.wom.cl/"}
app = agentcore_app.app


def settle() -> None:
    """Espera a que termine el hilo de la etapa (complete_async_task va justo después)."""
    for thread in threading.enumerate():
        if thread.name.startswith("stage-"):
            thread.join(5)


def test_answers_at_once_and_keeps_working_in_the_background(monkeypatch) -> None:
    release = threading.Event()
    seen = []

    def slow_stage(request):
        release.wait(5)
        seen.append(request.command.app)

    monkeypatch.setattr(agentcore_app, "run_stage", slow_stage)
    started = time.monotonic()
    assert agentcore_app.invoke(PAYLOAD) == {"status": "accepted", "stage": "catalog", "revision": "rev-1"}
    assert time.monotonic() - started < 1
    assert app.get_current_ping_status() == PingStatus.HEALTHY_BUSY

    release.set()
    settle()
    assert seen == ["cataloger"]
    assert app.get_current_ping_status() == PingStatus.HEALTHY


def test_a_stage_that_raises_still_frees_the_session(monkeypatch) -> None:
    def broken(request):
        raise RuntimeError("sin almacén")

    monkeypatch.setattr(agentcore_app, "run_stage", broken)
    agentcore_app.invoke(PAYLOAD)
    settle()
    assert app.get_async_task_info()["active_count"] == 0


def test_invalid_payload_starts_nothing(monkeypatch) -> None:
    monkeypatch.setattr(agentcore_app, "run_stage", lambda request: pytest.fail("no debía correr"))
    assert "etapa desconocida" in agentcore_app.invoke({**PAYLOAD, "stage": "explore"})["error"]
    assert app.get_async_task_info()["active_count"] == 0
