"""Métricas deterministas de un tema, medidas en la misma página antes y después de aplicarlo.

Aproximaciones (documentadas también en el README):
- **Visible:** caja de más de 1x1 px, `checkVisibility` con opacidad y visibilidad, opacidad efectiva (el producto
  de la del elemento y sus ancestros) mayor que 0,05, sin un `clip-path` (`inset`, `circle`, `ellipse`) o un `clip`
  que lo recorte entero, suyo o de un ancestro, y no corrida fuera del documento por la izquierda o arriba. Un
  elemento recortado por un `overflow: hidden` de un ancestro cuenta como visible.
- **Contraste (WCAG 2):** se muestrean hasta `MAX_MUESTRAS_TEXTO` elementos con texto propio visibles en toda la
  página. El fondo efectivo se calcula subiendo por los ancestros y componiendo sus `background-color` con alfa hasta
  uno opaco; si no hay, el lienzo blanco. Los colores se convierten a sRGB con un canvas (sirve para `oklch()` y
  cualquier otro formato). Los `filter` de los ancestros se aplican a texto y fondo si son `invert`, `brightness`,
  `contrast`, `grayscale`, `saturate` o `hue-rotate` (estos tres últimos se ignoran: casi no cambian la luminancia).
  Una muestra queda **incierta** si algún ancestro tiene imagen de fondo o degradado, u otro filtro; las inciertas
  cuentan en el total pero se informan aparte. No se considera la `opacity` de los ancestros ni las sombras de texto.
  Umbral AA: 4,5:1, o 3:1 para texto grande (24 px, o 18,66 px en negrita).
- **Contenido perdido:** enlaces, botones y campos visibles antes que después ya no lo están: salieron del DOM sin
  un reemplazo igual (misma etiqueta, texto y `href`, como cuando una SPA vuelve a pintar), dejaron de ser visibles,
  su texto quedó transparente (`color` o `-webkit-text-fill-color`) o, si su centro está en el viewport, otro
  elemento que no es suyo quedó encima (`elementFromPoint`) cuando antes no lo estaba.
- **Ruido:** entre "antes" y el tema se mide otra vez sin tema, tras la misma espera (`fase="ruido"`): lo que se
  pierde ahí (carruseles, re-renders) no se le cuenta al tema y se informa aparte (`perdidos_ruido`, `ocultos_ruido`).
- **Ocultos:** de los primeros `MAX_ELEMENTOS` elementos visibles antes, cuántos dejaron de estarlo (o su texto propio
  quedó transparente).
"""

import statistics

from playwright.async_api import Page

from disenador import config

