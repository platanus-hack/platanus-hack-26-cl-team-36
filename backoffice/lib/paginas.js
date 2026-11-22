// Páginas de la telaraña: los nodos del route_tree.json unidos cuando son la misma página con
// distinta consulta (?s=…), y un título corto legible para cada una. Lógica pura.
//
// Dos nodos son la misma página cuando tienen la misma URL sin consulta y el mismo título no vacío.
// Los nodos sin título nunca se unen: sin título no hay cómo saber si muestran lo mismo.

import { caminoDe, consultaDe, hostDe, rutaSinConsulta } from "./url.js";

/**
 * @typedef {Object} NodoCrudo   Un nodo de route_tree.json, tal como lo escribe el evaluador.
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {number} visits
 * @property {string[]} profiles
 * @property {boolean} is_start
 * @property {{ success: number, failed: number, abandoned: number }} endings
 *
 * @typedef {Object} GrupoDePagina   Los nodos que forman una página, en el orden del árbol.
 * @property {string} id              id del primer nodo del grupo
 * @property {NodoCrudo[]} nodos
 */

/** Clave con que se unen los nodos: URL sin consulta + título; un nodo sin título queda solo. */
export function claveDePagina(nodo) {
  const titulo = String(nodo.title ?? "").trim();
  return titulo ? `${rutaSinConsulta(nodo.url)} | ${titulo}` : `nodo:${nodo.id}`;
}

/**
 * Une los nodos crudos en páginas.
 * @param {NodoCrudo[]} nodos
 * @returns {{ grupos: GrupoDePagina[], paginaDeNodo: Map<string, string>, alias: Record<string, string> }}
 */
export function unirNodos(nodos) {
  const grupoPorClave = new Map();
  const grupos = [];
  const paginaDeNodo = new Map();
  const alias = {};
  for (const nodo of nodos) {
    const clave = claveDePagina(nodo);
    let grupo = grupoPorClave.get(clave);
    if (!grupo) {
      grupo = { id: nodo.id, nodos: [] };
      grupoPorClave.set(clave, grupo);
      grupos.push(grupo);
    } else {
      alias[nodo.id] = grupo.id;
    }
    grupo.nodos.push(nodo);
    paginaDeNodo.set(nodo.id, grupo.id);
  }
  return { grupos, paginaDeNodo, alias };
}

// Separadores de un título de página: "A | B", "A - B", "A – B", "A — B" (siempre con espacios).
const SEPARADOR = / (?:\||-|–|—) /g;

/** Los segmentos de un título y dónde empieza cada uno en el texto original. */
function segmentosDe(titulo) {
  const partes = [];
  const inicios = [0];
  let desde = 0;
  for (const separador of titulo.matchAll(SEPARADOR)) {
    partes.push(titulo.slice(desde, separador.index));
    desde = separador.index + separador[0].length;
    inicios.push(desde);
  }
  partes.push(titulo.slice(desde));
  return { partes, inicios };
}

const terminaCon = (partes, sufijo) =>
  sufijo.length <= partes.length && sufijo.every((parte, i) => partes[partes.length - sufijo.length + i] === parte);

/**
 * La lista más larga de segmentos finales que comparten al menos dos títulos
 * (WOM: ["Centro de Ayuda", "WOM"]; DT: ["DT", "Dirección del Trabajo"]), o [] si no hay.
 * @param {string[]} titulos
 * @returns {string[]}
 */
export function sufijoComun(titulos) {
  const listas = titulos.map((titulo) => segmentosDe(String(titulo ?? "").trim()).partes).filter((p) => p.join(""));
  let mejor = [];
  let mejorCuenta = 0;
  for (const partes of listas) {
    for (let largo = 1; largo <= partes.length; largo += 1) {
      const sufijo = partes.slice(partes.length - largo);
      if (largo < mejor.length) continue;
      const cuenta = listas.filter((otras) => terminaCon(otras, sufijo)).length;
      if (cuenta < 2) continue;
      if (largo > mejor.length || cuenta > mejorCuenta) {
        mejor = sufijo;
        mejorCuenta = cuenta;
      }
    }
  }
  return mejor;
}

/** El título sin el sufijo común, si termina con él y queda algo; si no, el título tal cual. */
export function quitarSufijo(titulo, sufijo) {
  const limpio = String(titulo ?? "").trim();
  if (!sufijo.length) return limpio;
  const { partes, inicios } = segmentosDe(limpio);
  if (partes.length <= sufijo.length || !terminaCon(partes, sufijo)) return limpio;
  const corte = inicios[partes.length - sufijo.length];
  // Se corta justo antes del separador que precede al sufijo.
  const antes = limpio.slice(0, corte);
  return antes.replace(/ (?:\||-|–|—) $/, "").trim() || limpio;
}

