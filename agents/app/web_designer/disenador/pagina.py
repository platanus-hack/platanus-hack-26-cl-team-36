"""La página en Playwright: abrirla en escritorio o móvil, aplicar o apagar el tema, capturarla y verificar el CSS."""

import asyncio

from playwright.async_api import Browser, BrowserContext, Page
from playwright.async_api import Error as PlaywrightError

from shared.browser.session import MOBILE_USER_AGENT
from shared.browser.theme import TEMA_CLASE, TEMA_ESTILO_ID

from disenador import config

VIEWPORTS = {"escritorio": config.ESCRITORIO, "movil": config.MOVIL}

# Aplica el tema en la página ya cargada, como la extensión: clase `mi-tema` en <html> y un <style> propio al final
# del <head>. A diferencia de `shared.browser.theme`, no lo repone si el sitio lo quita: aquí hay que poder apagarlo.
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


# Lee el CSS con el parser de Chromium, en un documento inerte (sin red: `@import` y `url()` no se cargan), y recorre
# sus reglas. Cada regla de estilo de primer nivel debe empezar por `html.mi-tema` en cada selector de la lista; una
# anidada, por `&` (Chromium escribe `& .b` para la relativa `.b`). Solo se aceptan los tipos de regla del
# saneamiento (sin `@layer`, y `@keyframes` solo con nombre `mt-*`), y ningún texto puede cargar recursos.
_VERIFICAR = r"""(css) => {
  const doc = document.implementation.createHTMLDocument("");
  const estilo = doc.createElement("style");
  estilo.textContent = css;
  doc.head.appendChild(estilo);
  const TIPOS = new Set(["CSSStyleRule", "CSSMediaRule", "CSSSupportsRule", "CSSContainerRule", "CSSKeyframesRule",
    "CSSKeyframeRule", "CSSNestedDeclarations"]);
  const PELIGROSO = /url\s*\(|(?<![\w-])src\s*\(|(?<![\w-])(?:-webkit-)?image(?:-set)?\s*\(|@import|expression\s*\(|javascript\s*:|-moz-binding|(?<![\w-])behavior\s*:/i;
  const AMBITO = /^html\.mi-tema(?![\w-])/;
  const partes = (lista) => {
    const salida = [];
    let profundidad = 0, comilla = null, actual = "";
    for (const c of lista) {
      if (comilla) { if (c === comilla) comilla = null; }
      else if (c === '"' || c === "'") comilla = c;
      else if (c === "(" || c === "[") profundidad++;
      else if (c === ")" || c === "]") profundidad--;
      else if (c === "," && profundidad === 0) { salida.push(actual.trim()); actual = ""; continue; }
      actual += c;
    }
    salida.push(actual.trim());
    return salida.filter(Boolean);
  };
  const violaciones = [];
  const agregar = (motivo, regla) => violaciones.push({ motivo, texto: regla.cssText.replace(/\s+/g, " ").slice(0, 160) });
  const recorrer = (reglas, anidada) => {
    for (const regla of reglas) {
      const tipo = regla.constructor.name;
      if (!TIPOS.has(tipo)) { agregar(`regla ${tipo} no permitida`, regla); continue; }
      if (tipo === "CSSKeyframesRule" && !/^mt-[\w-]+$/.test(regla.name)) {
        agregar(`@keyframes sin el prefijo mt-: ${regla.name}`, regla);
        continue;
      }
      if (tipo === "CSSStyleRule") {
        const fuera = partes(regla.selectorText).filter((p) => (anidada ? !p.startsWith("&") : !AMBITO.test(p)));
        if (fuera.length) agregar(`selector fuera de html.mi-tema: ${fuera.join(", ")}`, regla);
      }
      // El texto propio: declaraciones y selector, o el preludio de una at-regla.
      const propio = regla.style ? `${regla.selectorText || regla.keyText || ""} { ${regla.style.cssText} }`
        : regla.cssText.split("{")[0];
      if (PELIGROSO.test(propio)) agregar("carga recursos o ejecuta código", regla);
      if (regla.cssRules) recorrer(regla.cssRules, anidada || tipo === "CSSStyleRule");
    }
  };
  recorrer(estilo.sheet.cssRules, false);
  return violaciones;
}"""


async def verificar_css(browser: Browser, css: str) -> list[dict]:
    """Lo que el parser de Chromium ve en el CSS y el saneamiento no debió dejar pasar: [{motivo, texto}]."""
    contexto = await browser.new_context()
    try:
        page = await contexto.new_page()
        return await page.evaluate(_VERIFICAR, css)
    finally:
        await contexto.close()
