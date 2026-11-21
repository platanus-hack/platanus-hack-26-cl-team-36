"""Conexión al navegador y sesión de navegación de un usuario sintético.

`connect_browser` es el único punto que decide qué navegador se usa: hoy un
Chromium local, mañana uno remoto vía CDP sin tocar el resto del código.
"""

import asyncio

from playwright.async_api import Browser, BrowserContext, Dialog, Page, Playwright, Response
from playwright.async_api import Error as PlaywrightError

import config
from profiles import Profile

MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

# Red de seguridad: cancela el envío de formularios POST o con campo de contraseña
# (login, pagos, formularios finales). El modelo solo ve que no pasa nada; el
# bloqueo queda registrado en window.__evaluatorBlockedForms para el log.
FORM_GUARD_SCRIPT = r"""
window.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const isPost = (form.getAttribute('method') || 'get').toLowerCase() === 'post';
  const hasPassword = !!form.querySelector('input[type=password]');
  if (isPost || hasPassword) {
    event.preventDefault();
    event.stopImmediatePropagation();
    (window.__evaluatorBlockedForms = window.__evaluatorBlockedForms || []).push(form.action || '(sin action)');
  }
}, true);
"""


async def connect_browser(playwright: Playwright, cdp_url: str | None = None) -> Browser:
    """Devuelve el navegador a usar. Con `cdp_url` se conecta a uno remoto."""
    if cdp_url:
        return await playwright.chromium.connect_over_cdp(cdp_url)
    return await playwright.chromium.launch(headless=True)


async def create_context(browser: Browser, profile: Profile) -> BrowserContext:
    """Contexto aislado (cookies, caché) con el viewport del perfil y escala 1:1."""
    options: dict = {
        "viewport": {"width": profile.width, "height": profile.height},
        "device_scale_factor": 1,  # un píxel de la captura = una coordenada de clic
        "locale": config.LOCALE,
        "timezone_id": config.TIMEZONE,
    }
    if profile.mobile:
        options.update(is_mobile=True, has_touch=True, user_agent=MOBILE_USER_AGENT)
    context = await browser.new_context(**options)
    await context.add_init_script(FORM_GUARD_SCRIPT)
    return context


class BrowserSession:
    """Página activa de un usuario. Sigue las pestañas nuevas y registra eventos."""

    def __init__(self, context: BrowserContext, profile: Profile):
        self.context = context
        self.profile = profile
        self.page: Page | None = None
        self.events: list[str] = []          # se vacía después de cada paso
        self.http_status: int | None = None  # último estado HTTP del documento principal

    async def open(self, url: str) -> None:
        page = await self.context.new_page()
        self._watch(page)
        self.page = page
        self.context.on("page", self._on_new_tab)
        await page.goto(url, wait_until="domcontentloaded", timeout=config.PAGE_LOAD_TIMEOUT_MS)
        await self.wait_until_settled()
        self.events.clear()

    def _watch(self, page: Page) -> None:
        page.on("dialog", self._on_dialog)
        page.on("response", lambda response, watched=page: self._on_response(watched, response))

    def _on_new_tab(self, page: Page) -> None:
        if page is self.page:
            return
        self._watch(page)
        self.page = page
        self.events.append("new_tab")

    async def _on_dialog(self, dialog: Dialog) -> None:
        self.events.append(f"dialog:{dialog.type}:{dialog.message[:80]}")
        try:
            await dialog.dismiss()
        except PlaywrightError:
            pass

    def _on_response(self, page: Page, response: Response) -> None:
        try:
            if response.request.is_navigation_request() and response.frame == page.main_frame:
                self.http_status = response.status
        except PlaywrightError:
            pass

    async def wait_until_settled(self) -> None:
        """Espera a que la página termine de reaccionar a la última acción."""
        await asyncio.sleep(0.4)
        for load_state, timeout_ms in (("domcontentloaded", 8_000), ("networkidle", 2_500)):
            try:
                await self.page.wait_for_load_state(load_state, timeout=timeout_ms)
            except PlaywrightError:
                pass
        await asyncio.sleep(0.2)

    async def screenshot(self) -> bytes:
        """Captura solo del viewport, nunca de la página completa."""
        return await self.page.screenshot(type="png", full_page=False, timeout=15_000)

    async def url_and_title(self) -> tuple[str, str]:
        url = self.page.url
        try:
            title = await self.page.title()
        except PlaywrightError:
            title = ""
        return url, title.strip()
