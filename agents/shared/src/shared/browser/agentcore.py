"""Sesiones de AgentCore Browser: Playwright se conecta a cada una por CDP con encabezados firmados con AWS."""

import asyncio

from playwright.async_api import Browser, Playwright
from playwright.async_api import Error as PlaywrightError

from shared import aws

VIEWPORT = {"width": 1280, "height": 800}   # la ventana; cada contexto fija su propia vista
SESSION_TIMEOUT_S = 1800


class AgentCoreBrowsers:
    """Una sesión por `open()`: cada sesión acepta una sola conexión de automatización."""

    def __init__(self, playwright: Playwright, region: str | None = None, client_factory=None):
        self._playwright = playwright
        self._region = region or aws.region()
        self._client_factory = client_factory
        self._clients = []
        self._browsers: list[Browser] = []

    def _new_client(self):
        if self._client_factory:
            return self._client_factory(self._region)
        from bedrock_agentcore.tools.browser_client import BrowserClient

        return BrowserClient(self._region)

    async def open(self) -> Browser:
        client = self._new_client()
        await asyncio.to_thread(client.start, session_timeout_seconds=SESSION_TIMEOUT_S, viewport=VIEWPORT)
        self._clients.append(client)  # antes de conectar, para que close() la detenga aunque falle la conexión
        ws_url, headers = client.generate_ws_headers()
        browser = await self._playwright.chromium.connect_over_cdp(ws_url, headers=headers)
        self._browsers.append(browser)
        return browser

    async def close(self) -> None:
        for browser in self._browsers:
            try:
                await browser.close()
            except PlaywrightError:
                pass
        # Una sesión que no se detiene sigue cobrando hasta su tope de tiempo.
        await asyncio.gather(*(asyncio.to_thread(client.stop) for client in self._clients), return_exceptions=True)
