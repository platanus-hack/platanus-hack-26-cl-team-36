"""Tema de un sitio como lo aplica la extensión: CSS bajo `html.mi-tema`, lo que no puede traer y el navegador que lo
pone en cada página."""

import hashlib
import json
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # el resumen del sitio lee temas sin instalar Playwright
    from playwright.async_api import Browser, BrowserContext


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
# Un tema con esto no salió del diseñador tal cual, así que el Visitante lo rechaza en vez de probar otra cosa. No es
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

    def __init__(self, browser: "Browser", css: str):
        self._browser = browser
        self._script = script_de_tema(css)

    async def new_context(self, **options) -> "BrowserContext":
        context = await self._browser.new_context(**options)
        await context.add_init_script(self._script)
        return context

    def __getattr__(self, name: str):
        return getattr(self._browser, name)


class TemaInvalido(ValueError):
    pass


def describir_tema(css_path: Path) -> tuple[str, dict]:
    """El CSS de un tema y cómo se registra en la tanda: archivo, sha256 corto y tamaño.

    Lanza TemaInvalido si el CSS trae algo que el filtro de la extensión borraría (`url(`, `@import`, barra
    invertida...): la tanda no mediría el tema que vería una persona.
    """
    contenido = css_path.read_bytes()
    prohibido = prohibido_en_tema(contenido.decode("utf-8"))
    if prohibido:
        raise TemaInvalido(
            f"el tema {css_path.name} trae {', '.join(prohibido)}, que la extensión filtra; quítalo antes de evaluarlo"
        )
    datos = {
        "archivo": css_path.name,
        "sha256": hashlib.sha256(contenido).hexdigest()[:12],
        "bytes": len(contenido),
    }
    return contenido.decode("utf-8"), datos
