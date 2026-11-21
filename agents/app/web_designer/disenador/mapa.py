"""El mapa de la página: un resumen compacto de su estructura y estilos para que el modelo elija selectores.

Solo lleva lo que sirve para diseñar: landmarks, encabezados, contenedores grandes (etiqueta, id, clases estables,
rol, tamaño y posición en el documento), colores y tamaños de letra calculados de los nodos clave, los botones con
fondo propio, los enlaces de la navegación (texto, href y un selector que encuentra solo a ese elemento, o a sus
copias en otro menú (`copias`), o null si no hay uno corto; nunca la etiqueta sola: la receta Tarea resalta los que
llevan a la tarea sin inventar selectores) y los colores de los enlaces (el color de marca), las variables CSS del sitio declaradas en
`:root`/`html`/`body` (hasta 40: primero las de color, y entre ellas las de fondo), conteos de enlaces y botones, y el esquema de color. Los ids y clases que parecen generados (hashes, números largos) o que
necesitarían escaparse en CSS no se incluyen: el tema no puede usar barras invertidas.
"""

import json

from playwright.async_api import Page

from disenador import config

_MAPA_JS = r"""() => {
  const vw = innerWidth, vh = innerHeight;
  const generada = /(^|[-_])(css|sc|jsx|emotion|svelte|tw)-|[0-9a-f]{6,}|\d{4,}|^_|__[A-Za-z0-9]{5,}$/;
  const segura = /^[A-Za-z_-][A-Za-z0-9_-]*$/;
  const estable = (nombre) => nombre.length <= 40 && segura.test(nombre) && !generada.test(nombre);
  const clases = (el) => [...el.classList].filter(estable).slice(0, 5);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  const caja = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
  };
  const texto = (el, max = 70) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, max);
  const selector = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id && estable(el.id)) return s + "#" + el.id;
    const c = clases(el).slice(0, 2);
    return c.length ? s + "." + c.join(".") : s;
  };
  // Un selector que encuentra solo a este elemento (para los botones y enlaces que la receta Tarea copia tal cual):
  // id, clases, href (completo o su comienzo), aria-label o, si nada de eso lo distingue, su posición bajo el
  // landmark o el id más cercano. null si no hay uno corto: nunca la etiqueta sola (`a` resalta todos los enlaces).
  const citable = (valor) => valor.length <= 80 && !/['\\\n]/.test(valor);
  const unico = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const selectorUnico = (el) => {
    const etiqueta = el.tagName.toLowerCase();
    const candidatos = [];
    if (el.id && estable(el.id)) candidatos.push(etiqueta + "#" + el.id);
    const c = clases(el);
    if (c.length) candidatos.push(etiqueta + "." + c.slice(0, 2).join("."), etiqueta + "." + c.join("."));
    const href = el.getAttribute("href");
    if (href) {
      const crudo = href.trim();
      if (citable(crudo)) candidatos.push(etiqueta + "[href='" + crudo + "']");
      const comienzo = crudo.slice(0, 60);
      if (comienzo.length >= 8 && citable(comienzo)) candidatos.push(etiqueta + "[href^='" + comienzo + "']");
    }
    const aria = el.getAttribute("aria-label");
    if (aria && citable(aria)) candidatos.push(etiqueta + "[aria-label='" + aria + "']");
    const elegido = candidatos.find(unico);
    if (elegido) return elegido;
    // El mismo enlace en dos menús (escritorio y celular): el candidato dentro del ancestro que lo distingue (con id
    // estable, un landmark o clases que solo tiene él).
    for (let ancestro = el.parentElement, nivel = 0; ancestro && ancestro !== document.body && nivel < 8; ancestro = ancestro.parentElement, nivel += 1) {
      const nombre = ancestro.tagName.toLowerCase();
      const anclas = [];
      if (ancestro.id && estable(ancestro.id)) anclas.push(nombre + "#" + ancestro.id);
      if (/^(header|nav|main|footer|aside)$/.test(nombre)) anclas.push(nombre);
      const ca = clases(ancestro);
      if (ca.length) anclas.push(nombre + "." + ca.slice(0, 2).join("."));
      for (const ancla of anclas.filter(unico)) {
        const dentro = candidatos.map((candidato) => ancla + " " + candidato).find(unico);
        if (dentro) return dentro;
      }
    }
    // Posición: etiqueta:nth-of-type(n) hasta un ancla (id estable o landmark), como mucho 4 niveles (la regla de
    // la skill para los selectores del tema).
    const pasos = [];
    for (let actual = el; actual && actual !== document.documentElement && pasos.length < 4; actual = actual.parentElement) {
      const nombre = actual.tagName.toLowerCase();
      if (actual !== el && actual.id && estable(actual.id)) { pasos.unshift(nombre + "#" + actual.id); break; }
      if (actual !== el && /^(header|nav|main|footer|aside)$/.test(nombre) && unico(nombre)) { pasos.unshift(nombre); break; }
      const hermanos = actual.parentElement ? [...actual.parentElement.children].filter((h) => h.tagName === actual.tagName) : [actual];
      pasos.unshift(hermanos.length > 1 ? nombre + ":nth-of-type(" + (hermanos.indexOf(actual) + 1) + ")" : nombre);
    }
    const ruta = pasos.join(" > ");
    return pasos.length > 1 && unico(ruta) ? ruta : null;
  };
  // Un enlace repetido tal cual en otro menú (el de escritorio y el del celular): si no hay un selector corto solo
  // para él, sirve el de su href, que encuentra solo sus copias (mismo destino). El mapa dice cuántas son.
  const selectorDeEnlace = (a) => {
    const propio = selectorUnico(a);
    if (propio) return { selector: propio };
    const crudo = (a.getAttribute("href") || "").trim();
    if (!crudo || !citable(crudo)) return { selector: null };
    const sel = "a[href='" + crudo + "']";
    const copias = document.querySelectorAll(sel).length;
    return copias > 1 && copias <= 3 ? { selector: sel, copias } : { selector: null };
  };
  const estilo = (el) => {
    const cs = getComputedStyle(el);
    const e = { fondo: cs.backgroundColor, color: cs.color, letra_px: parseFloat(cs.fontSize) };
    if (cs.backgroundImage !== "none") e.imagen_de_fondo = true;
    if (cs.position === "fixed" || cs.position === "sticky") e.posicion = cs.position;
    return e;
  };
  const nodo = (el) => {
    const n = { selector: selector(el), caja: caja(el) };
    if (el.id && estable(el.id)) n.id = el.id;
    const c = clases(el);
    if (c.length) n.clases = c;
    const rol = el.getAttribute("role");
    if (rol) n.rol = rol;
    const aria = el.getAttribute("aria-label");
    if (aria) n.aria_label = aria.slice(0, 60);
    return Object.assign(n, estilo(el));
  };
  const unicos = (lista) => [...new Set(lista)];

  const landmarks = unicos([...document.querySelectorAll(
    "header, nav, main, aside, footer, [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=search]"
  )]).filter(visible).slice(0, 20).map((el) => ({ etiqueta: el.tagName.toLowerCase(), ...nodo(el) }));

  const encabezados = [...document.querySelectorAll("h1, h2, h3, h4")].filter(visible).slice(0, 25).map((el) => ({
    nivel: Number(el.tagName[1]), texto: texto(el), selector: selector(el), letra_px: parseFloat(getComputedStyle(el).fontSize),
    color: getComputedStyle(el).color, y: caja(el)[1],
  }));

  // Contenedores grandes: hasta 6 niveles bajo <body>, sin repetir envoltorios del mismo tamaño que su padre.
  const contenedores = [];
  const area = vw * vh;
  const recorrer = (el, nivel, cajaPadre) => {
    if (nivel > 6 || contenedores.length >= 30) return;
    for (const hijo of el.children) {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "svg", "IMG", "LINK", "META"].includes(hijo.tagName)) continue;
      if (!visible(hijo)) continue;
      const c = caja(hijo);
      const grande = c[2] * Math.min(c[3], vh) >= area * 0.04;
      if (!grande) continue;
      const envoltorio = cajaPadre && Math.abs(c[2] - cajaPadre[2]) < 4 && Math.abs(c[3] - cajaPadre[3]) < 4;
      if (!envoltorio) contenedores.push({ nivel, etiqueta: hijo.tagName.toLowerCase(), ...nodo(hijo) });
      recorrer(hijo, nivel + 1, c);
    }
  };
  if (document.body) recorrer(document.body, 1, null);

  const principal = document.querySelector("main, [role=main]") || document.body;
  const primero = (sel, raiz = principal) => [...raiz.querySelectorAll(sel)].find(visible) || [...document.querySelectorAll(sel)].find(visible);
  const claves = {};
  for (const [nombre, el] of Object.entries({
    html: document.documentElement, body: document.body, principal, h1: primero("h1"), h2: primero("h2"),
    parrafo: primero("p"), enlace: primero("a[href]"), boton: primero("button, [role=button], input[type=submit]"),
    campo: primero("input:not([type=hidden]):not([type=submit]), textarea, select"), tabla: primero("table"),
  })) {
    if (el) claves[nombre] = { selector: selector(el), ...estilo(el), familia: getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() };
  }

  // Botones y enlaces con fondo propio (los "principales"): de ahí sale el color de marca.
  const transparente = (color) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
  const fondoBody = document.body ? getComputedStyle(document.body).backgroundColor : "";
  const destacados = [...document.querySelectorAll("button, [role=button], a[href], input[type=submit], input[type=button]")]
    .filter(visible)
    .filter((el) => { const f = getComputedStyle(el).backgroundColor; return !transparente(f) && f !== fondoBody; })
    .slice(0, 6)
    .map((el) => ({ ...nodo(el), selector: selectorUnico(el), texto: texto(el, 40) }));
  // Enlaces de la cabecera y la navegación (hasta 15, sin repetir): texto visible, href sin consulta y un selector
  // que encuentra ese enlace. No se filtran por la tarea: el modelo elige.
  const enlacesDeNavegacion = (() => {
    const lista = [];
    const vistos = new Set();
    const zonas = unicos([...document.querySelectorAll("header, nav, [role=banner], [role=navigation]")]).filter(visible);
    for (const zona of zonas) {
      for (const a of zona.querySelectorAll("a[href]")) {
        if (lista.length >= 15) return lista;
        const rotulo = texto(a, 40);
        if (!rotulo || !visible(a)) continue;
        const crudo = a.getAttribute("href").trim();
        let href = crudo.replace(/[?].*$/, "");
        try {
          const url = new URL(crudo, location.href);
          if (/^[a-z]+:/i.test(crudo) && url.origin === location.origin) href = url.pathname + url.hash;
        } catch { /* href raro: queda como está */ }
        const clave = rotulo + "|" + href;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        lista.push({ texto: rotulo, href: href.slice(0, 80), ...selectorDeEnlace(a) });
      }
    }
    return lista;
  })();
  const enlaces = [...principal.querySelectorAll("a[href]")].filter(visible).slice(0, 40);
  const coloresDeEnlace = {};
  for (const el of enlaces) {
    const color = getComputedStyle(el).color;
    coloresDeEnlace[color] = (coloresDeEnlace[color] || 0) + 1;
  }

  // Variables CSS del sitio declaradas en :root, html o body (hojas legibles y estilo en línea), con su valor
  // calculado; primero las que parecen colores. Las hojas de otro origen no se pueden leer y se saltan.
  const variables = (() => {
    const nombres = new Set();
    const raiz = /^(:root|html|body)$/i;
    const visitar = (reglas) => {
      for (const regla of reglas) {
        if (nombres.size >= 400) return;
        if (regla.selectorText && regla.selectorText.split(",").some((s) => raiz.test(s.trim()))) {
          for (const propiedad of regla.style) if (propiedad.startsWith("--")) nombres.add(propiedad);
        } else if (regla.cssRules && !regla.selectorText) {
          visitar(regla.cssRules);
        }
      }
    };
    for (const hoja of document.styleSheets) {
      try { visitar(hoja.cssRules); } catch { /* hoja de otro origen */ }
    }
    for (const el of [document.documentElement, document.body]) {
      if (el) for (const propiedad of el.style) if (propiedad.startsWith("--")) nombres.add(propiedad);
    }
    const calculado = getComputedStyle(document.body || document.documentElement);
    const esColor = (v) => /^(#|rgb|hsl|hwb|oklch|oklab|lab|lch|color\()/i.test(v);
    const lista = [...nombres].map((n) => [n, calculado.getPropertyValue(n).trim()]).filter(([, v]) => v && v.length <= 80);
    // Primero los colores; entre ellos, fondos y superficies, después texto, borde y marca; al final los estados
    // (hover, active, focus...), que sobran para un tema. Sin esto, en sitios con cientos de variables (Codex de
    // Wikipedia) las 40 primeras eran solo de texto y el modelo no veía ninguna de fondo.
    const puntaje = ([n, v]) => esColor(v) * 8 + /background|-bg|surface|fondo/i.test(n) * 4
      + /text|-fg|foreground|color-base|border|link|primary|accent|brand/i.test(n) * 2
      - /hover|active|focus|visited|disabled|placeholder|pressed/i.test(n) * 6;
    lista.sort((a, b) => puntaje(b) - puntaje(a));
    return { total: lista.length, valores: Object.fromEntries(lista.slice(0, 40)) };
  })();

  const contar = (sel) => [...document.querySelectorAll(sel)].filter(visible).length;
  const metaEsquema = document.querySelector("meta[name=color-scheme]");
  return {
    url: location.href,
    titulo: document.title,
    viewport: [vw, vh],
    documento: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    clases_html: [...document.documentElement.classList].filter(estable).slice(0, 12),
    esquema_de_color: {
      meta: metaEsquema ? metaEsquema.content : null,
      html: getComputedStyle(document.documentElement).colorScheme,
    },
    conteos: {
      enlaces: contar("a[href]"), botones: contar("button, [role=button], input[type=submit], input[type=button]"),
      campos: contar("input:not([type=hidden]), textarea, select"), imagenes: contar("img, picture, svg"),
      iframes: contar("iframe"), tablas: contar("table"), elementos: document.getElementsByTagName("*").length,
    },
    claves,
    botones_destacados: destacados,
    enlaces_de_navegacion: enlacesDeNavegacion,
    colores_de_enlace: Object.entries(coloresDeEnlace).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([color, n]) => ({ color, enlaces: n })),
    variables_css: variables,
    landmarks,
    encabezados,
    contenedores,
  };
}"""


async def construir_mapa(page: Page) -> dict:
    return await page.evaluate(_MAPA_JS)


def como_texto(mapa: dict, max_caracteres: int = config.MAPA_MAX_CARACTERES) -> str:
    """JSON compacto para el prompt; si no cabe, recorta los contenedores, los encabezados, los enlaces de la
    navegación y al final los landmarks."""
    recortado = dict(mapa)
    for clave in ("contenedores", "encabezados", "enlaces_de_navegacion", "landmarks"):
        while len(json.dumps(recortado, ensure_ascii=False, separators=(",", ":"))) > max_caracteres and recortado.get(clave):
            recortado[clave] = recortado[clave][: len(recortado[clave]) * 3 // 4]
    return json.dumps(recortado, ensure_ascii=False, separators=(",", ":"))
