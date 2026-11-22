// Claves de página en el navegador: la misma normalización que lib/url.js (normalizarUrl, claveDeNodo) y la misma
// regla de unión que lib/paginas.js (claveDePagina). Es una copia porque public/ no importa de lib/;
// test/url.test.js comprueba que ambas dan lo mismo.

const PARAMETROS_DE_SEGUIMIENTO =
  /^(utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid)$/i;
const PUERTOS_POR_DEFECTO = { "http:": "80", "https:": "443" };

export function normalizarUrl(texto) {
  let url;
  try {
    url = new URL(String(texto).trim());
  } catch {
    return String(texto ?? "").trim();
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (url.port && url.port !== PUERTOS_POR_DEFECTO[url.protocol]) host = `${host}:${url.port}`;
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const parametros = [...url.searchParams.entries()]
    .filter(([clave]) => !PARAMETROS_DE_SEGUIMIENTO.test(clave))
    .sort(([a, va], [b, vb]) => (a === b ? (va < vb ? -1 : va > vb ? 1 : 0) : a < b ? -1 : 1));
  const consulta = new URLSearchParams(parametros).toString();
  const fragmento = url.hash.slice(1);
  const fragmentoSpa = fragmento.startsWith("/") || fragmento.startsWith("!/") ? fragmento : "";
  return `${url.protocol}//${host}${ruta}${consulta ? `?${consulta}` : ""}${fragmentoSpa ? `#${fragmentoSpa}` : ""}`;
}

export function claveDeNodo(url, titulo) {
  return `${normalizarUrl(url)} | ${String(titulo ?? "").trim()}`;
}

export function rutaSinConsulta(texto) {
  const normalizada = normalizarUrl(texto);
  try {
    const url = new URL(normalizada);
    return `${url.protocol}//${url.host}${url.pathname}${url.hash}`;
  } catch {
    return normalizada.split("?")[0];
  }
}

/** La página de un nodo: URL sin consulta + título; sin título, el nodo queda solo (con su consulta). */
export function claveDePagina(url, titulo) {
  const limpio = String(titulo ?? "").trim();
  return limpio ? `${rutaSinConsulta(url)} | ${limpio}` : claveDeNodo(url, "");
}
