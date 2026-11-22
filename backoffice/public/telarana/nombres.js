// Nombres visibles de las estaciones de la telaraña (diseño §10.5.2). Puro: node:test lo importa.
//
// La etiqueta de una estación muestra pocas líneas (2 de lejos): si varias páginas empiezan igual («Preguntas
// Frecuentes · /001_165_6464.htm», «Preguntas Frecuentes · /001_165_6463.htm»…), lo que las distingue queda cortado
// y se ven idénticas. Aquí lo que las distingue pasa adelante. El nombre completo sigue en el globo y en el nombre
// accesible de la estación; los datos de la corrida no se traducen.

const SEPARADOR = " · ";
// Separadores entre partes de un título («Ingreso de Reclamo por Despido - DT - Consultas»).
const PARTES = /( · | - | \| )/;
// Caracteres que se alcanzan a ver de una etiqueta de lejos (2 líneas angostas): si dos empiezan igual hasta acá,
// se ven iguales.
export const CARACTERES_VISIBLES = 28;

// Lo que se pone adelante tiene que distinguirse en sus primeros caracteres (una URL larga no).
const DISTINGUE_ENSEGUIDA = 14;

const clave = (texto) => texto.slice(0, CARACTERES_VISIBLES).toLocaleLowerCase("es");

function prefijoComun(textos) {
  let largo = 0;
  const [primero] = textos;
  while (largo < primero.length && textos.every((texto) => texto[largo] === primero[largo])) largo += 1;
  return primero.slice(0, largo);
}

/** La ruta que distingue a una página («/001_165_6464.htm») sin la barra ni la extensión: «001_165_6464». */
const colaCorta = (cola) => cola.replace(/^\//, "").replace(/\.(s?html?|php|aspx?)$/i, "");

/**
 * En un grupo de colas, cada una sin el comienzo que comparte con otra del grupo (cortado donde empieza una palabra
 * o un número: «arbol_faqs_aval_contrib_bbrr_2118» y «…_2581» → «…2118» y «…2581»).
 */
function sinComienzoCompartido(colas) {
  return colas.map((cola, i) => {
    let largo = 0;
    colas.forEach((otra, j) => {
      if (i === j) return;
      let k = 0;
      while (k < cola.length && cola[k] === otra[k]) k += 1;
      largo = Math.max(largo, k);
    });
    // Hasta el último separador dentro de lo compartido (sin cortar una palabra o un número a la mitad).
    const corte = Math.max(...["_", "-", "/", ".", " "].map((s) => cola.lastIndexOf(s, largo - 1))) + 1;
    return corte >= 6 && corte < cola.length ? `…${cola.slice(corte)}` : cola;
  });
}

/**
 * @param {{ id: string }[]} paginas
 * @param {(pagina) => string} nombre   el nombre completo de una página (public/datos/textos.js, nombreDePagina)
 * @param {{ primeras?: Iterable<string> }} [opciones]  páginas que conservan su nombre si hay que numerar (la ruta)
 * @returns {Map<string, string>}  id → texto de la etiqueta
 */
export function etiquetasDeEstaciones(paginas, nombre, { primeras = [] } = {}) {
  const preferidas = new Set(primeras);
  const etiquetas = new Map(paginas.map((pagina) => [pagina.id, String(nombre(pagina) ?? "")]));
  const grupos = () => {
    const porClave = new Map();
    for (const [id, texto] of etiquetas) porClave.set(clave(texto), [...(porClave.get(clave(texto)) ?? []), id]);
    return [...porClave.values()].filter((ids) => ids.length > 1);
  };

  // 1. «Base · /ruta» (así distingue lib/paginas.js dos páginas con el mismo título): la ruta adelante, corta.
  for (const ids of grupos()) {
    const partes = ids.map((id) => {
      const texto = etiquetas.get(id);
      const corte = texto.lastIndexOf(SEPARADOR);
      const cola = corte > 0 ? texto.slice(corte + SEPARADOR.length) : "";
      return cola.startsWith("/") ? { id, base: texto.slice(0, corte), cola: colaCorta(cola) } : null;
    });
    const conCola = partes.filter(Boolean);
    if (conCola.length < 2) continue;
    const cortas = sinComienzoCompartido(conCola.map((parte) => parte.cola));
    conCola.forEach((parte, i) => etiquetas.set(parte.id, `${cortas[i]}${SEPARADOR}${parte.base}`));
  }

  // 2. Títulos que solo difieren al final («… - DT - Consultas» y «… - DT - Dirección del Trabajo»): la parte que
  //    los distingue adelante.
  for (const ids of grupos()) {
    const textos = ids.map((id) => etiquetas.get(id));
    const comun = prefijoComun(textos);
    const separadores = [...comun.matchAll(new RegExp(PARTES, "g"))];
    const ultimo = separadores.at(-1);
    if (!ultimo) continue;
    const base = comun.slice(0, ultimo.index);
    const restos = textos.map((texto) => texto.slice(ultimo.index + ultimo[0].length));
    // Solo si así se distinguen enseguida (si las partes que siguen también empiezan igual, no sirve: paso 3).
    const comienzo = (resto) => resto.slice(0, DISTINGUE_ENSEGUIDA).toLocaleLowerCase("es");
    if (restos.some((resto) => !resto) || new Set(restos.map(comienzo)).size < restos.length) continue;
    ids.forEach((id, i) => etiquetas.set(id, `${restos[i]}${SEPARADOR}${base}`));
  }

  // 3. Si aun así se ven iguales (la misma página con otro estado en la URL, o el mismo título): un número adelante
  //    desde la segunda; las de la ruta, primero (conservan su nombre).
  const orden = (a, b) => Number(preferidas.has(b)) - Number(preferidas.has(a)) || a.localeCompare(b, "es", { numeric: true });
  for (const ids of grupos()) {
    [...ids].sort(orden).slice(1).forEach((id, i) => {
      etiquetas.set(id, `#${i + 2}${SEPARADOR}${etiquetas.get(id)}`);
    });
  }
  return etiquetas;
}
