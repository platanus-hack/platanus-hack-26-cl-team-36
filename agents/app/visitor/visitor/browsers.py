"""Navegadores de una tanda: `open_browsers` es el único punto que decide cuál se usa.

Un Chromium local (o remoto vía CDP) compartido por la tanda, o una sesión de AgentCore Browser por usuario
(`shared.browser.agentcore`).
"""

import asyncio

from playwright.async_api import Browser, Playwright

from shared.browser.agentcore import AgentCoreBrowsers
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


def open_browsers(playwright: Playwright, kind: str = "local", cdp_url: str | None = None):
    """Los navegadores de una tanda: `local` (Chromium o `cdp_url`) o `agentcore` (AgentCore Browser)."""
    if kind == "agentcore":
        return AgentCoreBrowsers(playwright, config.AWS_REGION)
    return SharedBrowser(playwright, cdp_url)
