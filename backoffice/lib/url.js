// Normaliza una URL igual que `normalize_url` de agents/app/web_evaluator/route_tree.py,
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
