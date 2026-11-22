// Los nombres de página sin el sufijo que el sitio repite en cada título («Ayuda - Aerolínea Cóndor» → «Ayuda»).
// El servidor ya lo quita cuando lo reconoce; esto cubre los títulos que llegan enteros. Puro.

const SEPARADOR = /\s+(?:-|–|—|\||·|::)\s+/g;
const MINIMO = 2;
const PROPORCION = 0.4;

/** El sufijo más repetido (« - Aerolínea Cóndor»), o "" si ninguno se repite lo suficiente. */
export function sufijoDelSitio(titulos) {
  const validos = titulos.filter((titulo) => typeof titulo === "string" && titulo.trim());
  const cuentas = new Map();
  for (const titulo of validos) {
    const cortes = [...titulo.matchAll(SEPARADOR)];
    const ultimo = cortes.at(-1);
    if (!ultimo || ultimo.index === 0) continue;
    const sufijo = titulo.slice(ultimo.index);
    cuentas.set(sufijo, (cuentas.get(sufijo) ?? 0) + 1);
  }
  let mejor = "";
  let veces = 0;
  for (const [sufijo, n] of cuentas) if (n > veces) [mejor, veces] = [sufijo, n];
  return veces >= MINIMO && veces >= validos.length * PROPORCION ? mejor : "";
}

/** `texto` sin el sufijo, al final o antes de un distintivo « · /ruta». Nunca deja el texto vacío. */
export function sinSufijo(texto, sufijo) {
  if (!sufijo || typeof texto !== "string") return texto;
  const indice = texto.indexOf(sufijo);
  if (indice <= 0) return texto;
  const resto = texto.slice(indice + sufijo.length);
  if (resto && !resto.startsWith(" · ")) return texto;
  return `${texto.slice(0, indice)}${resto}`.trim();
}

/** Quita el sufijo del tituloCorto de las páginas de la telaraña y de la ruta de la Guía. Muta y devuelve la tanda. */
export function limpiarTitulos(tanda) {
  if (!tanda || tanda.titulosLimpios) return tanda;
  const paginas = [...(tanda.telarana?.paginas ?? []), ...(tanda.rutaGuia?.paginas ?? [])];
  const sufijo = sufijoDelSitio(paginas.map((pagina) => pagina.titulo));
  if (sufijo) {
    for (const pagina of paginas) {
      if (pagina.tituloTipo !== "sitio") continue;
      pagina.tituloCorto = sinSufijo(pagina.tituloCorto ?? pagina.titulo, sufijo);
    }
  }
  tanda.titulosLimpios = true;
  return tanda;
}
