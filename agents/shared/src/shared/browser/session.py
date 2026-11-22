"""Navegador, contexto aislado con la red de seguridad de formularios y sesión de navegación de una pestaña."""

import asyncio
import base64
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Dialog, Download, Page, Playwright, Response, async_playwright
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from shared.browser.viewports import Screen

LOCALE = "es-CL"
TIMEZONE = "America/Santiago"
PAGE_LOAD_TIMEOUT_MS = 30_000
PAGE_LOAD_ATTEMPTS = 2       # intentos de carga inicial antes de dar la sesión por perdida

MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)

# Red de seguridad: cancela el envío de formularios POST o con campo de contraseña
# (login, pagos, formularios finales). El modelo solo ve que no pasa nada; el
# bloqueo queda registrado en window.__blockedForms para el log.
FORM_GUARD_SCRIPT = r"""
window.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const isPost = (form.getAttribute('method') || 'get').toLowerCase() === 'post';
  const hasPassword = !!form.querySelector('input[type=password]');
  if (isPost || hasPassword) {
    event.preventDefault();
    event.stopImmediatePropagation();
    (window.__blockedForms = window.__blockedForms || []).push(form.action || '(sin action)');
  }
}, true);
"""


# Reintentos de una captura que falla por un error del protocolo (no por tiempo): 2, esperando 0,5 s y luego 1 s.
SCREENSHOT_REINTENTOS = 2
SCREENSHOT_ESPERA_S = 0.5
SCREENSHOT_TIMEOUT_MS = 15_000  # después, la captura va por CDP (ver BrowserSession.screenshot)
SCREENSHOT_CDP_TIMEOUT_S = 10


async def connect_browser(playwright: Playwright, cdp_url: str | None = None) -> Browser:
    """Devuelve el navegador a usar. Con `cdp_url` se conecta a uno remoto."""
    if cdp_url:
        return await playwright.chromium.connect_over_cdp(cdp_url)
    return await playwright.chromium.launch(headless=True)


@asynccontextmanager
async def open_browser(cdp_url: str | None = None) -> AsyncIterator[Browser]:
    async with async_playwright() as playwright:
        browser = await connect_browser(playwright, cdp_url)
        try:
            yield browser
        finally:
            await browser.close()


async def blocked_form_count(page: Page) -> int:
    """Envíos que la red de seguridad canceló en la página."""
    try:
        return int(await page.evaluate("() => (window.__blockedForms || []).length"))
    except PlaywrightError:
        return 0


async def create_context(browser: Browser, screen: Screen, video_dir: Path | None = None) -> BrowserContext:
    """Contexto aislado (cookies, caché) con el viewport de `screen` y escala 1:1.

    Con `video_dir`, Playwright graba un video .webm por pestaña, al tamaño del viewport.
    Los archivos recién quedan escritos al cerrar el contexto: ver `BrowserSession.save_videos`.
    """
    options: dict = {
        "viewport": {"width": screen.width, "height": screen.height},
        "device_scale_factor": 1,  # un píxel de la captura = una coordenada de clic
        "locale": LOCALE,
        "timezone_id": TIMEZONE,
        # La extensión inyecta con scripting.insertCSS, al que no le afecta la CSP de la página; el <style> del tema sí.
        # Se ignora la CSP en todas las tandas, con y sin tema, para que la única diferencia entre ellas sea el tema.
        "bypass_csp": True,
    }
    if screen.mobile:
        options.update(is_mobile=True, has_touch=True, user_agent=MOBILE_USER_AGENT)
    if video_dir is not None:
        options.update(
            record_video_dir=str(video_dir),
            record_video_size={"width": screen.width, "height": screen.height},
        )
    context = await browser.new_context(**options)
    await context.add_init_script(FORM_GUARD_SCRIPT)
    return context


