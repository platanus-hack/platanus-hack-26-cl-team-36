"""Sesiones de AgentCore Browser: Playwright se conecta a cada una por CDP con encabezados firmados con AWS."""

import asyncio
import random

from playwright.async_api import Browser, Playwright
from playwright.async_api import Error as PlaywrightError

from shared import aws

VIEWPORT = {"width": 1280, "height": 800}   # la ventana; cada contexto fija su propia vista
SESSION_TIMEOUT_S = 1800
# La cuenta acepta 30 StartBrowserSession y 30 conexiones CDP por segundo, y una tanda abre todas sus sesiones a la vez
# (16 por objetivo, varios objetivos en paralelo): se abren de a pocas y un rechazo se reintenta con espera creciente.
OPEN_CONCURRENCY = 4
OPEN_ATTEMPTS = 5
OPEN_BACKOFF_S = 1.0


class AgentCoreBrowsers:
    """Una sesión por `open()`: cada sesión acepta una sola conexión de automatización."""

    def __init__(self, playwright: Playwright, region: str | None = None, client_factory=None):
        self._playwright = playwright
        self._region = region or aws.region()
        self._client_factory = client_factory
        self._clients = []
        self._browsers: list[Browser] = []
        self._opening = asyncio.Semaphore(OPEN_CONCURRENCY)

    def _new_client(self):
        if self._client_factory:
            return self._client_factory(self._region)
        from bedrock_agentcore.tools.browser_client import BrowserClient

        return BrowserClient(self._region)

    async def open(self) -> Browser:
        async with self._opening:
            for attempt in range(1, OPEN_ATTEMPTS + 1):
                try:
                    return await self._open_once()
                except Exception as error:   # ThrottlingException, cuota de sesiones o una conexión CDP rechazada
                    if attempt == OPEN_ATTEMPTS:
                        raise
                    wait = OPEN_BACKOFF_S * 2 ** (attempt - 1) * random.uniform(0.5, 1.5)
                    print(f"[agentcore] no se abrió la sesión ({type(error).__name__}: {error}); otra vez en"
                          f" {wait:.1f} s", flush=True)
                    await asyncio.sleep(wait)
        raise AssertionError("inalcanzable")

    async def _open_once(self) -> Browser:
        client = self._new_client()
        await asyncio.to_thread(client.start, session_timeout_seconds=SESSION_TIMEOUT_S, viewport=VIEWPORT)
        try:
            ws_url, headers = client.generate_ws_headers()
            browser = await self._playwright.chromium.connect_over_cdp(ws_url, headers=headers)
        except BaseException:
            # Una sesión que no se detiene sigue cobrando hasta su tope de tiempo.
            await asyncio.to_thread(client.stop)
            raise
        self._clients.append(client)
        self._browsers.append(browser)
        return browser

    async def release(self, browser: Browser) -> None:
        """Cierra un navegador y detiene su sesión apenas termina su intento, sin esperar al resto de la tanda."""
        if browser not in self._browsers:
            return
        index = self._browsers.index(browser)
        client = self._clients.pop(index)
        self._browsers.pop(index)
        try:
            await browser.close()
        except PlaywrightError:
            pass
        await asyncio.to_thread(client.stop)

    async def close(self) -> None:
        for browser in self._browsers:
            try:
                await browser.close()
            except PlaywrightError:
                pass
        # Una sesión que no se detiene sigue cobrando hasta su tope de tiempo.
        await asyncio.gather(*(asyncio.to_thread(client.stop) for client in self._clients), return_exceptions=True)
