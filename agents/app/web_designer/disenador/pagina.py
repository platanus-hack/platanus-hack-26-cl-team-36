"""La página en Playwright: abrirla en escritorio o móvil, aplicar o apagar el tema y capturarla."""

import asyncio

from playwright.async_api import Browser, BrowserContext, Page
from playwright.async_api import Error as PlaywrightError

from browser import MOBILE_USER_AGENT, TEMA_CLASE, TEMA_ESTILO_ID
from disenador import config

VIEWPORTS = {"escritorio": config.ESCRITORIO, "movil": config.MOVIL}

# Aplica el tema en la página ya cargada, como la extensión: clase `mi-tema` en <html> y un <style> propio al final
# del <head>. A diferencia del script del evaluador, no lo repone si el sitio lo quita: aquí hay que poder apagarlo.
_APLICAR = """([css, id, clase]) => {
  document.getElementById(id)?.remove();
  const estilo = document.createElement("style");
  estilo.id = id;
  estilo.textContent = css;
  (document.head || document.documentElement).appendChild(estilo);
  document.documentElement.classList.add(clase);
}"""


async def nuevo_contexto(browser: Browser, viewport: str) -> BrowserContext:
    """Un contexto aislado. `bypass_csp`: la extensión inyecta con scripting.insertCSS, que la CSP no bloquea."""
    opciones: dict = {
        "viewport": VIEWPORTS[viewport],
        "device_scale_factor": 1,
        "locale": config.LOCALE,
        "timezone_id": config.TIMEZONE,
        "bypass_csp": True,
    }
    if viewport == "movil":
        opciones.update(is_mobile=True, has_touch=True, user_agent=MOBILE_USER_AGENT)
    return await browser.new_context(**opciones)


async def esperar(page: Page, segundos: float = 0.4) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=config.ESPERA_RED_MS)
    except PlaywrightError:
        pass
    try:
        await page.evaluate(
            "() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))"
        )
    except PlaywrightError:
        pass
    await asyncio.sleep(segundos)


async def abrir(browser: Browser, url: str, viewport: str) -> tuple[BrowserContext, Page]:
    contexto = await nuevo_contexto(browser, viewport)
    pagina = await contexto.new_page()
    try:
        await pagina.goto(url, wait_until="domcontentloaded", timeout=config.CARGA_TIMEOUT_MS)
    except Exception:
        await contexto.close()
        raise
    await esperar(pagina, 1.0)
    return contexto, pagina


async def aplicar_tema(page: Page, css: str) -> None:
    await page.evaluate(_APLICAR, [css, TEMA_ESTILO_ID, TEMA_CLASE])
    await esperar(page, config.ESPERA_TEMA_S)


async def poner_clase(page: Page, activa: bool) -> None:
    """Prende o apaga el tema como el botón de la extensión: solo la clase; el <style> queda."""
    await page.evaluate(
        "([clase, activa]) => document.documentElement.classList.toggle(clase, activa)", [TEMA_CLASE, activa]
    )
    await esperar(page, config.ESPERA_TEMA_S)


async def quitar_tema(page: Page) -> None:
    """Saca el <style> del tema y la clase: la página como si nunca se hubiera aplicado, en este momento."""
    await page.evaluate(
        "([id, clase]) => { document.getElementById(id)?.remove(); document.documentElement.classList.remove(clase); }",
        [TEMA_ESTILO_ID, TEMA_CLASE],
    )
    await esperar(page, config.ESPERA_TEMA_S)


async def capturar(page: Page) -> bytes:
    """El viewport, sin animaciones ni cursor, para comparar antes y después."""
    return await page.screenshot(type="png", full_page=False, animations="disabled", caret="hide", timeout=20_000)
