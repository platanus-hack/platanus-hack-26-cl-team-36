/**
 * Arma el mapa de página: un esquema de texto con la estructura visible de la página, sin su
 * contenido. Esta función se inyecta con `scripting.executeScript`, así que debe bastarse sola:
 * no puede usar nada definido fuera de ella.
 *
 * Nunca lee texto de la página, valores de atributos (`href`, `src`, `alt`, `value`), contenido
 * de formularios, ni la consulta o el fragmento de la URL.
 *
 * @param {string} sitio
 * @param {string} patronRuta
 * @returns {string}
 */
export function armarMapaPagina(sitio, patronRuta) {
  const PROFUNDIDAD_MAXIMA = 8;
  const LARGO_MAXIMO = 12_000;
  const ELEMENTOS_MAXIMOS = 4_000;
  const CLASES_MAXIMAS = 3;
  const LARGO_MAXIMO_NOMBRE = 40;
  const COLUMNA_DETALLES = 30;
  const ETIQUETAS_OMITIDAS = new Set([
    "script", "style", "noscript", "template", "link", "meta", "title", "base", "br", "wbr",
    "source", "track", "param", "datalist", "option", "optgroup",
  ]);

  /**
   * @typedef {object} Nodo
   * @property {string} etiqueta Etiqueta con id, clases y rol, como se escribe en el mapa.
   * @property {string} firma Etiqueta y clases, para agrupar hermanos iguales.
   * @property {boolean} conId
   * @property {string[]} detalles
   * @property {number} repeticiones
   * @property {Nodo[]} hijos
   */

  // Si la pestaña ya navegó a otro sitio, este mapa no sirve.
  if (location.hostname !== sitio) return "";

  let visitados = 0;

  /** @param {string} nombre */
  const esNombreSeguro = (nombre) => nombre.length > 0 && nombre.length <= LARGO_MAXIMO_NOMBRE;

  /** @param {string} color Color calculado (`rgb(…)` o `rgba(…)`). */
  const esTransparente = (color) => {
    if (color === "transparent") return true;
    const partes = color.match(/[\d.]+/g);
    return color.startsWith("rgba") && partes !== null && Number(partes[3]) === 0;
  };

  /** @param {string} color */
  const aHexadecimal = (color) => {
    const partes = color.match(/[\d.]+/g);
    if (!color.startsWith("rgb") || partes === null || partes.length < 3) return color.replaceAll(" ", "");
    return `#${partes.slice(0, 3).map((parte) => Math.round(Number(parte)).toString(16).padStart(2, "0")).join("")}`;
  };

  /** @param {CSSStyleDeclaration} estilo */
  const describirFuente = (estilo) => {
    const familia = estilo.fontFamily.split(",")[0].trim().replaceAll('"', "").replaceAll("'", "");
    return `${familia} ${Math.round(parseFloat(estilo.fontSize))}px`;
  };

  /**
   * @param {Element} elemento
   * @param {CSSStyleDeclaration} estilo
   * @param {DOMRect} caja
   */
  const esVisible = (elemento, estilo, caja) => {
    if (estilo.display === "none" || estilo.visibility === "hidden" || elemento.hasAttribute("hidden")) return false;
    return estilo.display === "contents" || caja.width > 0 || caja.height > 0;
  };

  /** @param {Element} elemento */
  const describirEtiqueta = (elemento) => {
    const etiqueta = elemento.localName;
    const clases = Array.from(elemento.classList).filter(esNombreSeguro).slice(0, CLASES_MAXIMAS);
    const firma = [etiqueta, ...clases].join(".");
    const id = esNombreSeguro(elemento.id) ? `#${elemento.id}` : "";
    const rol = elemento.getAttribute("role");
    const rolSeguro = rol !== null && /^[a-z]{1,20}$/.test(rol) ? `[role=${rol}]` : "";
    const conClases = clases.length > 0 ? `.${clases.join(".")}` : "";
    return { firma, conId: id !== "", etiqueta: `${etiqueta}${id}${conClases}${rolSeguro}` };
  };

  /**
   * @param {Element} elemento
   * @param {{ fondo: string, texto: string, fuente: string } | null} padre Estilo efectivo del padre.
   * @param {number} profundidad
   * @returns {Nodo | null}
   */
  const recorrer = (elemento, padre, profundidad) => {
    if (ETIQUETAS_OMITIDAS.has(elemento.localName) || visitados >= ELEMENTOS_MAXIMOS) return null;
    visitados += 1;
    const estilo = getComputedStyle(elemento);
    const caja = elemento.getBoundingClientRect();
    if (!esVisible(elemento, estilo, caja)) return null;

    const fondo = esTransparente(estilo.backgroundColor) ? (padre?.fondo ?? "") : aHexadecimal(estilo.backgroundColor);
    const texto = aHexadecimal(estilo.color);
    const fuente = describirFuente(estilo);
    const detalles = [];
    if (estilo.display !== "inline" && estilo.display !== "contents") {
      detalles.push(`${Math.round(caja.width)}×${Math.round(caja.height)}`);
    }
    if (fondo !== "" && fondo !== padre?.fondo) detalles.push(`fondo ${fondo}`);
    if (texto !== padre?.texto) detalles.push(`texto ${texto}`);
    if (fuente !== padre?.fuente) detalles.push(fuente);
    if (estilo.position === "fixed" || estilo.position === "sticky") detalles.push("fijo");

    /** @type {Nodo[]} */
    const hijos = [];
    if (profundidad < PROFUNDIDAD_MAXIMA) {
      for (const hijo of elemento.children) {
        const nodo = recorrer(hijo, { fondo, texto, fuente }, profundidad + 1);
        if (nodo !== null) hijos.push(nodo);
      }
    }
    return { ...describirEtiqueta(elemento), detalles, repeticiones: 1, hijos: agruparHermanos(hijos) };
  };

  /**
   * Junta los hermanos con la misma etiqueta y clases (`p ×42`). Del grupo queda el primero,
   * sin los detalles que varían de uno a otro.
   * @param {Nodo[]} hermanos
   * @returns {Nodo[]}
   */
  const agruparHermanos = (hermanos) => {
    /** @type {Map<string, Nodo>} */
    const grupos = new Map();
    const resultado = [];
    for (const nodo of hermanos) {
      const grupo = nodo.conId ? undefined : grupos.get(nodo.firma);
      if (grupo === undefined) {
        if (!nodo.conId) grupos.set(nodo.firma, nodo);
        resultado.push(nodo);
      } else {
        grupo.repeticiones += 1;
      }
    }
    return resultado;
  };

  /**
   * @param {Nodo} nodo
   * @param {number} profundidad
   * @param {number} limite Profundidad máxima que se escribe.
   * @param {string[]} lineas
   */
  const escribir = (nodo, profundidad, limite, lineas) => {
    const repetido = nodo.repeticiones > 1;
    const nombre = `${"  ".repeat(profundidad)}${repetido ? `${nodo.firma} ×${nodo.repeticiones}` : nodo.etiqueta}`;
    // El tamaño de un grupo no se escribe: cambia de un hermano a otro.
    const detalles = repetido ? nodo.detalles.filter((detalle) => !/^\d+×\d+$/.test(detalle)) : nodo.detalles;
    lineas.push(detalles.length > 0 ? `${nombre.padEnd(COLUMNA_DETALLES)} ${detalles.join(" · ")}` : nombre);
    if (profundidad >= limite) return;
    for (const hijo of nodo.hijos) escribir(hijo, profundidad + 1, limite, lineas);
  };

  const esquema = matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
  const encabezado =
    `sitio: ${sitio} · patron_ruta: ${patronRuta} · ventana: ${innerWidth}×${innerHeight} · esquema: ${esquema}`;
  const raiz = document.body === null ? null : recorrer(document.body, null, 0);
  if (raiz === null) return encabezado;

  // Si no cabe, se recorta por lo más profundo.
  for (let limite = PROFUNDIDAD_MAXIMA; limite >= 0; limite -= 1) {
    const lineas = [encabezado];
    escribir(raiz, 0, limite, lineas);
    const mapa = lineas.join("\n");
    if (mapa.length <= LARGO_MAXIMO) return mapa;
    if (limite === 0) return mapa.slice(0, LARGO_MAXIMO);
  }
  return encabezado;
}
