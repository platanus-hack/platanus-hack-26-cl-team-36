"""Navegadores de una tanda: `open_browsers` es el único punto que decide cuál se usa.

Un Chromium local (o remoto vía CDP) compartido por la tanda, o una sesión de AgentCore Browser por usuario.
"""

import asyncio

from playwright.async_api import Browser, Playwright
from playwright.async_api import Error as PlaywrightError

from shared.browser.session import connect_browser

from visitor import config


class SharedBrowser:
    """Un solo Chromium, local o remoto por CDP, compartido por todos los usuarios de la tanda."""

    def __init__(self, playwright: Playwright, cdp_url: str | None = None):
        self._playwright = playwright
        self._cdp_url = cdp_url
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    async def open(self) -> Browser:
        async with self._lock:
            if self._browser is None:
                self._browser = await connect_browser(self._playwright, self._cdp_url)
        return self._browser

    async def close(self) -> None:
        if self._browser is not None:
            await self._browser.close()


class AgentCoreBrowsers:
    """Una sesión de AgentCore Browser por usuario: cada sesión acepta una sola conexión de automatización.

    Playwright se conecta a cada una por CDP con encabezados firmados con las credenciales de AWS del entorno.
    """

    def __init__(self, playwright: Playwright, region: str = config.AWS_REGION):
        self._playwright = playwright
        self._region = region
        self._clients = []
        self._browsers: list[Browser] = []

    async def open(self) -> Browser:
        from bedrock_agentcore.tools.browser_client import BrowserClient

        client = BrowserClient(self._region)
        await asyncio.to_thread(
            client.start,
            session_timeout_seconds=config.AGENTCORE_BROWSER_TIMEOUT_SECONDS,
            viewport=config.AGENTCORE_BROWSER_VIEWPORT,
        )
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


def open_browsers(playwright: Playwright, kind: str = "local", cdp_url: str | None = None):
    """Los navegadores de una tanda: `local` (Chromium o `cdp_url`) o `agentcore` (AgentCore Browser)."""
    if kind == "agentcore":
        return AgentCoreBrowsers(playwright)
    return SharedBrowser(playwright, cdp_url)
