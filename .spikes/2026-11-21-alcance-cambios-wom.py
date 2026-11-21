#!/usr/bin/env python3
"""Spike de alcance: ¿hasta qué nivel de cambio se puede modificar wom.cl sin romperlo?

Qué mide
    Aplica sobre el sitio real, en un navegador sin ventana, parches de los niveles 1 a 5 de
    docs/agents/niveles-de-cambio.md para la tarea «Encuentra cómo dar de baja tu servicio de
    Internet Fibra». Los parches son datos (están abajo, en NIVELES) y los escribió Claude a mano,
    haciendo de optimizador, a partir de los recorridos de atajo-explorer del 2026-11-21.

    Por cada nivel anota:
      - si cada localizador encontró exactamente un elemento, y si le bastó rol y nombre;
      - si el cambio sigue en pie tras 3 s, un scroll y un cambio de tamaño de la ventana;
      - si deshacerlo devuelve la página original;
      - qué enlaces visibles se pierden (inventario de antes y después);
      - cuántas acciones necesita una ruta escrita a mano para ver los canales de baja.

    No lanza agentes: las rutas son guiones fijos. No inicia sesión ni envía formularios.
    Hace unas 20 cargas de página de wom.cl, espaciadas.

Cómo se ejecuta
    python3 -m venv .venv && .venv/bin/pip install playwright && .venv/bin/playwright install chromium
    .venv/bin/python .spikes/2026-11-21-alcance-cambios-wom.py

    Con CHROMIUM=/ruta/al/ejecutable usa un Chromium ya instalado.
    Deja capturas y resultados.json en .spikes/2026-11-21-alcance-cambios-wom/.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

SALIDA = Path(__file__).with_suffix("")
BASE = "https://www.wom.cl"
URL_INICIO = f"{BASE}/"
URL_CATEGORIA = f"{BASE}/centro-de-ayuda/category/internet-fibra/index.html"
RUTA_ARTICULO = "/centro-de-ayuda/donde-puedo-dar-de-baja-mi-servicio-de-internet-fibra/index.html"
URL_ARTICULO = f"{BASE}{RUTA_ARTICULO}"
ESCRITORIO = {"width": 1024, "height": 768}
MOVIL = {"width": 390, "height": 844}
ESPERA_CARGA_MS = 5000
# Lo que tiene que verse en pantalla para dar la tarea por lograda: los dos teléfonos de baja.
CRITERIO = ["103", "22 337 7600"]

# --------------------------------------------------------------------------------------------
# Aplicador mínimo. No es el motor de parches: se tira. Corre en la página, como lo haría un
# script de contenido, y solo entiende los cambios que usa este spike.
# --------------------------------------------------------------------------------------------
APLICADOR = r"""
(() => {
  if (window.__mt) return;
  const M = (window.__mt = { deshacer: [], irreversibles: 0 });
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (e) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const ROLES = {
    link: "a", button: "button,[role=button],input[type=submit]", heading: "h1,h2,h3,h4,h5,h6",
    dialog: "[role=dialog],.modal", listitem: "li", paragraph: "p", list: "ul,ol",
  };
  const nombre = (e) => norm(e.getAttribute("aria-label") || e.innerText || "");
  const propio = (e) => !e.closest("[data-mt-pieza]");

  // Devuelve { el, como } o { error }. Regla del documento: exactamente un elemento, o no se aplica.
  M.localizar = (loc, raiz = document) => {
    let porRol = [];
    if (loc.role) {
      porRol = [...raiz.querySelectorAll(ROLES[loc.role] || loc.role)].filter(propio);
      if (loc.name != null) {
        const n = norm(loc.name);
        porRol = porRol.filter((e) => (loc.match === "contains" ? nombre(e).includes(n) : nombre(e) === n));
      }
      if (!loc.hidden_ok && raiz === document) porRol = porRol.filter(visible);
      if (porRol.length === 1) return { el: porRol[0], como: "rol y nombre" };
    }
    if (loc.css) {
      const porCss = [...raiz.querySelectorAll(loc.css)];
      if (porRol.length > 1) {
        const ambos = porCss.filter((e) => porRol.includes(e));
        if (ambos.length === 1) return { el: ambos[0], como: "rol y nombre, desempatado con css" };
      }
      if (porCss.length === 1) return { el: porCss[0], como: "solo css" };
      return { error: `css encontró ${porCss.length}; rol y nombre, ${porRol.length}` };
    }
    return { error: `rol y nombre encontró ${porRol.length}` };
  };

  // Ocultar con estilo en línea e `!important`. Una regla `[data-mt-oculto]{display:none!important}` pierde
  // contra las clases de Bootstrap del sitio (`.d-block`, `.d-flex`), que también llevan `!important`.
  const ocultar = (e) => {
    e.__mtAntes = [e.style.getPropertyValue("display"), e.style.getPropertyPriority("display")];
    e.style.setProperty("display", "none", "important"); e.setAttribute("data-mt-oculto", "");
  };
  const mostrar = (e) => {
    const [v, pr] = e.__mtAntes || ["", ""];
    if (v) e.style.setProperty("display", v, pr); else e.style.removeProperty("display");
    if (!e.getAttribute("style")) e.removeAttribute("style");
    e.removeAttribute("data-mt-oculto");
  };

  const crear = (tag, attrs = {}, hijos = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") e.textContent = v; else if (k === "on") e.addEventListener("click", v); else e.setAttribute(k, v);
    }
    for (const h of hijos) if (h) e.appendChild(h);
    return e;
  };
  const urlSegura = (u) => { try { const x = new URL(u, location.href); return /^(https?|tel):$/.test(x.protocol) ? x.href : null; } catch { return null; } };

  const CSS_PIEZA = `
    :host{all:initial;display:block;font:16px/1.45 system-ui,sans-serif;color:#14213d}
    .caja{background:#fff;border:2px solid #14213d;border-radius:14px;padding:18px 20px;margin:14px auto;max-width:860px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
    .marca{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#52607a;margin:0 0 6px}
    h2{font-size:22px;margin:0 0 8px} p{margin:6px 0}
    .fila{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
    a.boton,button.boton{font:inherit;font-weight:700;background:#14213d;color:#fff;border:0;border-radius:10px;padding:12px 16px;text-decoration:none;cursor:pointer;min-height:44px;display:inline-flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;box-sizing:border-box}
    a.boton.suave,button.boton.suave{background:#eef1f6;color:#14213d}
    .detalle{font-size:14px;color:#c9d2e3;display:block;font-weight:400;margin-top:2px}
    ul{margin:8px 0;padding-left:20px} .nota{font-size:13px;color:#52607a;margin-top:12px}
    :host([data-mt-pagina]) .caja{max-width:640px;margin:48px auto}
  `;

  function leer(regla, raiz) {
    const r = M.localizar(regla.element, raiz);
    if (r.error) return { error: r.error };
    return { valor: regla.attr ? r.el.getAttribute(regla.attr) : r.el.innerText.replace(/\s+/g, " ").trim(), el: r.el };
  }

  // Dibuja una pieza del catálogo dentro de un Shadow DOM. `raiz` es de dónde lee: la página u otro documento.
  function dibujar(c, raiz, resultado) {
    const host = crear("div", { "data-mt-pieza": c.component });
    if (c.page) host.setAttribute("data-mt-pagina", "");
    const sombra = host.attachShadow({ mode: "open" });
    sombra.appendChild(crear("style", { text: CSS_PIEZA }));
    const caja = crear("section", { class: "caja", role: "region", "aria-label": c.title || c.component });
    sombra.appendChild(caja);
    caja.appendChild(crear("p", { class: "marca", text: "Agregado por Chameleon · no es parte del sitio" }));
    let titulo = c.title;
    if (c.title_from) { const t = leer(c.title_from, raiz); if (t.error) throw new Error("título: " + t.error); titulo = t.valor; }
    if (titulo) caja.appendChild(crear("h2", { text: titulo }));
    if (c.text) caja.appendChild(crear("p", { text: c.text }));

    const fila = crear("div", { class: "fila" });
    const items = [...(c.items || [])];
    if (c.each) {
      // Una acción por cada elemento de una lista de la página: lee su texto y su primer enlace.
      const lista = [...raiz.querySelectorAll(c.each.css)];
      if (!lista.length) throw new Error("lista vacía: " + c.each.css);
      for (const li of lista) {
        const a = li.querySelector("a[href]");
        const texto = (a ? a.innerText : li.innerText).trim();
        const etiqueta = a && /^tel:/.test(a.getAttribute("href")) ? "Llamar al " + texto : texto.charAt(0).toUpperCase() + texto.slice(1);
        items.push({ label: etiqueta, detail: li.innerText.replace(/\s+/g, " ").trim(), original: a, href: a && a.getAttribute("href"), remoto: raiz !== document });
      }
    }
    for (const it of items) {
      let href = it.go || it.href, original = it.original || null;
      if (it.press) { const r = M.localizar(it.press); if (r.error) throw new Error(`acción «${it.label}»: ${r.error}`); original = r.el; href = href || r.el.getAttribute("href"); }
      href = href ? urlSegura(href) : null;
      const b = crear(href ? "a" : "button", { class: "boton" + (it.soft ? " suave" : ""), text: it.label });
      if (href) b.setAttribute("href", href);
      if (it.detail) b.appendChild(crear("span", { class: "detalle", text: it.detail }));
      // Acoplamiento: el clic se reenvía al elemento original cuando está en esta misma página.
      if (original && !it.remoto) b.addEventListener("click", (ev) => { if (original.isConnected) { ev.preventDefault(); window.__mt_reenviados = (window.__mt_reenviados || 0) + 1; original.click(); } });
      fila.appendChild(b);
      resultado.acciones = (resultado.acciones || 0) + 1;
    }
    if (items.length) caja.appendChild(fila);
    if (c.toggle_original) {
      const b = crear("button", { class: "boton suave", text: c.toggle_original });
      b.addEventListener("click", () => M.verOriginal());
      caja.appendChild(crear("div", { class: "fila" }, [b]));
    }
    if (c.note) caja.appendChild(crear("p", { class: "nota", text: c.note }));
    return host;
  }

  function insertar(host, c) {
    if (c.anchor === "fixed-top") { document.body.insertBefore(host, document.body.firstChild); return; }
    const r = M.localizar(c.anchor);
    if (r.error) throw new Error("ancla: " + r.error);
    const pos = c.position || "after";
    if (pos === "first") r.el.insertBefore(host, r.el.firstChild);
    else r.el.parentNode.insertBefore(host, pos === "before" ? r.el : r.el.nextSibling);
    return r.como;
  }

  const OPS = {
    hide(c, res) { const r = loc(c, res); ocultar(r); M.deshacer.push(() => mostrar(r)); },
    relabel(c, res) {
      const r = loc(c, res);
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let nodo; while ((nodo = w.nextNode())) if (nodo.nodeValue.trim()) break;
      if (!nodo) throw new Error("sin texto que renombrar");
      const antes = nodo.nodeValue; nodo.nodeValue = c.text; M.deshacer.push(() => (nodo.nodeValue = antes));
    },
    set_style(c, res) { const r = loc(c, res); const antes = r.getAttribute("style"); r.style.cssText += ";" + c.style; M.deshacer.push(() => (antes == null ? r.removeAttribute("style") : r.setAttribute("style", antes))); },
    move(c, res) {
      const r = loc(c, res); const d = M.localizar(c.to); if (d.error) throw new Error("destino: " + d.error);
      const padre = r.parentNode, sig = r.nextSibling;
      if (c.position === "first") d.el.insertBefore(r, d.el.firstChild); else d.el.parentNode.insertBefore(r, d.el);
      M.deshacer.push(() => padre.insertBefore(r, sig));
    },
    press(c, res) { loc(c, res).click(); M.irreversibles++; },
    add_component(c, res) {
      const ocultos = (c.replaces || []).map((l) => { const r = M.localizar(l); if (r.error) throw new Error("reemplaza: " + r.error); return r.el; });
      const host = dibujar(c, document, res); res.como = insertar(host, c) || "ancla fija";
      ocultos.forEach(ocultar);
      M.ocultosPorVista = ocultos;
      M.deshacer.push(() => { host.remove(); ocultos.forEach((e) => e.hasAttribute("data-mt-oculto") && mostrar(e)); M.ocultosPorVista = []; document.documentElement.removeAttribute("data-mt-original"); });
    },
    // Nivel 5: la pieza lee de otra página del mismo sitio. Rompe la regla «la pieza nunca envía una petición».
    async add_remote_component(c, res) {
      const html = await (await fetch(c.from, { credentials: "omit" })).text();
      const otro = new DOMParser().parseFromString(html, "text/html");
      const host = dibujar(c, otro, res); res.como = insertar(host, c) || "ancla fija";
      M.deshacer.push(() => host.remove());
    },
  };
  function loc(c, res) { const r = M.localizar(c.element); if (r.error) throw new Error(r.error); res.como = r.como; return r.el; }

  M.aplicar = async (parche) => {
    const salida = [];
    for (const c of parche) {
      const res = { op: c.op, sobre: c.element ? JSON.stringify(c.element) : c.component };
      try { await OPS[c.op](c, res); res.ok = true; }
      catch (e) { res.ok = !!c.optional; res.error = String(e.message || e); if (c.optional) res.omitido = true; }
      salida.push(res);
    }
    return salida;
  };
  M.quitar = () => { while (M.deshacer.length) M.deshacer.pop()(); };
  M.verOriginal = () => {
    const viendo = document.documentElement.toggleAttribute("data-mt-original");
    (M.ocultosPorVista || []).forEach((e) => (viendo ? mostrar(e) : ocultar(e)));
    return viendo;
  };

  // Inventario: enlaces y botones visibles del sitio, y los que ofrecen las piezas.
  M.inventario = () => {
    const clave = (e) => norm(e.innerText).slice(0, 60) + " | " + (e.getAttribute("href") || "");
    const sitio = [...document.querySelectorAll("a,button")].filter(propio).filter(visible).map(clave);
    const piezas = [...document.querySelectorAll("[data-mt-pieza]")].flatMap((h) => [...h.shadowRoot.querySelectorAll("a,button")].map(clave));
    return { sitio, piezas };
  };
  M.huella = () => JSON.stringify([M.inventario().sitio, document.documentElement.scrollHeight, getComputedStyle(document.body).overflow]);
  M.marcas = () => document.querySelectorAll("[data-mt-oculto],[data-mt-pieza]").length;
  M.ocultosVisibles = () => [...document.querySelectorAll("[data-mt-oculto]")].filter(visible).length;

  // ¿Se ve este texto en pantalla, sin nada encima? Mira también dentro de las piezas.
  M.seVe = (texto) => {
    const raices = [document, ...[...document.querySelectorAll("[data-mt-pieza]")].map((h) => h.shadowRoot)];
    for (const raiz of raices) {
      const w = document.createTreeWalker(raiz instanceof Document ? raiz.body : raiz, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!n.nodeValue.includes(texto)) continue;
        const e = n.parentElement, r = e.getBoundingClientRect();
        if (!r.width || r.top < 0 || r.bottom > innerHeight) continue;
        const arriba = raiz.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (arriba && (arriba === e || e.contains(arriba) || arriba.contains(e))) {
          if (raiz instanceof Document) return true;
          const host = raiz.host, enDoc = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (enDoc === host) return true;
        }
      }
    }
    return false;
  };
})();
"""

# --------------------------------------------------------------------------------------------
# Los parches, por nivel y por página. Los escribió Claude haciendo de optimizador.
# Localizador: { role, name, css }, como en docs/formas-de-datos.md. `match: contains` y
# `hidden_ok` son agregados de este spike.
# --------------------------------------------------------------------------------------------
PREGUNTA = {"role": "link", "name": "¿Dónde puedo dar de baja mi servicio de Internet Fibra?"}
POPUP = {"role": "dialog", "name": "Ver planes", "css": "#popupPlanes"}

N1_INICIO = [
    # Cerrar el popup pulsando su propia X. Ocultarlo con `hide` deja la página sin scroll (ver LAB).
    {"op": "press", "element": {"role": "link", "name": "Close"}, "optional": True},  # el popup sale una vez por sesión
    {"op": "hide", "element": {"role": "link", "name": "¡Sólo por pocos días!", "match": "contains", "css": "body > a.d-block.w-100"}},
    {"op": "hide", "element": {"css": "div.floating-button"}},
    {"op": "relabel", "element": {"role": "link", "name": "Ayuda"}, "text": "Ayuda y bajas"},
]
N2_INICIO = N1_INICIO + [
    {"op": "set_style", "element": {"role": "link", "name": "Ayuda y bajas"}, "style": "outline:3px solid #e6007e;outline-offset:4px;border-radius:8px"},
]
# La cabecera del Centro de Ayuda: el saludo con el buscador y la rejilla de categorías. Ocupan la primera pantalla.
CABECERA_AYUDA = [
    {"op": "hide", "element": {"css": "#buscador"}},
    {"op": "hide", "element": {"css": "#canales-digitales"}},
]
N2_CATEGORIA = CABECERA_AYUDA + [
    {"op": "press", "element": {"role": "link", "name": "VER MÁS", "css": "#informacion-general-fibra-optica .content-ver-mas a"}},
    {"op": "move", "element": {"role": "listitem", "name": PREGUNTA["name"]}, "to": {"css": "#contratacion ul.links-fq"}, "position": "first"},
    {"op": "set_style", "element": PREGUNTA, "style": "background:#fff3c4;font-weight:700;border-left:6px solid #e6007e"},
]
N1_ARTICULO = CABECERA_AYUDA + [
    # El párrafo de retención que va antes de los canales de baja.
    {"op": "hide", "element": {"role": "paragraph", "name": "Recuerda que siempre tenemos los mejores planes", "match": "contains"}},
]
ATAJOS = {
    "op": "add_component", "component": "shortcuts", "anchor": {"css": "#main-header"}, "position": "after",
    "title": "¿Qué necesitas hacer?",
    "items": [
        {"label": "Dar de baja Internet Fibra", "go": RUTA_ARTICULO},
        {"label": "Ir al Centro de Ayuda", "press": {"role": "link", "name": "Ir al Centro de Ayuda", "hidden_ok": True, "css": "a.h-link-cda"}, "soft": True},
    ],
}
N3_INICIO = N1_INICIO + [ATAJOS]
CANALES = {"css": "#titulo-entrada > ul > li"}
# El primer intento del optimizador. Se deja para mostrar qué pasa cuando una lista sale demasiado amplia.
CANALES_PRIMER_INTENTO = {"css": "#titulo-entrada ul > li"}
N3_ARTICULO = N1_ARTICULO + [
    {"op": "add_component", "component": "primary_action", "anchor": {"role": "heading", "name": PREGUNTA["name"]}, "position": "after",
     "title": "Canales para dar de baja", "each": CANALES},
]
N4_ARTICULO = [
    {"op": "add_component", "component": "view", "page": True, "anchor": "fixed-top",
     "replaces": [{"css": "#main-header"}, {"css": "section.menu-accesibilidad"}, {"css": "#buscador"}, {"css": "#canales-digitales"},
                  {"css": "#breadcrumb"}, {"css": "body > section.py-200"}, {"css": "#canales-autoatencion"}, {"css": "#main-footer"}],
     "title_from": {"element": {"role": "heading", "name": PREGUNTA["name"]}},
     "text": "WOM no permite dar de baja en línea. Tienes estos canales:",
     "each": CANALES, "toggle_original": "Ver la página original de WOM",
     "note": "Esta vista oculta el menú, el pie y la oferta de planes de la página original."},
]
N5_INICIO = N1_INICIO + [
    {"op": "add_remote_component", "component": "summary", "anchor": {"css": "#main-header"}, "position": "after", "from": RUTA_ARTICULO,
     "title": "Dar de baja Internet Fibra", "text": "WOM no permite dar de baja en línea. Tienes estos canales:", "each": CANALES,
     "note": "Leído de la página «¿Dónde puedo dar de baja mi servicio de Internet Fibra?» del Centro de Ayuda."},
]

# Qué parche lleva cada página en cada nivel. Como un tema de la extensión: por ruta.
NIVELES = {
    "0-original": {},
    "2-datos-y-orden": {"inicio": N2_INICIO, "categoria": N2_CATEGORIA, "articulo": N1_ARTICULO},
    "3-componentes": {"inicio": N3_INICIO, "categoria": N2_CATEGORIA, "articulo": N3_ARTICULO},
    "4-vista": {"inicio": N3_INICIO, "categoria": N2_CATEGORIA, "articulo": N4_ARTICULO},
    "5-entre-paginas": {"inicio": N5_INICIO, "categoria": N2_CATEGORIA, "articulo": N4_ARTICULO},
}


def tipo_de_pagina(url: str) -> str | None:
    ruta = url.split("wom.cl", 1)[-1].split("?")[0]
    if ruta in ("", "/"):
        return "inicio"
    if "category/internet-fibra" in ruta:
        return "categoria"
    if "donde-puedo-dar-de-baja" in ruta:
        return "articulo"
    return None


def cargar(pg: Page, url: str) -> None:
    pg.goto(url, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(ESPERA_CARGA_MS)
    pg.evaluate(APLICADOR)


def captura(pg: Page, nombre: str) -> str:
    SALIDA.mkdir(exist_ok=True)
    pg.screenshot(path=SALIDA / f"{nombre}.jpg", type="jpeg", quality=55)
    return f"{nombre}.jpg"


def criterio(pg: Page) -> bool:
    return all(pg.evaluate("t => window.__mt.seVe(t)", t) for t in CRITERIO)


# --------------------------------------------------------------------------------------------
# Parte 1 · Laboratorio: cada parche por separado, sobre una sola carga de cada página.
# --------------------------------------------------------------------------------------------
def probar(pg: Page, nombre: str, parche: list[dict], base: str, inv_antes: dict) -> dict:
    ops = pg.evaluate("p => window.__mt.aplicar(p)", parche)
    pg.wait_for_timeout(3000)
    marcas_0 = pg.evaluate("window.__mt.marcas()")
    pg.mouse.wheel(0, 600)
    pg.wait_for_timeout(300)
    pg.mouse.wheel(0, -600)
    tam = pg.viewport_size
    pg.set_viewport_size({"width": 800, "height": 600})
    pg.wait_for_timeout(500)
    pg.set_viewport_size(tam)
    pg.wait_for_timeout(500)
    pg.evaluate("window.scrollTo(0, 0)")
    inv = pg.evaluate("window.__mt.inventario()")
    en_piezas = {c.split(" | ", 1)[1] for c in inv["piezas"]}
    perdidos = [c for c in inv_antes["sitio"] if c not in inv["sitio"] and c.split(" | ", 1)[1] not in en_piezas]
    res = {
        "prueba": nombre,
        "cambios": ops,
        "aplicados": sum(o["ok"] for o in ops),
        "total": len(ops),
        "sigue_en_pie": pg.evaluate("window.__mt.marcas()") == marcas_0,
        "ocultos_que_siguen_visibles": pg.evaluate("window.__mt.ocultosVisibles()"),
        "scroll_bloqueado": pg.evaluate("getComputedStyle(document.body).overflow") == "hidden",
        "criterio_a_la_vista": criterio(pg),
        "enlaces_perdidos": len(perdidos),
        "ejemplos_perdidos": perdidos[:6],
        "captura": captura(pg, f"lab-{nombre}"),
    }
    irreversibles = pg.evaluate("window.__mt.irreversibles")
    pg.evaluate("window.__mt.quitar()")
    pg.wait_for_timeout(300)
    res["deshacer_devuelve_original"] = pg.evaluate("window.__mt.huella()") == base
    res["cambios_irreversibles"] = irreversibles
    return res


def laboratorio(ctx) -> list[dict]:
    salida = []
    plan = [
        (URL_INICIO, [
            ("inicio-n1-ocultar-popup", [{"op": "hide", "element": POPUP}, {"op": "hide", "element": {"css": ".modal-backdrop"}}]),
            ("inicio-n1-cerrar-popup-y-limpiar", N1_INICIO),
            ("inicio-n3-atajos", [ATAJOS]),
            ("inicio-n5-respuesta-remota", [N5_INICIO[-1]]),
        ]),
        (URL_CATEGORIA, [("categoria-n2-subir-y-resaltar", N2_CATEGORIA)]),
        (URL_ARTICULO, [
            ("articulo-n1-ocultar-retencion", N1_ARTICULO),
            ("articulo-n3-lista-demasiado-amplia", [{**N3_ARTICULO[-1], "each": CANALES_PRIMER_INTENTO}]),
            ("articulo-n3-acciones", N3_ARTICULO),
            ("articulo-n4-vista", N4_ARTICULO),
        ]),
    ]
    for url, pruebas in plan:
        pg = ctx.new_page()
        cargar(pg, url)
        captura(pg, f"lab-{tipo_de_pagina(url)}-original")
        for nombre, parche in pruebas:
            base = pg.evaluate("window.__mt.huella()")
            inv = pg.evaluate("window.__mt.inventario()")
            r = probar(pg, nombre, parche, base, inv)
            print(f"  {nombre}: {r['aplicados']}/{r['total']} cambios, en pie={r['sigue_en_pie']}, "
                  f"deshacer={r['deshacer_devuelve_original']}, perdidos={r['enlaces_perdidos']}")
            salida.append(r)
        if tipo_de_pagina(url) == "articulo":
            salida.append(regla_debil(pg))
            salida.append(ver_original(pg))
            salida.append(reenvio_de_clic(pg))
        pg.close()
    return salida


def regla_debil(pg: Page) -> dict:
    """El primer intento de `hide`: una regla CSS por atributo. ¿Cuántos elementos siguen visibles?"""
    selectores = ["#main-header", "#buscador", "#canales-digitales", "#breadcrumb", "body > section.py-200", "#main-footer"]
    visibles = pg.evaluate("""sels => {
      const st = document.createElement('style'); st.textContent = '[data-mt-prueba]{display:none!important}'; document.head.appendChild(st);
      const els = sels.map(s => document.querySelector(s)); els.forEach(e => e.setAttribute('data-mt-prueba', ''));
      const v = sels.filter((s, i) => els[i].getBoundingClientRect().height > 0);
      els.forEach(e => e.removeAttribute('data-mt-prueba')); st.remove(); return v;
    }""", selectores)
    print(f"  articulo-ocultar-con-regla-css: siguen visibles {visibles}")
    return {"prueba": "articulo-ocultar-con-regla-css", "probados": selectores, "siguen_visibles": visibles}


def ver_original(pg: Page) -> dict:
    """En la vista de nivel 4, ¿el botón «Ver la página original» la muestra y vuelve?"""
    base = pg.evaluate("window.__mt.huella()")
    pg.evaluate("p => window.__mt.aplicar(p)", N4_ARTICULO)
    boton = pg.locator("[data-mt-pieza] button", has_text="Ver la página original")
    boton.click()
    pg.wait_for_timeout(300)
    muestra = pg.evaluate("document.querySelector('#main-footer').getBoundingClientRect().height > 0")
    boton.click()
    pg.wait_for_timeout(300)
    vuelve = pg.evaluate("document.querySelector('#main-footer').getBoundingClientRect().height === 0")
    pg.evaluate("window.__mt.quitar()")
    res = {"prueba": "articulo-n4-ver-original", "muestra_la_original": muestra, "vuelve_a_la_vista": vuelve,
           "deshacer_devuelve_original": pg.evaluate("window.__mt.huella()") == base}
    print(f"  articulo-n4-ver-original: {res}")
    return res


def reenvio_de_clic(pg: Page) -> dict:
    """¿Pulsar un botón de la pieza acciona el enlace original? Se prueba con el de WhatsApp, sin dejarlo cargar."""
    pg.evaluate("p => window.__mt.aplicar(p)", N3_ARTICULO)
    pedidos: list[str] = []

    def filtro(r):
        if "wom.cl" in r.request.url:
            return r.continue_()
        if r.request.is_navigation_request():
            pedidos.append(r.request.url)
        return r.abort()

    pg.context.route("**/*", filtro)
    try:
        with pg.context.expect_page(timeout=5000) as nueva:
            pg.locator("[data-mt-pieza] a.boton", has_text="Whatsapp").first.click()
        nueva.value.wait_for_timeout(1500)
        nueva.value.close()
        destino = pedidos[0][:80] if pedidos else "se abrió una pestaña, sin destino registrado"
    except Exception as e:  # noqa: BLE001
        destino = f"sin pestaña nueva: {str(e)[:80]}"
    pg.context.unroute("**/*")
    reenviados = pg.evaluate("window.__mt_reenviados || 0")
    print(f"  articulo-reenvio-de-clic: reenviados={reenviados}, destino={destino}")
    return {"prueba": "articulo-n3-reenvio-de-clic", "clics_reenviados_al_original": reenviados, "destino": destino}


# --------------------------------------------------------------------------------------------
# Parte 2 · Rutas: una ruta escrita a mano por nivel, desde la portada, contando acciones.
# --------------------------------------------------------------------------------------------
class Ruta:
    def __init__(self, pg: Page, nivel: str):
        self.pg, self.nivel, self.acciones, self.fallos, self.omitidos = pg, nivel, [], [], []

    def aplicar(self) -> None:
        tipo = tipo_de_pagina(self.pg.url)
        self.pg.evaluate(APLICADOR)
        parche = NIVELES[self.nivel].get(tipo)
        if parche:
            for o in self.pg.evaluate("p => window.__mt.aplicar(p)", parche):
                if o.get("omitido"):
                    self.omitidos.append(f"{tipo}: {o['op']} {o['sobre']}")
                elif not o["ok"]:
                    self.fallos.append(f"{tipo}: {o['op']} {o['sobre']}: {o['error']}")
            self.pg.wait_for_timeout(800)

    def clic(self, etiqueta: str, selector: str, navega: bool = False, **kw) -> None:
        loc = self.pg.locator(selector, **kw).first
        caja = loc.bounding_box()
        alto = self.pg.viewport_size["height"]
        if caja is None or caja["y"] < 0 or caja["y"] + caja["height"] > alto:
            self.acciones.append(f"scroll hasta «{etiqueta}»")
            loc.scroll_into_view_if_needed()
        self.acciones.append(f"clic «{etiqueta}»")
        if navega:
            with self.pg.expect_navigation(wait_until="domcontentloaded", timeout=60000):
                loc.click()
            self.pg.wait_for_timeout(ESPERA_CARGA_MS)
            self.aplicar()
        else:
            loc.click()
            self.pg.wait_for_timeout(700)

    def leer(self) -> bool:
        """Si los canales no se ven, la persona se desplaza hasta verlos."""
        if criterio(self.pg):
            return True
        self.acciones.append("scroll hasta los canales")
        self.pg.get_by_text("22 337 7600").first.scroll_into_view_if_needed()
        self.pg.wait_for_timeout(400)
        return criterio(self.pg)


# ¿La pregunta se puede pulsar ya, hay que desplazarse, o la lista la tiene recortada?
ALCANCE_DE_LA_PREGUNTA = """n => {
  const a = [...document.querySelectorAll('a')].find(x => x.innerText.trim() === n);
  const libre = () => { const r = a.getBoundingClientRect(); if (!r.height || r.top < 0 || r.bottom > innerHeight) return false;
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === a || a.contains(t)); };
  if (libre()) return 'a la vista';
  a.scrollIntoView({ block: 'center' });
  return libre() ? 'con scroll' : 'tapada';
}"""


def ruta(nav, pantalla: dict, nivel: str, nombre: str) -> dict:
    # Un contexto nuevo por ruta: como una primera visita, con el popup.
    movil = pantalla["width"] < 600
    ctx = nav.new_context(viewport=pantalla, locale="es-CL", is_mobile=movil, has_touch=movil, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto(URL_INICIO, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(ESPERA_CARGA_MS)
    r = Ruta(pg, nivel)
    r.aplicar()
    captura(pg, f"ruta-{nombre}-inicio")
    inicio = time.time()
    try:
        if nivel == "5-entre-paginas":
            pass  # la respuesta ya está en la portada
        elif nivel in ("3-componentes", "4-vista"):
            r.clic("Dar de baja Internet Fibra", "[data-mt-pieza] a.boton", navega=True, has_text="Dar de baja")
        else:
            if pg.locator("#popupPlanes a.close").is_visible():
                r.clic("Close (popup)", "#popupPlanes a.close")
            r.clic("Ayuda", "a.h-bt-sub-mnu", has_text="Ayuda")
            r.clic("Ir al Centro de Ayuda", "a.h-link-cda", navega=True)
            r.clic("Internet Fibra", "a:visible", navega=True, has_text="Internet Fibra")
            estado = pg.evaluate(ALCANCE_DE_LA_PREGUNTA, PREGUNTA["name"])
            if estado == "tapada":
                r.clic("VER MÁS", "#informacion-general-fibra-optica .content-ver-mas a")
            elif estado == "con scroll":
                r.acciones.append("scroll hasta la pregunta")
            r.clic("¿Dónde puedo dar de baja…?", "a:visible", navega=True, has_text=PREGUNTA["name"])
        logrado = r.leer()
    except Exception as e:  # noqa: BLE001
        logrado = False
        r.fallos.append(f"la ruta se cortó: {str(e)[:200]}")
    res = {
        "nivel": nivel, "pantalla": f"{pg.viewport_size['width']}x{pg.viewport_size['height']}", "logrado": logrado,
        "acciones": len(r.acciones), "detalle": r.acciones, "segundos_del_guion": round(time.time() - inicio, 1),
        "fallos_de_parche": r.fallos, "cambios_omitidos": r.omitidos, "captura_final": captura(pg, f"ruta-{nombre}-final"), "url_final": pg.url,
    }
    print(f"  {nombre}: logrado={logrado}, acciones={len(r.acciones)}, fallos={len(r.fallos)}")
    ctx.close()
    return res


def main() -> int:
    SALIDA.mkdir(exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        ctx = nav.new_context(viewport=ESCRITORIO, locale="es-CL")
        print("Laboratorio")
        lab = laboratorio(ctx)
        print("Rutas, escritorio")
        ctx.close()
        rutas = [ruta(nav, ESCRITORIO, nivel, nivel) for nivel in NIVELES]
        print("Rutas, celular")
        rutas += [ruta(nav, MOVIL, nivel, f"{nivel}-movil") for nivel in ("4-vista", "5-entre-paginas")]
        info = {"chromium": nav.version}
        nav.close()
    (SALIDA / "resultados.json").write_text(
        json.dumps({"fecha": time.strftime("%Y-%m-%d %H:%M"), **info, "laboratorio": lab, "rutas": rutas}, ensure_ascii=False, indent=1))
    print(f"Listo: {SALIDA}/resultados.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
