"""La voz del sitio en el kit: cada título, etiqueta y botón sale del texto que la página ya usa (encabezados, etiquetas
de formularios, botones, textos del menú) o del objetivo del catálogo, no de frases genéricas de «app».

Sin modelo: `de_la_pagina` junta ese vocabulario por componente (lo recibe el modelo en el diagnóstico), `con_voz`
pone en lo derivado los textos del sitio y `verificar` revisa lo que propuso el modelo con una lista acotada de clichés
(`CLICHES`, en es y en) y un anclaje léxico: un título debe compartir al menos una palabra con contenido con la página
o con un objetivo del catálogo. Lo que falla vuelve al texto del sitio, al título derivado del objetivo o, si no hay
ninguno, se quita (el componente queda sin titular), y cada reemplazo queda con su razón.
"""

import re
import unicodedata
from urllib.parse import urlsplit

from disenador import atajos

# La página: títulos de sección (también los que no son <h*>, como `.card-title`), el menú completo (también lo que
# está plegado en un desplegable) y los botones visibles.
VOZ_JS = r"""() => {
  const limpio = (t, max) => (t || "").replace(/\s+/g, " ").trim().slice(0, max);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const titulos = [...document.querySelectorAll(
    "h1, h2, h3, h4, legend, [role=heading], [class*=title], [class*=titulo]")]
    .filter((el) => !el.closest("script, style, template"))
    .map((el) => limpio(el.textContent, 80)).filter((t) => t && t.length <= 70);
  const menu = [];
  const vistos = new Set();
  for (const a of document.querySelectorAll("header a[href], nav a[href], [role=navigation] a[href], [role=banner] a[href]")) {
    if (menu.length >= 150) break;
    const texto = limpio(a.textContent || a.getAttribute("aria-label"), 60);
    let url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch { continue; }
    if (!texto || url.origin !== location.origin || vistos.has(url.pathname)) continue;
    vistos.add(url.pathname);
    menu.push({ texto, href: url.pathname });
  }
  const botones = [...document.querySelectorAll("button, [role=button], input[type=submit]")].filter(visible)
    .map((b) => limpio(b.tagName === "INPUT" ? b.value : b.textContent || b.getAttribute("aria-label"), 40))
    .filter(Boolean);
  return { titulo: limpio(document.title, 120), titulos: [...new Set(titulos)].slice(0, 40), menu,
           botones: [...new Set(botones)].slice(0, 20) };
}"""

_PREGUNTA_ES = (r"(?:¿|^\s*(?=qu[eé]|a?\s*d[oó]nde|c[oó]mo|cu[aá]l))[^?]*"
                r"\b(?:vas|vienes|quieres|necesitas|buscas|deseas|te\s+gustar[ií]a)\b[^?]*\?")
_PREGUNTA_EN = r"\b(?:what|where|how)\b[^?]*\byou\b[^?]*\?|^\s*where\s+to\s*\?"
CLICHES = tuple((razon, re.compile(patron, re.I)) for razon, patron in (
    ("pregunta retórica a la persona", _PREGUNTA_ES),
    ("pregunta retórica a la persona", _PREGUNTA_EN),
    ("«Lo más buscado»", r"\blo\s+m[aá]s\s+(?:buscado|popular|visto)|\bmost\s+(?:wanted|popular|searched)\b"),
    ("«Accesos rápidos»", r"\baccesos?\s+r[aá]pidos?\b|\bquick\s+(?:links|access)\b"),
    ("«Todo lo que necesitas»", r"\btodo\s+lo\s+que\s+necesitas\b|\beverything\s+you\s+need\b"),
    ("frase de app", r"\batajos?\s+a\s+lo\s+que\b|\bshortcuts?\s+to\s+what\b|\bve\s+directo\s+a\b"
                     r"|\bgo\s+straight\s+to\b|\bte\s+llevamos\b|\bwe(?:'ll|\s+will)?\s+take\s+you\b"),
    ("emoji", "[\U0001F300-\U0001FAFF☀-➿⭐⬆↔-↪️]"),
))

_VACIAS = atajos._ENLACES | {
    "aqui", "algo", "cada", "este", "esta", "estos", "estas", "hacer", "mas", "muy", "nuestro", "nuestra", "otro",
    "otra", "puedes", "solo", "tambien", "todo", "toda", "usted", "ver", "vez", "and", "are", "can", "for", "from",
    "here", "how", "into", "more", "our", "the", "this", "what", "where", "with", "you", "your"}
