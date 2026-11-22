// Normaliza una URL igual que `normalize_url` de agents/shared/src/shared/nodes/urls.py,
// para ubicar cada paso de un intento en el nodo de la telaraña que le corresponde.

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
  // Se descarta el fragmento, salvo rutas de SPA (#/ruta o #!/ruta).
  const fragmento = url.hash.slice(1);
  const fragmentoSpa = fragmento.startsWith("/") || fragmento.startsWith("!/") ? fragmento : "";
  return `${url.protocol}//${host}${ruta}${consulta ? `?${consulta}` : ""}${fragmentoSpa ? `#${fragmentoSpa}` : ""}`;
}

export function claveDeNodo(url, titulo) {
  return `${normalizarUrl(url)} | ${String(titulo ?? "").trim()}`;
}

export function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// La URL normalizada sin la consulta: esquema + host + ruta (+ el fragmento de SPA, si lo hay).
// Dos nodos con la misma rutaSinConsulta y el mismo título son la misma página (lib/paginas.js).
export function rutaSinConsulta(texto) {
  const normalizada = normalizarUrl(texto);
  try {
    const url = new URL(normalizada);
    return `${url.protocol}//${url.host}${url.pathname}${url.hash}`;
  } catch {
    return normalizada.split("?")[0];
  }
}

// La consulta de una URL normalizada, sin el "?": "s=dar+de+baja+fibra", o "" si no tiene.
export function consultaDe(texto) {
  const normalizada = normalizarUrl(texto);
  try {
    return new URL(normalizada).search.slice(1);
  } catch {
    return normalizada.includes("?") ? normalizada.split("?")[1].split("#")[0] : "";
  }
}

// La ruta (path) de una URL, "/" si no se puede leer.
export function caminoDe(texto) {
  try {
    return new URL(normalizarUrl(texto)).pathname || "/";
  } catch {
    return "/";
  }
}

// "wom.cl/centro-de-ayuda": host y ruta, para mostrar un cambio de página en pocas letras.
export function rutaLegible(texto) {
  try {
    const url = new URL(texto);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
  } catch {
    return String(texto ?? "");
  }
}
