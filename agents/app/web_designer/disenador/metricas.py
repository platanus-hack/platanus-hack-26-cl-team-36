"""Métricas deterministas de un tema, medidas en la misma página antes y después de aplicarlo.

Aproximaciones (documentadas también en el README):
- **Visible:** caja de más de 1x1 px, `checkVisibility` con opacidad y visibilidad, y no corrida fuera del documento
  por la izquierda o arriba. Un elemento recortado por un `overflow: hidden` de un ancestro cuenta como visible.
- **Contraste (WCAG 2):** se muestrean hasta `MAX_MUESTRAS_TEXTO` elementos con texto propio visibles en toda la
  página. El fondo efectivo se calcula subiendo por los ancestros y componiendo sus `background-color` con alfa hasta
  uno opaco; si no hay, el lienzo blanco. Los colores se convierten a sRGB con un canvas (sirve para `oklch()` y
  cualquier otro formato). Los `filter` de los ancestros se aplican a texto y fondo si son `invert`, `brightness`,
  `contrast`, `grayscale`, `saturate` o `hue-rotate` (estos tres últimos se ignoran: casi no cambian la luminancia).
  Una muestra queda **incierta** si algún ancestro tiene imagen de fondo o degradado, u otro filtro; las inciertas
  cuentan en el total pero se informan aparte. No se considera la `opacity` de los ancestros ni las sombras de texto.
  Umbral AA: 4,5:1, o 3:1 para texto grande (24 px, o 18,66 px en negrita).
- **Contenido perdido:** enlaces, botones y campos visibles antes que después ya no lo están (o salieron del DOM).
- **Ocultos:** de los primeros `MAX_ELEMENTOS` elementos visibles antes, cuántos dejaron de estarlo.
"""

import statistics

from playwright.async_api import Page

from disenador import config

_MEDIR_JS = r"""([fase, maxMuestras, maxElementos]) => {
  const INTERACTIVOS = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem]";
  const anchoDoc = () => Math.max(document.documentElement.scrollWidth, innerWidth);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
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
    window.__mtMedicion = { interactivos, visibles };
  } else if (window.__mtMedicion) {
    const perdidos = window.__mtMedicion.interactivos.filter((el) => !el.isConnected || !visible(el));
    resultado.perdidos_total = perdidos.length;
    resultado.perdidos = perdidos.slice(0, 30).map(describir);
    resultado.ocultos = window.__mtMedicion.visibles.filter((el) => !el.isConnected || !visible(el)).length;
    resultado.seguidos = window.__mtMedicion.visibles.length;
  }
  return resultado;
}"""


async def medir(page: Page, fase: str) -> dict:
    """Mide la página. Con `fase="antes"` guarda en la página qué estaba visible; `"despues"` lo compara."""
    datos = await page.evaluate(_MEDIR_JS, [fase, config.MAX_MUESTRAS_TEXTO, config.MAX_ELEMENTOS])
    letras = datos.pop("letras_px")
    datos["letra_min_px"] = letras[0] if letras else None
    datos["letra_mediana_px"] = statistics.median(letras) if letras else None
    return datos


def combinar(viewports: dict[str, dict], analisis_css: dict, sin_clase: dict[str, dict]) -> dict:
    """metricas.json: por viewport (antes, después, perdidos), el CSS y una fila plana para el resumen.

    `viewports[nombre]` es {"antes": medir(antes), "despues": medir(despues)}; `sin_clase[nombre]` es la comparación
    de la página con el tema apagado contra la original.
    """
    por_viewport = {}
    for nombre, medidas in viewports.items():
        antes, despues = medidas["antes"], dict(medidas["despues"])
        perdidos = despues.pop("perdidos", [])
        por_viewport[nombre] = {
            "antes": antes,
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
        "rechazos": len(analisis_css["rechazos"]),
        "bytes_css": analisis_css["bytes"],
        "reglas": analisis_css["reglas"],
        "important": analisis_css["important"],
        "riesgos": analisis_css["filtros"] + analisis_css["backdrop_filter"] + analisis_css["selectores_universales"]
        + analisis_css["transiciones_de_layout"] + analisis_css["position_fixed"],
    }
    return {"viewports": por_viewport, "css": analisis_css, "fila": fila}
