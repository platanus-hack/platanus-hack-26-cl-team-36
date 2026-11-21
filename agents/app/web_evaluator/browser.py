"""Conexión al navegador y sesión de navegación de un usuario sintético.

`open_browsers` es el único punto que decide qué navegador se usa: un Chromium
local (o remoto vía CDP) compartido por la tanda, o una sesión de AgentCore
Browser por usuario, sin tocar el resto del código.
"""

import asyncio
import json
import time
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Dialog, Page, Playwright, Response
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

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


TEMA_ESTILO_ID = "mt-tema-css"
TEMA_CLASE = "mi-tema"

# Aplica un tema como lo haría la extensión: la clase `mi-tema` en <html> y el CSS en un <style> propio. Corre al
# crear cada documento (antes que los scripts del sitio) y lo repone si el sitio reemplaza el <html> completo
# (document.open/write) o le pisa las clases: por eso observa `document`, que sobrevive, y lee
# `document.documentElement` cada vez en vez de guardar una referencia fija. Como la extensión, solo en el frame
# principal. `__CSS__` se reemplaza por el CSS como literal JSON.
_TEMA_SCRIPT = r"""
(() => {
  if (window.top !== window || window.__mtTemaInstalado) return;
  window.__mtTemaInstalado = true;
  const CSS = __CSS__;
  const ID = __ID__;
  const CLASE = __CLASE__;
  let htmlObservado = null;
  const observadorDeClases = new MutationObserver(() => reponer());

  function reponer() {
    const html = document.documentElement;
    if (!html) return;
    if (!html.classList.contains(CLASE)) html.classList.add(CLASE);
    let estilo = document.getElementById(ID);
    if (!estilo) {
      estilo = document.createElement("style");
      estilo.id = ID;
      estilo.textContent = CSS;
      (document.head || html).appendChild(estilo);
    }
    if (html !== htmlObservado) {
      observadorDeClases.disconnect();
      observadorDeClases.observe(html, { attributes: true, attributeFilter: ["class"] });
      htmlObservado = html;
    }
  }

  // childList + subtree sobre document: ve un <html> nuevo, un <head> reemplazado o el <style> quitado.
  new MutationObserver(() => reponer()).observe(document, { childList: true, subtree: true });
  reponer();
})();
"""


def script_de_tema(css: str) -> str:
    """El script que aplica `css` como tema en cada documento del frame principal (ver `_TEMA_SCRIPT`)."""
    return (
        _TEMA_SCRIPT.replace("__CSS__", json.dumps(css))
        .replace("__ID__", json.dumps(TEMA_ESTILO_ID))
        .replace("__CLASE__", json.dumps(TEMA_CLASE))
    )


class NavegadorConTema:
    """Un navegador cuyos contextos nuevos llevan un tema: cada página lo aplica desde que se crea el documento.

    Envuelve a `Browser` para que el resto del código (`create_context`, el ciclo de cada usuario) no cambie: solo
    intercepta `new_context`; todo lo demás se delega al navegador real.
    """

    def __init__(self, browser: Browser, css: str):
        self._browser = browser
        self._script = script_de_tema(css)

    async def new_context(self, **options) -> BrowserContext:
        # La extensión inyecta con scripting.insertCSS, al que no le afecta la CSP de la página; un <style> sí.
        options.setdefault("bypass_csp", True)
        context = await self._browser.new_context(**options)
        await context.add_init_script(self._script)
        return context

    def __getattr__(self, name: str):
        return getattr(self._browser, name)


async def connect_browser(playwright: Playwright, cdp_url: str | None = None) -> Browser:
    """Devuelve el navegador a usar. Con `cdp_url` se conecta a uno remoto."""
    if cdp_url:
        return await playwright.chromium.connect_over_cdp(cdp_url)
    return await playwright.chromium.launch(headless=True)


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


async def create_context(browser: Browser, profile: Profile, video_dir: Path | None = None) -> BrowserContext:
    """Contexto aislado (cookies, caché) con el viewport del perfil y escala 1:1.

    Con `video_dir`, Playwright graba un video .webm por pestaña, al tamaño del viewport.
    Los archivos recién quedan escritos al cerrar el contexto: ver `BrowserSession.save_videos`.
    """
    options: dict = {
        "viewport": {"width": profile.width, "height": profile.height},
        "device_scale_factor": 1,  # un píxel de la captura = una coordenada de clic
        "locale": config.LOCALE,
        "timezone_id": config.TIMEZONE,
    }
    if profile.mobile:
        options.update(is_mobile=True, has_touch=True, user_agent=MOBILE_USER_AGENT)
    if video_dir is not None:
        options.update(
            record_video_dir=str(video_dir),
            record_video_size={"width": profile.width, "height": profile.height},
        )
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
        self.pages: list[Page] = []          # todas las pestañas, en orden de apertura (una por video)
        self.opened_at: float | None = None  # time.monotonic() al abrir la primera pestaña: el 0:00 del video

    async def open(self, url: str) -> None:
        self.opened_at = time.monotonic()  # Playwright empieza a grabar al crear la página
        page = await self.context.new_page()
        self._watch(page)
        self.page = page
        self.context.on("page", self._on_new_tab)
        # La carga inicial puede fallar por red transitoria: se reintenta antes de dar el intento por perdido.
        for attempt in range(1, config.PAGE_LOAD_ATTEMPTS + 1):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=config.PAGE_LOAD_TIMEOUT_MS)
                break
            except PlaywrightTimeoutError:
                if attempt == config.PAGE_LOAD_ATTEMPTS:
                    raise
                await asyncio.sleep(2)
        await self.wait_until_settled()
        self.events.clear()

    def _watch(self, page: Page) -> None:
        self.pages.append(page)
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