_RAIZ = 5


def cliche(texto: str | None) -> str | None:
    """La razón por la que `texto` es una frase genérica, o None."""
    texto = str(texto or "")
    return next((razon for razon, patron in CLICHES if patron.search(texto)), None)


def raices(texto: str | None) -> set[str]:
    """Las palabras con contenido de `texto` (sin acentos, mayúsculas ni palabras vacías), por sus primeras letras:
    «Planifica» y «Planificador» comparten raíz."""
    plano = unicodedata.normalize("NFD", str(texto or "")).encode("ascii", "ignore").decode().lower()
    return {p[:_RAIZ] for p in re.findall(r"[a-z0-9]+", plano) if len(p) >= 3 and p not in _VACIAS}


def anclado(texto: str | None, vocabulario: set[str]) -> bool:
    return bool(raices(texto) & vocabulario)


def _ruta(enlace: str) -> str:
    return urlsplit(enlace).path.rstrip("/") or "/"


def de_la_pagina(pagina: dict, selects: list, kit: dict, catalogo: list) -> dict:
    """La voz del sitio para el diagnóstico: los textos de la página y, por componente, los que le corresponden
    (atajo: el título de su sección, el botón de envío y la etiqueta u opción vacía de cada campo; lanzador y buscador:
    el texto del menú de cada enlace)."""
    menu = {_ruta(m["href"]): m["texto"] for m in pagina.get("menu") or [] if m.get("texto") and m.get("href")}
    por_selector = {s.selector: s for s in selects}
    descripciones = {g.id: g.description for g in catalogo}
    componentes = {}
    for atajo in kit["atajos"]:
        vista = atajo["vista"]
        campos = [(c["nombre"], por_selector.get(c.get("opciones"))) for c in vista["datos"]]
        primero = next((s for _, s in campos if s), None)
        componentes[vista["id"]] = {
            "seccion": primero.seccion if primero else "", "boton": primero.boton if primero else "",
            "campos": [{"nombre": n, "etiqueta": s.etiqueta, "vacia": s.vacia} for n, s in campos if s],
            "objetivo": descripciones.get(atajo["objetivo"], ""),
        }
    for vista in (kit["lanzador"], kit["buscador"]):
        if vista:
            tareas = {t["enlace"]: menu[_ruta(t["enlace"])] for t in vista["datos"] if _ruta(t["enlace"]) in menu}
            componentes[vista["id"]] = {"tareas": tareas}
    return {"titulo": pagina.get("titulo", ""), "titulos": pagina.get("titulos") or [],
            "menu": list(dict.fromkeys(menu.values()))[:60], "botones": pagina.get("botones") or [],
            "componentes": componentes}


def vocabulario(voz: dict, catalogo: list) -> set[str]:
    """Las raíces con las que se ancla un título: la página, lo leído para cada componente y los objetivos (su
    descripción y las palabras de la ruta de su `entry`, como «estado-red»)."""
    textos = [voz.get("titulo"), *voz.get("titulos", []), *voz.get("menu", []), *voz.get("botones", [])]
    for comp in voz.get("componentes", {}).values():
        textos += [comp.get("seccion"), comp.get("objetivo"), *comp.get("tareas", {}).values()]
        textos += [c.get(k) for c in comp.get("campos", []) for k in ("etiqueta", "vacia")]
    textos += [t for g in catalogo for t in (g.description, urlsplit(g.entry or "").path)]
    return set().union(*(raices(t) for t in textos))


def _par(texto: str) -> dict:
    return {"es": texto, "en": texto}


def con_voz(vista: dict, comp: dict | None) -> dict:
    """La vista derivada con los textos del sitio: el atajo con el título de su sección (o el del objetivo) y el
    botón de envío; cada tarea con el texto del menú que lleva a su enlace."""
    comp = comp or {}
    vista = {**vista, "opciones": dict(vista["opciones"]), "datos": [dict(item) for item in vista["datos"]]}
    if vista["componente"] == "atajo":
        textos = {}
        if titulo := comp.get("seccion") or (atajos._titulo(comp["objetivo"]) if comp.get("objetivo") else ""):
            textos["titulo"] = titulo
        if comp.get("boton"):
            textos["boton"] = comp["boton"]
        if textos:
            vista["opciones"]["textos"] = {"es": dict(textos), "en": dict(textos)}
    else:
        for item in vista["datos"]:
            if texto := comp.get("tareas", {}).get(item["enlace"]):
                item["titulo"] = _par(texto)
    return vista


