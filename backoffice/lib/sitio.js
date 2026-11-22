// El sitio de una revisión para la tarjeta del Overview (contrato §2.1). Lógica pura.
//
// - host: el de META sin "www."; si falta, el hostname del URL sin "www.". ruta: el pathname del URL.
// - nombre del sitio: del título de la página de inicio ("Inicio - Aerolínea Cóndor" → "Aerolínea Cóndor"). Se parte
//   por " - ", " – ", " — ", " · " o " | ", se botan los segmentos genéricos (sin mayúsculas ni tildes) y queda el
//   último que sobra. Si no sale nada: el host sin "www." ni TLD ("movilsur").
// - acento del tema: `--mi-acento` del tema.css del improver, solo si es un hex #rgb, #rrggbb o #rrggbbaa (en
//   minúsculas). Cualquier otra cosa (un nombre, var(), url(), texto raro) → null: la página lo usa como color.

const SEPARADOR = /\s+[-–—·|]\s+/;
const GENERICOS = new Set([
  "inicio",
  "home",
  "pagina de inicio",
  "portada",
  "bienvenido",
  "bienvenida",
  "bienvenidos",
  "bienvenidas",
  "welcome",
  "homepage",
]);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const sinTildes = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
// "¡Bienvenidos!" → "bienvenidos": sin mayúsculas, tildes ni signos en los bordes.
const comparable = (texto) => sinTildes(texto).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/\s+/g, " ");

/** "WWW.Movilsur.test" → "movilsur.test"; null si no hay host. */
export function hostSinWww(host) {
  const texto = String(host ?? "").trim().toLowerCase().replace(/\.$/, "");
  return texto ? texto.replace(/^www\./, "") : null;
}

function urlDe(texto) {
  try {
    return new URL(String(texto ?? ""));
  } catch {
    return null;
  }
}

/** El host de una revisión: META.host sin www.; si falta, el hostname de su URL sin www. */
export const hostDeRevision = (meta) => hostSinWww(meta?.host) ?? hostSinWww(urlDe(meta?.url)?.hostname);

/** El pathname de un URL ("/ofertas"; "/" si no trae ruta); null si no es un URL. */
export const rutaDeUrl = (url) => urlDe(url)?.pathname ?? null;

/** El pathname para comparar rutas: sin barra final (salvo la raíz). */
export function rutaComparable(url) {
  const ruta = rutaDeUrl(url);
  return ruta === null ? null : ruta.replace(/\/+$/, "") || "/";
}

/** "www.movilsur.test" → "movilsur"; "localhost:8080" → "localhost". */
export function nombreDeHost(host) {
  const limpio = (hostSinWww(host) ?? "").replace(/:\d+$/, "");
  const etiquetas = limpio.split(".").filter(Boolean);
  return (etiquetas.length > 1 ? etiquetas.slice(0, -1) : etiquetas).join(".");
}

/**
 * El nombre del sitio a partir del título de su página de inicio, o del host si el título no sirve.
 * @param {string | null | undefined} titulo
 * @param {string | null | undefined} host
 */
export function nombreDelSitio(titulo, host) {
  const segmentos = String(titulo ?? "")
    .split(SEPARADOR)
    .map((segmento) => segmento.trim())
    .filter((segmento) => comparable(segmento) && !GENERICOS.has(comparable(segmento)));
  return segmentos.at(-1) ?? nombreDeHost(host);
}

/**
 * El `--mi-acento` de un tema.css, en minúsculas, o null si no está o no es un hex.
 * @param {string | null | undefined} css
 */
export function acentoDelTema(css) {
  const sinComentarios = String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const declaracion = /--mi-acento\s*:\s*([^;}]*)/.exec(sinComentarios);
  const valor = declaracion?.[1].replace(/!important\s*$/i, "").trim() ?? "";
  return HEX.test(valor) ? valor.toLowerCase() : null;
}
