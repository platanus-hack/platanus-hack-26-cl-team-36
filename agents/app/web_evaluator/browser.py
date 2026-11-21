"""Conexión al navegador y sesión de navegación de un usuario sintético.

`open_browsers` es el único punto que decide qué navegador se usa: un Chromium
local (o remoto vía CDP) compartido por la tanda, o una sesión de AgentCore
Browser por usuario, sin tocar el resto del código.
"""

import asyncio
import base64
import json
import re
import time
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Dialog, Download, Page, Playwright, Response
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


# Reintentos de una captura que falla por un error del protocolo (no por tiempo): 2, esperando 0,5 s y luego 1 s.
SCREENSHOT_REINTENTOS = 2
SCREENSHOT_ESPERA_S = 0.5
SCREENSHOT_TIMEOUT_MS = 15_000  # después, la captura va por CDP (ver BrowserSession.screenshot)
SCREENSHOT_CDP_TIMEOUT_S = 10


TEMA_ESTILO_ID = "mt-tema-css"
TEMA_CLASE = "mi-tema"

# Aplica un tema como lo haría la extensión: la clase `mi-tema` en <html> y el CSS en un <style> propio. Corre al
# crear cada documento (antes que los scripts del sitio) y lo repone si el sitio reemplaza el <html> completo
# (document.open/write) o le pisa las clases: por eso observa `document`, que sobrevive, y lee
# `document.documentElement` cada vez en vez de guardar una referencia fija. Como la extensión, solo en el frame
# principal. `__CONFIG__` se reemplaza, una sola vez y al final, por un objeto JSON con el CSS, el id y la clase: así
# nada que venga dentro del CSS puede tocar el resto del script.
_TEMA_SCRIPT = r"""
(() => {
  if (window.top !== window || window.__mtTemaInstalado) return;
  window.__mtTemaInstalado = true;
  const { css: CSS, id: ID, clase: CLASE } = __CONFIG__;
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
    config_json = json.dumps({"css": css, "id": TEMA_ESTILO_ID, "clase": TEMA_CLASE})
    antes, despues = _TEMA_SCRIPT.split("__CONFIG__")
    return antes + config_json + despues


# Lo más grueso de lo que el saneamiento del diseñador (agents/app/web_designer/disenador/css.py) borra de un tema.
# Un tema con esto no salió del diseñador tal cual, así que el evaluador lo rechaza en vez de probar otra cosa. No es
# un filtro completo (no revisa el ámbito `html.mi-tema`), y la extensión hoy no filtra: inyecta el CSS tal cual.
_PROHIBIDO_EN_TEMA = {
    "url(": re.compile(r"url\s*\(", re.I),
    "image-set(": re.compile(r"image-set\s*\(", re.I),
    "@import": re.compile(r"@import", re.I),
    "expression(": re.compile(r"expression\s*\(", re.I),
    "javascript:": re.compile(r"javascript:", re.I),
    "barra invertida": re.compile(r"\\"),
}


def prohibido_en_tema(css: str) -> list[str]:
    """Lo prohibido que aparece en el CSS de un tema (lista vacía si no hay nada)."""
    return [nombre for nombre, patron in _PROHIBIDO_EN_TEMA.items() if patron.search(css)]


class NavegadorConTema:
    """Un navegador cuyos contextos nuevos llevan un tema: cada página lo aplica desde que se crea el documento.

    Envuelve a `Browser` para que el resto del código (`create_context`, el ciclo de cada usuario) no cambie: solo
    intercepta `new_context`; todo lo demás se delega al navegador real.
    """

    def __init__(self, browser: Browser, css: str):
        self._browser = browser
        self._script = script_de_tema(css)

    async def new_context(self, **options) -> BrowserContext:
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
        # La extensión inyecta con scripting.insertCSS, al que no le afecta la CSP de la página; el <style> del tema sí.
        # Se ignora la CSP en todas las tandas, con y sin tema, para que la única diferencia entre ellas sea el tema.
        "bypass_csp": True,
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
