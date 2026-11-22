"""Tema de un sitio como lo aplica la extensión: CSS bajo `html.mi-tema`, lo que no puede traer y el navegador que lo
pone en cada página. Con un kit (`tema.json`), además los componentes JS de la extensión y sus features."""

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


# Los content scripts que usan `browser.*` (storage, mensajes al background): sin la extensión no corren. El motor lo
# reemplaza `_MOTOR_SCRIPT`; la captura, la transición del botón y sus efectos no cambian lo que ve el usuario.
_SOLO_CON_EXTENSION = {"content/captura.js", "content/transicion.js", "comun/efectos.js", "content/motor.js",
                       "content/transicion.css"}

# Lo que hace content/motor.js con un tema ya resuelto: llama `actualizar(opciones)` de cada feature y lo repite ante
# cambios del DOM, agrupados por requestAnimationFrame. `__FEATURES__` se reemplaza por el JSON de `features`.
_MOTOR_SCRIPT = r"""
(() => {
  const FEATURES = __FEATURES__;
  function refrescar() {
    for (const [id, opciones] of Object.entries(FEATURES)) {
      try {
        MiTema.features.get(id)?.actualizar(opciones);
      } catch (error) {
        console.error(`[mi-tema] Error en la feature "${id}":`, error);
      }
    }
  }
  let pendiente = false;
  new MutationObserver(() => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      refrescar();
    });
  }).observe(document, { childList: true, subtree: true });
  refrescar();
})();
"""


def script_de_kit(tema_json: Path, css_tema: str) -> str:
    """El script que monta un kit como la extensión: el tema (CSS de los componentes y `css_tema`), los content scripts
    del manifest que no usan `browser.*`, en su orden, y las features de `tema_json`. Solo en el frame principal."""
    src = next(carpeta for carpeta in tema_json.parents if (carpeta / "manifest.json").is_file())
    contenido = json.loads((src / "manifest.json").read_text(encoding="utf-8"))["content_scripts"][0]

    def leer(tipo: str) -> list[str]:
        return [(src / ruta).read_text(encoding="utf-8") for ruta in contenido[tipo] if ruta not in _SOLO_CON_EXTENSION]

    css = "\n".join([*leer("css"), css_tema])
    scripts = ";\n".join(leer("js"))
    features = json.dumps(json.loads(tema_json.read_text(encoding="utf-8"))["features"])
    antes, despues = _MOTOR_SCRIPT.split("__FEATURES__")
    return (script_de_tema(css) + "\nif (window.top === window && !window.__mtKitInstalado) {\n"
            "window.__mtKitInstalado = true;\n" + scripts + ";\n" + antes + features + despues + "}\n")


class NavegadorConTema:
    """Un navegador cuyos contextos nuevos llevan un tema: cada página corre `script` (de `script_de_tema` o
    `script_de_kit`) desde que se crea el documento.

    Envuelve a `Browser` para que el resto del código (`create_context`, el ciclo de cada usuario) no cambie: solo
    intercepta `new_context`; todo lo demás se delega al navegador real.
    """

    def __init__(self, browser: "Browser", script: str):
        self._browser = browser
        self._script = script

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


def describir_kit(tema_json: Path) -> tuple[str, dict]:
    """El script de un kit (`tema_json` y el `tema.css` de su carpeta) y cómo se registra en la tanda: como un tema,
    con el sha256 corto del script completo (cambia si cambia un componente) y `kit: true`.

    Lanza TemaInvalido si el `tema.css` trae algo que el filtro de la extensión borraría.
    """
    css, _ = describir_tema(tema_json.with_name("tema.css"))
    script = script_de_kit(tema_json, css)
    datos = {
        "archivo": tema_json.name,
        "sha256": hashlib.sha256(script.encode()).hexdigest()[:12],
        "bytes": len(script.encode()),
        "kit": True,
    }
    return script, datos
