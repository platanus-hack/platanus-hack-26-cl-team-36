// Color de marca de un sitio (spec §3.6) y su inicial. Puro: la lectura del píxel con canvas vive en
// overview/capturas.js, que le pasa aquí los cuatro bytes.
//
// El color es el píxel (4,4) de la captura de escritorio (la cabecera del sitio, casi siempre). Sin captura, o si no
// se pudo leer, un color estable derivado del host: el mismo sitio siempre tiene el mismo color.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** true si `valor` es un color hex (#rgb, #rrggbb o #rrggbbaa): lo único que se pasa como color a CSS. */
export const esHex = (valor) => typeof valor === "string" && HEX.test(valor);

const dosDigitos = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** [r, g, b, a] (Uint8ClampedArray de getImageData) → "#rrggbb"; null si el píxel es casi transparente. */
export function hexDePixel(datos) {
  if (!datos || datos.length < 4) return null;
  const [r, g, b, a] = datos;
  if (!(a >= 128)) return null;
  return `#${dosDigitos(r)}${dosDigitos(g)}${dosDigitos(b)}`;
}

/** Host sin `www.` y en minúsculas: "WWW.MovilSur.test" → "movilsur.test". */
export const hostLimpio = (host) => String(host ?? "").trim().toLowerCase().replace(/^www\./, "");

// FNV-1a de 32 bits: estable entre navegadores y versiones (no depende de Math.random ni de la sesión).
function fnv1a(texto) {
  let h = 0x811c9dc5;
  for (const caracter of texto) {
    h ^= caracter.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hslAHex(tono, saturacion, luz) {
  const c = (1 - Math.abs(2 * luz - 1)) * saturacion;
  const x = c * (1 - Math.abs(((tono / 60) % 2) - 1));
  const m = luz - c / 2;
  const [r, g, b] =
    tono < 60 ? [c, x, 0] : tono < 120 ? [x, c, 0] : tono < 180 ? [0, c, x] : tono < 240 ? [0, x, c] : tono < 300 ? [x, 0, c] : [c, 0, x];
  return `#${dosDigitos((r + m) * 255)}${dosDigitos((g + m) * 255)}${dosDigitos((b + m) * 255)}`;
}

/** Color de respaldo, estable por host: un tono del círculo cromático con saturación y luz fijas. */
export function colorDeRespaldo(host) {
  const limpio = hostLimpio(host);
  return hslAHex(fnv1a(limpio || "?") % 360, 0.62, 0.4);
}

function canal(valor) {
  const s = valor / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa (WCAG) de "#rgb" o "#rrggbb[aa]"; null si no es hex. */
export function luminancia(hex) {
  if (!esHex(hex)) return null;
  let cuerpo = hex.slice(1);
  if (cuerpo.length === 3) cuerpo = [...cuerpo].map((d) => d + d).join("");
  const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(cuerpo.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores hex (1 a 21); null si alguno no es hex. */
export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Los dos colores posibles de la inicial: --texto-1 y --fondo de tokens.css. */
export const TEXTO_CLARO = "#f5f5f7";
export const TEXTO_OSCURO = "#0b0b10";
/** La inicial es un objeto gráfico (aria-hidden): basta 3:1 (WCAG 1.4.11) para seguir en claro, como en la maqueta. */
export const CONTRASTE_MINIMO = 3;

/** "claro" (inicial clara) u "oscuro" sobre el color de marca `hex`: clara mientras llegue a 3:1, si no oscura. */
export function textoSobre(hex) {
  const conClaro = contraste(hex, TEXTO_CLARO);
  if (conClaro === null) return "claro";
  return conClaro >= CONTRASTE_MINIMO ? "claro" : "oscuro";
}

/** Primera letra (grafema) del nombre del sitio en mayúscula; si no hay nombre, la del host. "·" si no hay nada. */
export function inicial(sitio, host = "") {
  const fuente = String(sitio ?? "").trim() || hostLimpio(host);
  if (!fuente) return "·";
  const primero =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(fuente)[Symbol.iterator]().next().value?.segment
      : Array.from(fuente)[0];
  return (primero ?? "·").toLocaleUpperCase();
}
