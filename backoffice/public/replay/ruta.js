// Dónde está un intento en la ruta de la Guía en un paso dado: lo que dibuja el seguimiento de la ruta del análisis
// del Replay. Puro: no toca document ni window, así node:test lo importa.
//
// Cada página de la ruta es un hito; los pasos que caen fuera de la ruta son desvíos y se agrupan bajo el último
// hito por el que pasó el intento antes de salirse (así se lee «salió de Inicio 4 veces» sin listar cada paso).
//
// La ruta es la de la Guía (tanda.rutaGuia, contra la que se mide el resultado) o, si no está, la de la telaraña
// (tanda.telarana.ruta, la de los intentos que llegaron). Con la de la telaraña valen además el carril de cada paso y
// los hitos que derivar.js ya calculó contra ella.

/** El hito (índice en `paginas`) de un paso, o -1 si está fuera de la ruta. */
function hitoDelPaso(paso, paginas, carril) {
  if (paso?.pagina) {
    const indice = paginas.indexOf(paso.pagina);
    if (indice >= 0) return indice;
  }
  // Un intento que parte en otra página de inicio (m.sitio.cl) la ve como el inicio de la ruta: derivar.js lo marca
  // «en-ruta» aunque su página no esté en la lista.
  return carril && paso?.carril === "en-ruta" ? 0 : -1;
}

/**
 * El primer paso (número, 0 = la pantalla inicial) en que el intento llegó a cada hito, o null si nunca llegó.
 * Sale de los hitos de derivar.js si vienen; si no, del primer paso que cae en cada página de la ruta.
 */
function llegadas(pasos, paginas, hitos, carril) {
  if (hitos?.length === paginas.length) return hitos.map((hito) => (hito.alcanzado ? (hito.paso ?? 0) : null));
  const primero = paginas.map(() => null);
  primero[0] = 0;
  for (const paso of pasos) {
    const hito = hitoDelPaso(paso, paginas, carril);
    if (hito >= 0 && primero[hito] === null) primero[hito] = paso.numero;
  }
  return primero;
}

/**
 * @typedef {Object} HitoEnLaRuta
 * @property {string | null} pagina  id de la página (tanda.telarana.paginas); null si ningún intento llegó a ella
 * @property {boolean} alcanzado     llegó a esta página en este paso o antes
 * @property {boolean} aqui          el paso actual está en esta página
 * @property {boolean} meta          la página final de la ruta
 * @property {{ pasos: number[], paginas: string[], aqui: boolean }} desvios
 *           los pasos (números) fuera de la ruta hasta el paso actual que salieron desde este hito, las páginas
 *           distintas a las que llegaron (ids, en orden de llegada) y si el paso actual es uno de ellos
 *
 * @typedef {Object} PosicionEnLaRuta
 * @property {HitoEnLaRuta[]} hitos
 * @property {number} alcanzados     hitos alcanzados hasta el paso actual
 * @property {number} total          hitos de la ruta
 * @property {boolean} enDesvio      el paso actual está fuera de la ruta
 */

/**
 * La posición del intento en la ruta en el paso `indice` (0-based), o null si la ruta no tiene al menos dos páginas.
 * @param {{ pasos?: object[], hitos?: { alcanzado: boolean, paso: number | null }[] }} intento
 * @param {number} indice
 * @param {(string | null)[]} paginas  ids de las páginas de la ruta, en orden
 * @param {{ deLaTelarana?: boolean }} [opciones]  deLaTelarana: la ruta es tanda.telarana.ruta (valen carril e hitos)
 * @returns {PosicionEnLaRuta | null}
 */
export function posicionEnLaRuta(intento, indice, paginas, { deLaTelarana = false } = {}) {
  if (!Array.isArray(paginas) || paginas.length < 2) return null;
  const pasos = intento?.pasos ?? [];
  const actual = pasos[indice] ?? null;
  const numero = actual?.numero ?? 0;
  const primero = llegadas(pasos, paginas, deLaTelarana ? intento?.hitos : null, deLaTelarana);
  const hitos = paginas.map((pagina, i) => ({
    pagina,
    alcanzado: primero[i] !== null && primero[i] <= numero,
    aqui: false,
    meta: i === paginas.length - 1,
    desvios: { pasos: [], paginas: [], aqui: false },
  }));

  let ultimo = 0;
  pasos.slice(0, indice + 1).forEach((paso, i) => {
    const hito = hitoDelPaso(paso, paginas, deLaTelarana);
    if (hito >= 0) {
      ultimo = hito;
      if (i === indice) hitos[hito].aqui = true;
      return;
    }
    const grupo = hitos[ultimo].desvios;
    grupo.pasos.push(paso.numero);
    if (paso.pagina && !grupo.paginas.includes(paso.pagina)) grupo.paginas.push(paso.pagina);
    if (i === indice) grupo.aqui = true;
  });
  // Sin paso (intento sin pasos) el usuario está en la pantalla inicial: el inicio de la ruta.
  if (!actual) hitos[0].aqui = true;

  return {
    hitos,
    alcanzados: hitos.filter((hito) => hito.alcanzado).length,
    total: hitos.length,
    enDesvio: Boolean(actual) && hitoDelPaso(actual, paginas, deLaTelarana) < 0,
  };
}
