// Buscar revisiones por link (el buscador del Overview). Puro: lo usan la página y el servidor (lib/overview.js), así
// los dos normalizan igual y la página sabe si lo que llegó es de su búsqueda.
//
// Se compara el link sin protocolo, sin "www.", sin la barra final y en minúsculas: "https://www.metro.cl/" es
// "metro.cl", y buscar "metro", "metro.cl/" o pegar el link entero lo encuentra. Con varias palabras, cada una tiene
// que estar en el link.

/** Lo más largo que se busca (lo demás se corta). */
export const LARGO_MAXIMO_DE_BUSQUEDA = 200;

/** "https://www.metro.cl/horarios/" → "metro.cl/horarios" */
export function textoDeLink(url) {
  return String(url ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** La búsqueda tal como se compara y se guarda en la URL: sin espacios de más, en minúsculas; "" si no hay. */
export function normalizarBusqueda(texto) {
  return String(texto ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, LARGO_MAXIMO_DE_BUSQUEDA)
    .trim();
}

/** ¿El link calza con la búsqueda? Cada palabra (normalizada como un link) tiene que estar en él; sin búsqueda, sí. */
export function calzaLink(url, busqueda) {
  const terminos = normalizarBusqueda(busqueda).split(" ").map(textoDeLink).filter(Boolean);
  if (!terminos.length) return true;
  const link = textoDeLink(url);
  return terminos.every((termino) => link.includes(termino));
}
