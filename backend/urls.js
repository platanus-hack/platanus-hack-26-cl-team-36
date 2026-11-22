// URL normalizada de una página, la que deduplica revisiones: esquema y host en
// minúsculas (sin `www.`), path sin `/` final, sin query ni hash.
// `host` queda igual que en las claves de los agentes (agents/shared, store/keys.py).
// `pagina` es la que visitan los agentes: sin credenciales, query ni hash, que pueden traer secretos.
// Lanza TypeError si `texto` no es una URL http(s) de un sitio público con nombre.

const ETIQUETA = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
// Al menos dos etiquetas y la última no numérica: deja fuera localhost e IPs.
const NOMBRE = new RegExp(`^(?:${ETIQUETA}\\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$`);
const MAXIMO = 2000; // la PK (`URL#<url>`, ASCII) admite 2048 bytes

export function normalizarUrl(texto) {
  const url = new URL(texto);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`Esquema no soportado: ${url.protocol}`);
  const nombre = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
  if (!NOMBRE.test(nombre)) throw new TypeError(`Host no soportado: ${url.hostname}`);
  const host = url.port ? `${nombre}:${url.port}` : nombre;
  const normalizada = `${url.protocol}//${host}${url.pathname.replace(/\/+$/, "")}`;
  if (normalizada.length > MAXIMO) throw new TypeError("URL demasiado larga");
  return { url: normalizada, host, pagina: `${url.origin}${url.pathname}` };
}
