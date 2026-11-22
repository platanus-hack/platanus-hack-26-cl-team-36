"""Lo que el motor necesita de un sitio sin carpeta, medido en la página abierta: zonas, rasgos y colores.

Las zonas son selectores estables (ids, landmarks, roles y etiquetas semánticas; una clase solo si es una palabra
legible y encuentra exactamente lo medido), verificados en la página: existen, son únicos cuando deben serlo y lo que
encuentran tiene la forma esperada (una barra arriba con enlaces, títulos de sección, tarjetas repetidas, el pie). Lo
dudoso se descarta y queda anotado en `descartes`. Los rasgos son señales simples: dominio y palabras de institución,
precios y carro de compras, video o imagen grande arriba, campos de un formulario que no es el buscador, y un conjunto
de colores repetido entre hermanos (las líneas de metro, las secciones de un diario).
"""

import re

from playwright.async_api import Page

_MEDIR_JS = r"""() => {
  const vw = innerWidth, vh = innerHeight;
  const generada = /(^|[-_])(css|sc|jsx|emotion|svelte|tw)-|[0-9a-f]{6,}|\d{3,}|^_|__[A-Za-z0-9]{5,}$/;
  const idEstable = (id) => /^[A-Za-z][\w-]{0,39}$/.test(id) && !generada.test(id);
  // Una clase sirve si se lee como nombre (`card`, `site-footer`, `noticiaHome`), no es de utilidad de un framework
  // (`col-sm-4`, `mt-3`) y no parece generada.
  const utilidad = /^(col|row|container|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|p|m|d|w|h|g|gap|flex|text|bg|border|rounded|shadow|order|offset|align|justify|position|float|clearfix|hidden|visible|show|active|sf)(-|$)|^(row|container|clearfix)$/;
  const claseLegible = (c) => /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(c) && /[A-Za-z]{3}/.test(c)
    && (c.match(/\d/g) || []).length <= 2 && !generada.test(c) && !utilidad.test(c) && !/^mt[-_]/.test(c);
  const descartes = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  const caja = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  const todos = (sel) => { try { return [...document.querySelectorAll(sel)]; } catch { return null; } };
  // Único entre lo visible: una copia oculta (la cabecera del celular) puede llevar el mismo estilo.
  const unico = (sel, el) => {
    const l = todos(sel);
    if (!l || !l.length || l.length > 3 || (el && !l.includes(el))) return false;
    return l.filter(visible).length === 1 && (!el || visible(el));
  };
  const LANDMARK = /^(header|nav|main|footer|aside)$/;
  const rol = { header: "banner", nav: "navigation", main: "main", footer: "contentinfo", aside: "complementary" };

  // Un selector estable que encuentra solo a `el`.
  const selectorDe = (el) => {
    const tag = el.tagName.toLowerCase();
    const cands = [];
    if (el.id && idEstable(el.id)) cands.push("#" + el.id);
    if (LANDMARK.test(tag)) cands.push(tag);
    const r = el.getAttribute("role");
    if (r && /^[a-z]+$/.test(r)) cands.push(`[role="${r}"]`);
    for (let a = el.parentElement, n = 0; a && a !== document.documentElement && n < 6; a = a.parentElement, n++) {
      const at = a.tagName.toLowerCase();
      const anclas = [];
      if (a.id && idEstable(a.id)) anclas.push("#" + a.id);
      if (LANDMARK.test(at) && unico(at)) anclas.push(at);
      for (const c of a.classList) if (claseLegible(c) && unico(`${at}.${c}`)) anclas.push(`${at}.${c}`);
      for (const ancla of anclas) cands.push(`${ancla} > ${tag}`, `${ancla} ${tag}`);
    }
    for (const c of el.classList) if (claseLegible(c)) cands.push(`${tag}.${c}`);
    return cands.find((s) => s.length <= 120 && unico(s, el)) || null;
  };

  // Un selector estable para un grupo de hermanos: lo que encuentra debe ser exactamente el grupo.
  const selectorDeGrupo = (padre, hijos) => {
    const tag = hijos[0].tagName.toLowerCase();
    const comunes = [...hijos[0].classList].filter((c) => claseLegible(c) && hijos.every((h) => h.classList.contains(c)));
    const sufijos = [tag, ...comunes.map((c) => `${tag}.${c}`)];
    const base = selectorDe(padre);
    const cands = [];
    if (base) for (const s of sufijos) cands.push(`${base} > ${s}`);
    if (["article", "li"].includes(tag)) {
      for (const s of sufijos) cands.push(s);
    }
    for (const c of comunes) cands.push(`${tag}.${c}`);
    const igual = (sel) => {
      const l = todos(sel);
      return l && l.length === hijos.length && l.every((e) => hijos.includes(e));
    };
    return cands.find((s) => s.length <= 140 && igual(s)) || null;
  };

  const enlaces = (el) => [...el.querySelectorAll("a[href]")].filter(visible);
  const zonas = {};
  const anotar = (zona, motivo) => descartes.push({ zona, motivo });

  // Sin landmarks, un bloque cuyo id o clase lo nombra (`#Header`, `div.cabecera`, `#Footer`).
  const nombrado = (patron) => [...document.querySelectorAll("body *")].filter((el) =>
    patron.test(el.id || "") || [...el.classList].some((c) => patron.test(c)));
  const CABECERA = /^(header|cabecera|encabezado|masthead|site-header|top-?bar)$/i;
  const PIE = /^(footer|pie|pie-de-pagina|site-footer)$/i;

  // Cabecera: el banner arriba.
  const anchoArriba = (el) => visible(el) && caja(el).y < 200 && caja(el).w >= vw * 0.6;
  const cabecera = [...document.querySelectorAll("header, [role=banner]")].find(anchoArriba)
    || nombrado(CABECERA).filter(anchoArriba).sort((a, b) => caja(b).h - caja(a).h)[0];
  if (cabecera) {
    const s = selectorDe(cabecera);
    if (s) zonas.cabecera = s; else anotar("cabecera", "sin selector estable");
  }

  // Navegación: la barra principal arriba, ancha y con al menos tres enlaces.
  const navs = [...document.querySelectorAll("nav, [role=navigation]")].filter(visible)
    .filter((el) => caja(el).y < 400 && caja(el).w >= vw * 0.4 && enlaces(el).length >= 3);
  // Sin <nav>: el bloque más chico arriba que reúne casi todos los enlaces de la franja superior.
  const barra = () => {
    const cands = [...document.querySelectorAll("body *")].filter((el) => visible(el) && caja(el).y < 250
      && caja(el).h < 180 && caja(el).w >= vw * 0.4 && !el.closest(".mt-vista"))
      .map((el) => ({ el, n: [...el.querySelectorAll("a")].filter(visible).length })).filter((c) => c.n >= 4);
    const max = Math.max(0, ...cands.map((c) => c.n));
    return cands.filter((c) => c.n >= max * 0.6).sort((a, b) => caja(a.el).w * caja(a.el).h - caja(b.el).w * caja(b.el).h)
      .map((c) => c.el).find((el) => selectorDe(el)) || null;
  };
  const nav = navs.find((el) => selectorDe(el)) || barra();
  if (nav) {
    const s = selectorDe(nav);
    if (s) {
      zonas.nav = s;
      const enlace = `${s} :is(a, button)`;
      const n = (todos(enlace) || []).length;
      if (n >= 3 && n <= 80) zonas.nav_enlace = enlace; else anotar("nav_enlace", `${n} enlaces`);
    } else anotar("nav", "sin selector estable");
  } else anotar("nav", "no hay una barra de navegación arriba");

  // Lo principal: main o el contenedor con id que tiene el h1 o la mayor parte del texto.
  const principal = [...document.querySelectorAll("main, [role=main]")].find(visible) || null;
  const raiz = principal && selectorDe(principal);

  // Títulos de sección: h2 (o h3 si no hay) visibles, cortos y de letra no menor que el texto.
  for (const nivel of ["h2", "h3"]) {
    const sel = raiz ? `${raiz} ${nivel}` : nivel;
    const lista = (todos(sel) || []).filter((h) => !h.closest("footer, nav, [role=contentinfo]"));
    const visibles = lista.filter(visible);
    const buenos = visibles.filter((h) => h.innerText.trim().length > 1 && h.innerText.trim().length <= 90
      && parseFloat(getComputedStyle(h).fontSize) >= 15);
    if (buenos.length >= 2 && buenos.length <= 30 && buenos.length >= visibles.length * 0.7) {
      const fuera = (todos(sel) || []).length - lista.length;
      zonas.titulos_seccion = fuera ? `${sel}:not(footer *, nav *)` : sel;
      break;
    }
    if (visibles.length) anotar("titulos_seccion", `${nivel}: ${buenos.length} de ${visibles.length} sirven`);
  }

  // Tarjetas: un grupo de al menos tres hermanos iguales, del ancho parecido, con enlace y con imagen, título o texto.
  const pareceTarjeta = (el) => {
    if (!visible(el)) return false;
    const c = caja(el);
    if (c.w < 120 || c.h < 70 || c.w > vw * 0.62 || c.h > vh * 1.2) return false;
    const conEnlace = el.matches("a[href]") || el.querySelector("a[href]");
    const contenido = el.querySelector("img, picture, h2, h3, h4, h5") || el.innerText.trim().length >= 30;
    return conEnlace && contenido;
  };
  const grupos = [];
  for (const padre of document.body.querySelectorAll("*")) {
    if (padre.children.length < 3 || padre.closest("nav, footer, header, [role=navigation], .mt-vista")) continue;
    const porTag = {};
    for (const h of padre.children) (porTag[h.tagName] ||= []).push(h);
    for (const hijos of Object.values(porTag)) {
      const buenos = hijos.filter(pareceTarjeta);
      if (buenos.length < 3 || buenos.length < hijos.length * 0.8) continue;
      const anchos = buenos.map((h) => caja(h).w);
      if (Math.max(...anchos) / Math.min(...anchos) > 1.35) continue;
      if (caja(buenos[0]).y > vh * 4) continue;
      grupos.push({ padre, hijos: buenos, area: buenos.reduce((t, h) => t + caja(h).w * caja(h).h, 0) });
    }
  }
  grupos.sort((a, b) => b.area - a.area);
  const selTarjetas = [];
  // La holgura entre tarjetas vecinas (en fila o en columna): cuánto pueden crecer sin tocarse.
  const holguraDe = (hijos) => {
    let min = 64;
    for (const a of hijos) for (const b of hijos) {
      if (a === b) continue;
      const p = caja(a), q = caja(b);
      const solapanY = p.y < q.y + q.h && q.y < p.y + p.h, solapanX = p.x < q.x + q.w && q.x < p.x + p.w;
      if (solapanY && q.x >= p.x + p.w - 1) min = Math.min(min, q.x - (p.x + p.w));
      if (solapanX && q.y >= p.y + p.h - 1) min = Math.min(min, q.y - (p.y + p.h));
    }
    return Math.max(0, Math.floor(min));
  };
  let holgura = 64;
  for (const g of grupos) {
    if (selTarjetas.length >= 2) break;
    if (grupos.some((o) => o !== g && selTarjetas.length && o.hijos.some((h) => h.contains(g.padre)))) continue;
    const s = selectorDeGrupo(g.padre, g.hijos);
    if (s) { selTarjetas.push(s); holgura = Math.min(holgura, holguraDe(g.hijos)); } else anotar("tarjetas", `grupo de ${g.hijos.length} sin selector estable`);
  }
  if (selTarjetas.length) zonas.tarjetas = selTarjetas.length === 1 ? selTarjetas[0] : `:is(${selTarjetas.join(", ")})`;

  // Pie.
  const pie = [...document.querySelectorAll("footer, [role=contentinfo]"), ...nombrado(PIE)].filter(visible)
    .filter((el) => !el.parentElement.closest("footer, [role=contentinfo]")).sort((a, b) => caja(b).w * caja(b).h - caja(a).w * caja(a).h)[0];
  if (pie && caja(pie).w >= vw * 0.6) {
    const s = selectorDe(pie);
    if (s) zonas.pie = s; else anotar("pie", "sin selector estable");
  } else anotar("pie", "no hay un pie ancho");

  // Logo: la primera imagen de la cabecera dentro de un enlace a la portada (o con «logo» en su nombre).
  if (cabecera && zonas.cabecera) {
    const img = [...cabecera.querySelectorAll("a img, a svg, img, svg")].filter(visible).find((el) => {
      const a = el.closest("a");
      const pista = (el.getAttribute("alt") || "") + (el.getAttribute("src") || "") + (el.getAttribute("class") || "");
      return (a && /^(\/|https?:\/\/[^/]+\/?)(index\.\w+)?$/.test(a.getAttribute("href") || "")) || /logo/i.test(pista);
    });
    const contenedor = img && (img.closest("a") || img);
    const s = contenedor && selectorDe(contenedor);
    if (s) zonas.logo = s; else if (contenedor) anotar("logo", "sin selector estable");
  }

  // Si la franja de arriba y el pie son oscuros (su fondo o el de un bloque ancho dentro): sus logos y textos están
  // pensados para ese fondo.
  const fondoOpaco = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const f = getComputedStyle(e).backgroundColor;
      const m = f.match(/[\d.]+/g);
      if (m && (m.length < 4 || parseFloat(m[3]) > 0.5)) return m.slice(0, 3).map(Number);
    }
    return [255, 255, 255];
  };
  const luz = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const oscuro = (el) => !!el && (luz(fondoOpaco(el)) < 0.45 || [...el.querySelectorAll("*")].filter(visible)
    .some((e) => caja(e).w >= vw * 0.6 && caja(e).h >= 40 && luz(fondoOpaco(e)) < 0.45));

  // Colores candidatos a marca: fondos de botones y franjas, y el color de los enlaces, con su peso.
  const marca = {};
  const sumar = (color, peso) => { if (color && !/rgba\(.*,\s*0\)$/.test(color)) marca[color] = (marca[color] || 0) + peso; };
  for (const el of document.querySelectorAll("button, [role=button], a[href], input[type=submit], header, nav, [role=banner]")) {
    if (!visible(el) || el.closest(".mt-vista")) continue;
    const cs = getComputedStyle(el), c = caja(el);
    const arriba = c.y < vh * 1.5 ? 2 : 1;
    sumar(cs.backgroundColor, Math.min(8, Math.sqrt(c.w * c.h) / 20) * arriba);
    if (el.matches("a[href]")) sumar(cs.color, 0.5 * arriba);
  }

  // Un conjunto de colores repetido: hermanos (4 a 12) donde cada uno lleva un color saturado distinto, propio, en su
  // borde o en una pastilla. Fuera del pie y de los enlaces a redes sociales.
  const rgb = (txt) => { const m = (txt || "").match(/[\d.]+/g); return m && (m.length < 4 || parseFloat(m[3]) > 0.5) ? m.slice(0, 3).map(Number) : null; };
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const saturado = (c) => { if (!c) return false; const [, s, l] = hsl(c); return s >= 0.35 && l >= 0.18 && l <= 0.82; };
  const colorDe = (el) => {
    const cs = getComputedStyle(el);
    for (const lado of ["Left", "Top", "Bottom"]) {
      if (parseFloat(cs[`border${lado}Width`]) >= 2) { const c = rgb(cs[`border${lado}Color`]); if (saturado(c)) return c; }
    }
    const propio = rgb(cs.backgroundColor);
    if (saturado(propio)) return propio;
    for (const d of [...el.querySelectorAll("*")].slice(0, 30)) {
      const r = d.getBoundingClientRect();
      if (r.width < 4 || r.width > 120 || r.height > 120) continue;
      const c = rgb(getComputedStyle(d).backgroundColor);
      if (saturado(c)) return c;
    }
    return null;
  };
  const social = /facebook|twitter|x\.com|instagram|youtube|linkedin|tiktok|whatsapp|flickr|spotify/i;
  let categorias = null;
  for (const padre of document.body.querySelectorAll("*")) {
    const hijos = [...padre.children].filter(visible);
    if (hijos.length < 4 || hijos.length > 12 || padre.closest("footer, [role=contentinfo], .mt-vista")) continue;
    if (hijos.some((h) => h.querySelector("a[href]") && social.test(h.querySelector("a[href]").href))) continue;
    if (caja(padre).y > vh * 3) continue;
    const colores = hijos.map(colorDe);
    const con = colores.filter(Boolean);
    if (con.length < 4 || con.length < hijos.length * 0.7) continue;
    const tonos = new Set(con.map((c) => Math.round(hsl(c)[0] / 30) % 12));
    if (tonos.size < 4) continue;
    const lista = [];
    hijos.forEach((h, i) => {
      if (!colores[i]) return;
      const nombre = (h.innerText || h.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40);
      lista.push({ nombre: nombre || `Categoría ${lista.length + 1}`, color: `rgb(${colores[i].join(", ")})` });
    });
    if (!categorias || tonos.size > categorias.tonos) categorias = { tonos: tonos.size, lista };
  }

  // Rasgos.
  const textoVisible = (document.body.innerText || "").slice(0, 60000);
  const pieTexto = pie ? pie.innerText.slice(0, 4000) : "";
  const precios = (textoVisible.match(/(?:\$|US\$|CLP)\s?\d{1,3}(?:[.,]\d{3})+(?![\d])/g) || []).length;
  const carro = /\b(carro de compras?|carrito|agregar al carro|añadir al carrito|add to cart|comprar ahora|mi carro)\b/i.test(textoVisible)
    || !!document.querySelector("a[href*='/cart'], a[href*=carrito], a[href*=checkout], [aria-label*='carro de compra' i]");
  const institucionTexto = /\b(gobierno|ministerio|servicio de|subsecretar|municipalidad|instituto|biblioteca|universidad|tribunal|superintendencia|transparencia|ley de|tr[aá]mites?)\b/i;
  const videos = [...document.querySelectorAll("video, iframe[src*=youtube], iframe[src*=vimeo]")].filter(visible)
    .filter((v) => { const c = caja(v); return c.y < vh && c.w * Math.min(c.h, vh) >= vw * vh * 0.2; });
  const heroImagen = [...document.querySelectorAll("img, picture, [style*=background], section, div")].filter(visible)
    .some((el) => {
      const c = caja(el);
      if (c.y > vh * 0.6 || c.w < vw * 0.6 || Math.min(c.h, vh) < vh * 0.35) return false;
      return el.matches("img, picture") || getComputedStyle(el).backgroundImage.startsWith("url(")
        || [...el.children].some((h) => h.matches("img, picture") && caja(h).w >= vw * 0.6);
    });
  const buscador = (el) => el.type === "search" || /busca|search|^q$|query/i.test(
    `${el.name} ${el.id} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`)
    || !!el.closest("[role=search], form[action*=busc], form[action*=search]");
  const campos = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), select, textarea")]
    .filter(visible).filter((el) => caja(el).y < vh * 1.6 && !buscador(el));

  return {
    zonas, descartes, tarjetas_holgura: selTarjetas.length ? holgura : null, oscuros: { cabecera: oscuro(cabecera || nav), pie: oscuro(pie) },
    marca: Object.entries(marca).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([color, peso]) => ({ color, peso: Math.round(peso * 10) / 10 })),
    categorias: categorias ? categorias.lista : [],
    senales: {
      host: location.hostname, titulo: document.title.slice(0, 120),
      institucion_texto: institucionTexto.test(document.title + " " + pieTexto),
      precios, carro, videos: videos.length, hero_imagen: heroImagen, campos: campos.length,
    },
  };
}"""