class BrowserSession:
    """Página activa de una sesión. Sigue las pestañas nuevas y registra eventos."""

    def __init__(self, context: BrowserContext, screen: Screen):
        self.context = context
        self.screen = screen
        self.page: Page | None = None
        self.events: list[str] = []          # se vacía después de cada paso
        self.http_status: int | None = None  # último estado HTTP del documento principal
        self.pages: list[Page] = []          # todas las pestañas, en orden de apertura (una por video)
        self.opened_at: float | None = None  # time.monotonic() al abrir la primera pestaña: el 0:00 del video

    async def open(self, url: str) -> None:
        self.opened_at = time.monotonic()  # Playwright empieza a grabar al crear la página
        page = await self.context.new_page()
        self._watch(page)
        self.page = page
        self.context.on("page", self._on_new_tab)
        # La carga inicial puede fallar por red transitoria: se reintenta antes de darla por perdida.
        for attempt in range(1, PAGE_LOAD_ATTEMPTS + 1):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT_MS)
                break
            except PlaywrightTimeoutError:
                if attempt == PAGE_LOAD_ATTEMPTS:
                    raise
                await asyncio.sleep(2)
        await self.wait_until_settled()
        self.events.clear()

    def _watch(self, page: Page) -> None:
        self.pages.append(page)
        page.on("dialog", self._on_dialog)
        page.on("download", self._on_download)
        page.on("response", lambda response, watched=page: self._on_response(watched, response))

    def _on_new_tab(self, page: Page) -> None:
        if page is self.page:
            return
        self._watch(page)
        self.page = page
        self.events.append("new_tab")

    def _on_download(self, download: Download) -> None:
        self.events.append(f"download:{download.url[:200]}")

    async def _cerrar_pestana_de_descarga(self) -> None:
        """Un enlace con target=_blank a un archivo (un PDF, por ejemplo) abre una pestaña que solo descarga: queda en
        blanco y no se puede capturar (Playwright y CDP se cuelgan). Se cierra y el usuario sigue en la anterior,
        como en un navegador de escritorio, donde la descarga va a la barra de descargas."""
        if len(self.pages) < 2 or self.page.url not in ("", "about:blank"):
            return
        if not any(event.startswith("download:") for event in self.events):
            return
        cerrada = self.page
        abiertas = [page for page in self.pages if page is not cerrada and not page.is_closed()]
        if not abiertas:
            return
        self.page = abiertas[-1]
        self.events.append("download_tab_closed")
        try:
            await cerrada.close()
        except PlaywrightError:
            pass

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
        await self._cerrar_pestana_de_descarga()
        for load_state, timeout_ms in (("domcontentloaded", 8_000), ("networkidle", 2_500)):
            try:
                await self.page.wait_for_load_state(load_state, timeout=timeout_ms)
            except PlaywrightError:
                pass
        await asyncio.sleep(0.2)

    async def screenshot(self) -> bytes:
        """Captura solo del viewport, nunca de la página completa.

        Dos fallas intermitentes de Chromium no deben cortar el intento como error interno:
        - `Unable to capture screenshot` mientras la página se está pintando (una navegación o una animación a medio
          camino): se reintenta 2 veces con una espera corta.
        - Playwright espera `document.fonts.ready` antes de capturar, y con varios usuarios cargando el mismo sitio una
          fuente puede no terminar nunca (se vio en bibliotecanacional.gob.cl): tras su timeout se captura directo por
          CDP, sin esa espera.
        """
        for intento in range(1 + SCREENSHOT_REINTENTOS):
            try:
                return await self.page.screenshot(type="png", full_page=False, timeout=SCREENSHOT_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                return await self._captura_por_cdp()
            except PlaywrightError:
                if intento == SCREENSHOT_REINTENTOS:
                    raise
                await asyncio.sleep(SCREENSHOT_ESPERA_S * (intento + 1))
        raise AssertionError("inalcanzable")

    async def _captura_por_cdp(self) -> bytes:
        """El viewport por `Page.captureScreenshot`, que no espera las fuentes. Solo en Chromium."""
        cdp = await self.context.new_cdp_session(self.page)
        try:
            respuesta = await asyncio.wait_for(
                cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False}),
                timeout=SCREENSHOT_CDP_TIMEOUT_S,
            )
        except TimeoutError:
            raise PlaywrightTimeoutError("la captura no respondió ni por Playwright ni por CDP") from None
        finally:
            await cdp.detach()
        return base64.b64decode(respuesta["data"])

    async def save_videos(self, run_dir: Path, incidents: list[str]) -> list[str]:
        """Deja el video de cada pestaña como video.webm, video-2.webm... Llamar tras cerrar el contexto.

        El número es el orden de la pestaña: video.webm es siempre la primera, la que siguen los minutos del reporte.
        Un video que no se pudo guardar queda anotado en `incidents`.
        """
        names: list[str] = []
        for number, page in enumerate(self.pages, start=1):
            if page.video is None:
                continue
            name = "video.webm" if number == 1 else f"video-{number}.webm"
            try:
                source = Path(await page.video.path())
                source.replace(run_dir / name)
            except Exception:
                try:  # navegador remoto: el archivo no está en este disco y hay que descargarlo
                    await page.video.save_as(run_dir / name)
                except Exception as error:
                    incidents.append(f"no se pudo guardar {name}: {type(error).__name__}: {error}"[:300])
                    continue
            names.append(name)
        return names

    async def url_and_title(self) -> tuple[str, str]:
        url = self.page.url
        try:
            title = await self.page.title()
        except PlaywrightError:
            title = ""
        return url, title.strip()
