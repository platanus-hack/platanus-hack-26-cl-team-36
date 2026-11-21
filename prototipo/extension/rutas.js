/**
 * Reglas para decidir a qué página se le aplica una piel y con qué clave.
 * Módulo puro: no usa APIs de la extensión, así se puede probar solo.
 */

/**
 * @typedef {object} Pagina
 * @property {string} sitio Nombre de host de la página.
 * @property {string} patron_ruta Primer segmento de la ruta, más `/*` si hay más.
 */

const PROTOCOLOS_ADAPTABLES = new Set(["http:", "https:"]);

/**
 * Calcula el patrón de ruta: `/wiki/Chile` → `/wiki/*`, `/item` → `/item`, `/` → `/`.
 * @param {string} ruta Ruta de la URL, sin consulta ni fragmento.
 * @returns {string}
 */
export function calcularPatronRuta(ruta) {
  const segmentos = ruta.split("/").filter(Boolean);
  if (segmentos.length === 0) return "/";
  return segmentos.length > 1 ? `/${segmentos[0]}/*` : `/${segmentos[0]}`;
}

/**
 * Describe la página de una URL, o devuelve `null` si no se debe adaptar
 * (protocolos que no son web, o el propio puente local).
 * @param {string} url
 * @param {string} urlPuente URL base del puente local.
 * @returns {Pagina | null}
 */
export function describirPagina(url, urlPuente) {
  let destino;
  try {
    destino = new URL(url);
  } catch {
    return null;
  }
  if (!PROTOCOLOS_ADAPTABLES.has(destino.protocol)) return null;
  if (destino.origin === new URL(urlPuente).origin) return null;
  return { sitio: destino.hostname, patron_ruta: calcularPatronRuta(destino.pathname) };
}

/**
 * Clave con la que se guarda la piel de un sitio y patrón de ruta.
 * @param {string} sitio
 * @param {string} patronRuta
 * @returns {string}
 */
export function clavePiel(sitio, patronRuta) {
  return `${sitio}|${patronRuta}`;
}