# Un selector que el tema puede usar: corto, sin barras invertidas, comillas ni llaves.
_SELECTOR_SEGURO = re.compile(r"^[\w\s#.>:(),\[\]=\"*-]{1,200}$")
# Ninguna verificación del navegador pasa un selector que el saneador rechazaría.
_PROHIBIDO = re.compile(r"\\|url\(|@|[{};]")


async def medir(page: Page) -> dict:
    """Zonas, colores y señales de la página; cada zona verificada de nuevo contra la página."""
    medida = await page.evaluate(_MEDIR_JS)
    zonas = {}
    for nombre, selector in (medida.get("zonas") or {}).items():
        motivo = await _motivo_de_descarte(page, selector)
        if motivo:
            medida["descartes"].append({"zona": nombre, "motivo": motivo})
        else:
            zonas[nombre] = selector
    medida["zonas"] = zonas
    return medida


async def _motivo_de_descarte(page: Page, selector) -> str | None:
    if not isinstance(selector, str) or not _SELECTOR_SEGURO.match(selector) or _PROHIBIDO.search(selector):
        return f"selector inseguro: {selector!r}"[:160]
    try:
        cuantos = await page.evaluate("(s) => document.querySelectorAll(s).length", selector)
    except Exception:  # un selector que el navegador no entiende
        return f"selector inválido: {selector}"[:160]
    return None if cuantos else f"no encuentra nada: {selector}"[:160]