def _razon(par: dict, vocabulario_: set[str] | None) -> str | None:
    if razon := cliche(par.get("es")) or cliche(par.get("en")):
        return razon
    if vocabulario_ is not None and not (anclado(par.get("es"), vocabulario_) or anclado(par.get("en"), vocabulario_)):
        return "no comparte ninguna palabra con la página ni con los objetivos"
    return None


def verificar(vista: dict, base: dict, vocabulario_: set[str]) -> tuple[dict, list[dict]]:
    """`vista` (con la propuesta del modelo) sin clichés ni títulos sin anclaje: cada texto que falla vuelve al de
    `base` (la vista con la voz del sitio) o se quita. Devuelve la vista y los reemplazos con su razón."""
    vista = {**vista, "opciones": dict(vista["opciones"]), "datos": [dict(item) for item in vista["datos"]]}
    reemplazos = []

    def anotar(texto: str, antes: dict, despues: dict | None, razon: str) -> None:
        reemplazos.append({"vista": vista["id"], "texto": texto, "antes": antes, "despues": despues, "razon": razon})

    textos = vista["opciones"].get("textos") or {}
    respaldo = base["opciones"].get("textos") or {}
    nuevos = {idioma: dict(textos.get(idioma) or {}) for idioma in ("es", "en")}
    for clave in sorted({c for por_idioma in textos.values() for c in por_idioma}):
        par = {idioma: nuevos[idioma].get(clave, "") for idioma in ("es", "en")}
        if razon := _razon(par, vocabulario_ if clave == "titulo" else None):
            otro = {idioma: (respaldo.get(idioma) or {}).get(clave, "") for idioma in ("es", "en")}
            otro = otro if all(otro.values()) and otro != par else None
            for idioma in ("es", "en"):
                nuevos[idioma].pop(clave, None)
                if otro:
                    nuevos[idioma][clave] = otro[idioma]
            anotar(clave, par, otro, razon)
    if nuevos := {idioma: t for idioma, t in nuevos.items() if t}:
        vista["opciones"]["textos"] = nuevos
    else:
        vista["opciones"].pop("textos", None)

    if vista["componente"] == "atajo":
        etiquetas = {c["nombre"]: c["etiqueta"] for c in base["datos"]}
        for campo in vista["datos"]:
            if (razon := _razon(campo["etiqueta"], None)) and campo["nombre"] in etiquetas:
                anotar(f"etiqueta:{campo['nombre']}", campo["etiqueta"], etiquetas[campo["nombre"]], razon)
                campo["etiqueta"] = etiquetas[campo["nombre"]]
        return vista, reemplazos
    por_enlace = {item["enlace"]: item for item in base["datos"]}
    for item in vista["datos"]:
        original = por_enlace.get(item["enlace"], {})
        if (razon := _razon(item["titulo"], vocabulario_)) and original.get("titulo"):
            anotar(f"tarea:{item['enlace']}:titulo", item["titulo"], original["titulo"], razon)
            item["titulo"] = original["titulo"]
        if isinstance(item.get("detalle"), dict) and (razon := _razon(item["detalle"], None)):
            anotar(f"tarea:{item['enlace']}:detalle", item["detalle"], original.get("detalle"), razon)
            if original.get("detalle"):
                item["detalle"] = original["detalle"]
            else:
                item.pop("detalle")
    return vista, reemplazos


FUENTES = ("sitio", "objetivo", "reformulado")


def fuentes(propuestas) -> list[dict]:
    """De dónde dijo el modelo que sacó cada texto, por componente."""
    lista = []
    for propuesta in propuestas or []:
        for fuente in (propuesta.get("fuentes") if isinstance(propuesta, dict) else None) or []:
            if isinstance(fuente, dict) and fuente.get("fuente") in FUENTES:
                lista.append({"vista": propuesta.get("id"), "texto": str(fuente.get("texto") or "")[:120],
                              "fuente": fuente["fuente"], "origen": str(fuente.get("origen") or "")[:160]})
    return lista
