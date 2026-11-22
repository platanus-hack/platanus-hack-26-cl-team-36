// URL normalizada de una página, la que deduplica revisiones: esquema y host en
// minúsculas (sin `www.`), path sin `/` final, sin query ni hash.
// `host` queda igual que en las claves de los agentes (agents/shared, store/keys.py).
// Lanza TypeError si `texto` no es una URL http(s).
export function normalizarUrl(texto) {
  const url = new URL(texto);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`Esquema no soportado: ${url.protocol}`);
  const nombre = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
  const host = url.port ? `${nombre}:${url.port}` : nombre;
  return { url: `${url.protocol}//${host}${url.pathname.replace(/\/+$/, "")}`, host };
}
