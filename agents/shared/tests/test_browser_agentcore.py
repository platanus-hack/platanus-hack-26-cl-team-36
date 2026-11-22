import asyncio

import pytest

from shared.browser import agentcore, session
from shared.browser.agentcore import AgentCoreBrowsers


class FakeBrowserClient:
    """Como bedrock_agentcore BrowserClient: arranca una sesión y firma la conexión CDP."""

    instances: list["FakeBrowserClient"] = []

    def __init__(self, region):
        self.region, self.started, self.stopped = region, None, False
        FakeBrowserClient.instances.append(self)

    def start(self, **options):
        self.started = options

    def generate_ws_headers(self):
        return f"wss://{self.region}/sesion-{len(FakeBrowserClient.instances)}", {"Authorization": "firmado"}

    def stop(self):
        self.stopped = True


class FakeBrowser:
    def __init__(self, url, headers):
        self.url, self.headers, self.closed = url, headers, False

    async def close(self):
        self.closed = True


class FakeChromium:
    async def connect_over_cdp(self, url, headers=None):
        return FakeBrowser(url, headers)


class FakePlaywright:
    chromium = FakeChromium()


def test_each_open_is_a_signed_session_and_close_stops_them_all():
    FakeBrowserClient.instances.clear()

    async def scenario():
        sessions = AgentCoreBrowsers(FakePlaywright(), "us-east-2", client_factory=FakeBrowserClient)
        first, second = await sessions.open(), await sessions.open()
        await sessions.close()
        return first, second

    first, second = asyncio.run(scenario())
    assert first.url != second.url and first.headers == {"Authorization": "firmado"}
    assert first.closed and second.closed
    assert all(client.stopped and client.region == "us-east-2" for client in FakeBrowserClient.instances)
    assert FakeBrowserClient.instances[0].started == {
        "session_timeout_seconds": agentcore.SESSION_TIMEOUT_S, "viewport": agentcore.VIEWPORT,
    }


def test_browser_kind_comes_from_the_argument_or_agents_browser(monkeypatch):
    monkeypatch.delenv(session.BROWSER_VAR, raising=False)
    assert session.browser_kind() == "local"
    monkeypatch.setenv(session.BROWSER_VAR, "agentcore")
    assert session.browser_kind() == "agentcore" and session.browser_kind("local") == "local"
    monkeypatch.setenv(session.BROWSER_VAR, "firefox")
    with pytest.raises(ValueError, match="local, agentcore"):
        session.browser_kind()