_MEDIR_JS = r"""([fase, maxMuestras, maxElementos]) => {
  const INTERACTIVOS = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem]";
  const anchoDoc = () => Math.max(document.documentElement.scrollWidth, innerWidth);
  // Opacidad efectiva y recortes, memorizados por nodo (los ancestros se comparten).
  const memoOpacidad = new Map(), memoRecorte = new Map();
  const opacidad = (n) => {
    if (!n) return 1;
    if (!memoOpacidad.has(n)) memoOpacidad.set(n, parseFloat(getComputedStyle(n).opacity) * opacidad(n.parentElement));
    return memoOpacidad.get(n);
  };
  const largo = (v, ref) => (v.endsWith("%") ? (parseFloat(v) / 100) * ref : parseFloat(v)) || 0;
  const recortePropio = (n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    const cp = cs.clipPath || "none";
    let m;
    if ((m = cp.match(/^inset\(([^)]*?)(?:\s+round\b[^)]*)?\)/))) {
      const v = m[1].trim().split(/\s+/);
      const [t, d, b, i] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
      if (largo(t, r.height) + largo(b, r.height) >= r.height - 1 || largo(i, r.width) + largo(d, r.width) >= r.width - 1) return true;
    } else if ((m = cp.match(/^(circle|ellipse)\(\s*([\d.]+(?:px|%)?)(?:\s+([\d.]+(?:px|%)?))?/))) {
      if (largo(m[2], Math.min(r.width, r.height)) <= 0.5 || (m[3] && largo(m[3], r.height) <= 0.5)) return true;
    }
    if (["absolute", "fixed"].includes(cs.position) && (m = cs.clip.match(/^rect\(([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px\)$/))) {
      const [, t, d, b, i] = m.map(Number);
      if (b - t <= 1 || d - i <= 1) return true;
    }
    return false;
  };
  const recortado = (n) => {
    if (!n) return false;
    if (!memoRecorte.has(n)) memoRecorte.set(n, recortePropio(n) || recortado(n.parentElement));
    return memoRecorte.get(n);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    if (opacidad(el) <= 0.05 || recortado(el)) return false;
    const x = r.left + scrollX, y = r.top + scrollY;
    return x + r.width > 0 && y + r.height > 0 && x < anchoDoc();
  };
  const describir = (el) => ({
    etiqueta: el.tagName.toLowerCase(),
    texto: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.getAttribute("placeholder") || "")
      .replace(/\s+/g, " ").trim().slice(0, 60),
    ...(el.getAttribute("href") ? { href: el.getAttribute("href").slice(0, 100) } : {}),
  });

  // Colores: cualquier formato a [r, g, b, a] en sRGB, con un canvas.
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = 1;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (color) => {
    if (cache.has(color)) return cache.get(color);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const valor = [d[0], d[1], d[2], d[3] / 255];
    cache.set(color, valor);
    return valor;
  };
  const sobre = (arriba, abajo) => [0, 1, 2].map((i) => arriba[i] * arriba[3] + abajo[i] * (1 - arriba[3]));
  const cantidad = (arg) => {
    const t = (arg || "1").trim();
    return t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
  };
  const filtrar = (c, filtros) => {
    let r = c.slice();
    for (const f of filtros) {
      for (const [, nombre, arg] of f.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        const a = cantidad(arg);
        if (nombre === "invert") r = r.map((v) => v * (1 - a) + (255 - v) * a);
        else if (nombre === "brightness") r = r.map((v) => Math.min(255, v * a));
        else if (nombre === "contrast") r = r.map((v) => Math.min(255, Math.max(0, (v - 128) * a + 128)));
      }
    }
    return r;
  };
  const FILTROS_CONOCIDOS = /^(invert|brightness|contrast|grayscale|saturate|hue-rotate)$/;
  const luminancia = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const razon = (a, b) => {
    const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  // Texto transparente: todos sus nodos de texto (los propios, o también los de sus descendientes) sin tinta.
  const sinTinta = (n) => rgba(getComputedStyle(n).webkitTextFillColor || getComputedStyle(n).color)[3] <= 0.05;
  const textoInvisible = (el, descendientes) => {
    const padres = new Set();
    if (descendientes) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t && padres.size < 30; t = w.nextNode()) if (t.nodeValue.trim()) padres.add(t.parentElement);
    } else {
      for (const t of el.childNodes) if (t.nodeType === 3 && t.nodeValue.trim()) { padres.add(el); break; }
    }
    return padres.size > 0 && [...padres].every(sinTinta);
  };
  // Si otro elemento, que no es suyo ni un ancestro, quedó encima de su centro. null: fuera del viewport.
  const cubierto = (el) => {
    const r = [...el.getClientRects()].find((c) => c.width > 1 && c.height > 1) || el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const encima = document.elementFromPoint(x, y);
    if (!encima) return null;
    return encima !== el && !el.contains(encima) && !encima.contains(el);
  };
  const firma = (el) => [el.tagName, (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80), el.getAttribute("href") || ""].join("|");

  const contraste = (el) => {
    const capas = [], filtros = [];
    let incierto = false, opaco = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.filter && cs.filter !== "none") {
        filtros.push(cs.filter);
        for (const [, nombre] of cs.filter.matchAll(/([a-z-]+)\(/g)) if (!FILTROS_CONOCIDOS.test(nombre)) incierto = true;
      }
      if (opaco) continue;
      if (cs.backgroundImage && cs.backgroundImage !== "none") incierto = true;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) {
        capas.push(c);
        if (c[3] >= 0.999) opaco = true;
      }
    }
    let fondo = [255, 255, 255];
    for (const capa of capas.reverse()) fondo = sobre(capa, fondo);
    const cs = getComputedStyle(el);
    let texto = sobre(rgba(cs.color), fondo);
    fondo = filtrar(fondo, filtros);
    texto = filtrar(texto, filtros);
    const letra = parseFloat(cs.fontSize);
    const grande = letra >= 24 || (letra >= 18.66 && Number(cs.fontWeight) >= 700);
    return { razon: razon(texto, fondo), umbral: grande ? 3 : 4.5, letra, incierto, texto: hex(texto), fondo: hex(fondo) };
  };

  const conTexto = new Set();
  const caminante = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let t = caminante.nextNode(); t; t = caminante.nextNode()) {
    if (t.nodeValue.trim().length >= 2 && t.parentElement) conTexto.add(t.parentElement);
  }
  let textos = [...conTexto].filter(visible);
  if (textos.length > maxMuestras) {
    const paso = textos.length / maxMuestras;
    textos = Array.from({ length: maxMuestras }, (_, i) => textos[Math.floor(i * paso)]);
  }
  const muestras = textos.map((el) => ({ el, ...contraste(el) }));
  const fallan = muestras.filter((m) => m.razon < m.umbral);
  const letras = muestras.map((m) => m.letra).sort((a, b) => a - b);

  const todos = [...(document.body || document.documentElement).getElementsByTagName("*")];
  const visibles = [];
  for (const el of todos) {
    if (visibles.length >= maxElementos) break;
    if (visible(el)) visibles.push(el);
  }
  const interactivos = [...document.querySelectorAll(INTERACTIVOS)].filter(visible);
  const resultado = {
    interactivos: interactivos.length,
    enlaces: interactivos.filter((el) => el.matches("a[href], [role=link]")).length,
    botones: interactivos.filter((el) => el.matches("button, [role=button], input[type=submit], input[type=button]")).length,
    campos: interactivos.filter((el) => el.matches("input:not([type=submit]):not([type=button]), select, textarea")).length,
    contraste: {
      muestras: muestras.length,
      fallan: fallan.length,
      proporcion_falla: muestras.length ? +(fallan.length / muestras.length).toFixed(4) : 0,
      inciertas: muestras.filter((m) => m.incierto).length,
      peores: fallan.sort((a, b) => a.razon - b.razon).slice(0, 6).map((m) => ({
        texto: (m.el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50), razon: +m.razon.toFixed(2),
        color: m.texto, fondo: m.fondo, letra_px: m.letra, ...(m.incierto ? { incierta: true } : {}),
      })),
    },
    letras_px: letras,
    desborde_horizontal: document.documentElement.scrollWidth > innerWidth + 1,
    ancho_documento: document.documentElement.scrollWidth,
    fijos: visibles.filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position)).length,
  };

  if (fase === "antes") {
    window.__mtMedicion = {
      interactivos: interactivos.map((el) => ({ el, firma: firma(el), sinTexto: textoInvisible(el, true), cubierto: cubierto(el) })),
      visibles: visibles.map((el) => ({ el, sinTexto: textoInvisible(el, false) })),
      ruido: { interactivos: new Set(), visibles: new Set() },
    };
    return resultado;
  }
  const medicion = window.__mtMedicion;
  if (!medicion) return resultado;
  // Un interactivo que salió del DOM no está perdido si hay otro igual visible (la SPA lo volvió a pintar).
  const firmasActuales = new Set(interactivos.map(firma));
  const perdido = (s) => {
    if (!s.el.isConnected) return !firmasActuales.has(s.firma);
    if (!visible(s.el)) return true;
    if (!s.sinTexto && textoInvisible(s.el, true)) return true;
    return s.cubierto === false && cubierto(s.el) === true;
  };
  const oculto = (s) => !s.el.isConnected || !visible(s.el) || (!s.sinTexto && textoInvisible(s.el, false));
  const interactivosPerdidos = medicion.interactivos.filter(perdido);
  const visiblesOcultos = medicion.visibles.filter(oculto);
  if (fase === "ruido") {
    // Lo que se pierde sin tema, con la misma espera: carruseles, re-renders, banners. No se le cuenta al tema.
    interactivosPerdidos.forEach((s) => medicion.ruido.interactivos.add(s));
    visiblesOcultos.forEach((s) => medicion.ruido.visibles.add(s));
    resultado.perdidos_ruido = interactivosPerdidos.length;
    resultado.ocultos_ruido = visiblesOcultos.length;
    return resultado;
  }
  const perdidos = interactivosPerdidos.filter((s) => !medicion.ruido.interactivos.has(s));
  resultado.perdidos_total = perdidos.length;
  resultado.perdidos = perdidos.slice(0, 30).map((s) => describir(s.el));
  resultado.perdidos_ruido = interactivosPerdidos.length - perdidos.length;
  resultado.ocultos = visiblesOcultos.filter((s) => !medicion.ruido.visibles.has(s)).length;
  resultado.ocultos_ruido = visiblesOcultos.length - resultado.ocultos;
  resultado.seguidos = medicion.visibles.length;
  return resultado;
}"""