/** Último segmento no vacío de la ruta de una URL, legible: "impuesto_territorial" → "Impuesto territorial". */
export function tituloDesdeRuta(url) {
  const segmentos = caminoDe(url).split("/").filter(Boolean);
  const ultimo = segmentos.at(-1);
  if (!ultimo) return null;
  let texto = ultimo;
  try {
    texto = decodeURIComponent(ultimo);
  } catch {
    // se usa tal cual
  }
  texto = texto.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").trim();
  return texto ? texto[0].toLocaleUpperCase("es") + texto.slice(1) : null;
}

/** ¿Es una dirección de la web (http o https)? */
export function esDeLaWeb(url) {
  try {
    return ["http:", "https:"].includes(new URL(String(url ?? "")).protocol);
  } catch {
    return true; // una ruta relativa o rota se nombra como siempre
  }
}

const ultimoSegmento = (url) => caminoDe(url).split("/").filter(Boolean).at(-1) ?? "";

/**
 * Pone `tituloCorto` y `tituloTipo` a cada página (§2.3 del diseño). No arma frases: una página de
 * inicio queda con tituloTipo "inicio" y la pantalla la nombra con el diccionario; su tituloCorto es null, o
 * lo que la distingue de otra página de inicio ("m.sitio.cl") cuando hay más de una.
 * @template {{ titulo: string, url: string, variantes: { consulta: string }[] }} P
 * @param {P[]} paginas
 * @returns {(P & { tituloCorto: string | null, tituloTipo: "sitio" | "inicio" | "url" | "error" })[]}
 */
export function titularPaginas(paginas) {
  const sufijo = sufijoComun(paginas.map((pagina) => pagina.titulo));
  const conTitulo = paginas.map((pagina) => {
    // Una página que no es de la web (chrome-error://, about:) es el navegador avisando que no pudo abrir algo:
    // nunca la de inicio del sitio.
    if (!esDeLaWeb(pagina.url)) return { ...pagina, tituloCorto: null, tituloTipo: "error" };
    if (caminoDe(pagina.url) === "/" && !new URL(pagina.url, "http://x").hash) {
      return { ...pagina, tituloCorto: null, tituloTipo: "inicio" };
    }
    const titulo = String(pagina.titulo ?? "").trim();
    if (!titulo) {
      return { ...pagina, tituloCorto: tituloDesdeRuta(pagina.url) ?? pagina.url, tituloTipo: "url" };
    }
    return { ...pagina, tituloCorto: quitarSufijo(titulo, sufijo), tituloTipo: "sitio" };
  });
  // Dos páginas con el mismo nombre se distinguen por el sitio (m.sitio.cl), la ruta o, si es la misma, por la
  // consulta. Las de inicio no tienen título corto (la pantalla dice "Inicio"): si hay varias, el título corto
  // queda con lo que las distingue y la pantalla dice "Inicio · m.sitio.cl".
  const repetidos = new Map();
  for (const pagina of conTitulo) {
    const clave = pagina.tituloTipo === "inicio" ? "\u0000inicio" : pagina.tituloTipo === "error" ? `\u0000error:${pagina.url}` : pagina.tituloCorto;
    repetidos.set(clave, (repetidos.get(clave) ?? []).concat([pagina]));
  }
  for (const grupo of repetidos.values()) {
    if (grupo.length < 2) continue;
    const base = grupo[0].tituloCorto;
    const variosSitios = new Set(grupo.map((pagina) => hostDe(pagina.url))).size > 1;
    for (const pagina of grupo) {
      const mismoSitio = grupo.filter((otra) => hostDe(otra.url) === hostDe(pagina.url));
      const mismaRuta = mismoSitio.filter((otra) => caminoDe(otra.url) === caminoDe(pagina.url)).length > 1;
      const consulta = pagina.variantes[0]?.consulta ?? consultaDe(pagina.url);
      let distintivo = null;
      if (variosSitios && mismoSitio.length === 1) distintivo = hostDe(pagina.url);
      else if (mismaRuta && consulta) distintivo = `?${consulta}`;
      else if (!mismaRuta) distintivo = `/${ultimoSegmento(pagina.url)}`;
      else if (base === null) distintivo = String(pagina.titulo ?? "").trim() || null;
      if (!distintivo) continue;
      pagina.tituloCorto = base === null ? distintivo : `${base} · ${distintivo}`;
    }
  }
  return conTitulo;
}