async def medir(page: Page, fase: str) -> dict:
    """Mide la página. `fase="antes"` guarda en la página qué estaba visible; `"ruido"`, sin tema y tras la misma
    espera que el tema, anota lo que se pierde solo; `"despues"` compara con "antes" sin contar ese ruido."""
    datos = await page.evaluate(_MEDIR_JS, [fase, config.MAX_MUESTRAS_TEXTO, config.MAX_ELEMENTOS])
    letras = datos.pop("letras_px")
    datos["letra_min_px"] = letras[0] if letras else None
    datos["letra_mediana_px"] = statistics.median(letras) if letras else None
    return datos


def combinar(viewports: dict[str, dict], analisis_css: dict, sin_clase: dict[str, dict]) -> dict:
    """metricas.json: por viewport (antes, después, perdidos), el CSS y una fila plana para el resumen.

    `viewports[nombre]` es {"antes": medir(antes), "ruido": medir(ruido) (opcional), "despues": medir(despues)};
    `sin_clase[nombre]` es la comparación
    de la página con el tema apagado contra la original.
    """
    por_viewport = {}
    for nombre, medidas in viewports.items():
        antes, despues = medidas["antes"], dict(medidas["despues"])
        perdidos = despues.pop("perdidos", [])
        por_viewport[nombre] = {
            "antes": antes,
            **({"ruido": medidas["ruido"]} if medidas.get("ruido") else {}),
            "despues": despues,
            "perdidos": perdidos,
            "sin_mi_tema": sin_clase.get(nombre),
        }
    escritorio = por_viewport.get("escritorio", {})
    movil = por_viewport.get("movil", {})

    def valor(vista: dict, fase: str, *claves):
        dato = vista.get(fase) or {}
        for clave in claves:
            dato = (dato or {}).get(clave)
        return dato

    fila = {
        "contraste_falla_antes": valor(escritorio, "antes", "contraste", "proporcion_falla"),
        "contraste_falla_despues": valor(escritorio, "despues", "contraste", "proporcion_falla"),
        "contraste_falla_movil_despues": valor(movil, "despues", "contraste", "proporcion_falla"),
        "contraste_inciertas_despues": valor(escritorio, "despues", "contraste", "inciertas"),
        "perdidos": sum((vista.get("despues") or {}).get("perdidos_total", 0) for vista in por_viewport.values()),
        "perdidos_ruido": sum((vista.get("despues") or {}).get("perdidos_ruido", 0) for vista in por_viewport.values()),
        "ocultos": sum((vista.get("despues") or {}).get("ocultos", 0) for vista in por_viewport.values()),
        "letra_min_despues": valor(escritorio, "despues", "letra_min_px"),
        "letra_mediana_antes": valor(escritorio, "antes", "letra_mediana_px"),
        "letra_mediana_despues": valor(escritorio, "despues", "letra_mediana_px"),
        "desborde_movil_despues": valor(movil, "despues", "desborde_horizontal"),
        "fijos_agregados": sum(
            ((vista.get("despues") or {}).get("fijos", 0) - (vista.get("antes") or {}).get("fijos", 0))
            for vista in por_viewport.values()
        ),
        "sin_mi_tema_identica": all(c.get("identica") for c in sin_clase.values()) if sin_clase else None,
        "violaciones": len(analisis_css["fuera_de_mi_tema"]),
        "violaciones_navegador": len(analisis_css.get("violaciones_navegador") or []),
        "rechazos": len(analisis_css["rechazos"]),
        "bytes_css": analisis_css["bytes"],
        "reglas": analisis_css["reglas"],
        "important": analisis_css["important"],
        "riesgos": analisis_css["filtros"] + analisis_css["backdrop_filter"] + analisis_css["selectores_universales"]
        + analisis_css["transiciones_de_layout"] + analisis_css["position_fixed"],
    }
    return {"viewports": por_viewport, "css": analisis_css, "fila": fila}
