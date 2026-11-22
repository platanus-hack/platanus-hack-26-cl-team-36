// Capturas de las tarjetas del Overview (spec §3.5, §3.6). Arma el DOM, así que no se prueba con node:test.
//
// El servidor responde todo con `Cache-Control: no-store`: un <img> nuevo con el mismo src vuelve a pedir la captura.
// Por eso cada <img> se reutiliza: una tarjeta que se redibuja conserva los suyos, y los de una tarjeta que sale
// (otra pestaña, otro dispositivo, otro idioma, otra pantalla) quedan sueltos aquí para la próxima que pida ese src.
// El color de marca (píxel 4,4 de la captura de escritorio) se lee con canvas una sola vez por captura y se recuerda
// mientras dure la página.

import { el } from "../nucleo/dom.js";
import { hexDePixel } from "./marca.js";

/** src → "#rrggbb" (leído) | null (no se pudo: se usa el color de respaldo del host). */
const colores = new Map();
/** src → <img>[] fuera del documento, ya pedidos (y casi siempre ya cargados). Sobreviven al desmontaje. */
const sueltos = new Map();
/** <img> sueltos que se guardan como máximo (los más viejos se descartan). */
const MAX_SUELTOS = 48;
let cuantos = 0;
/** Quién redibuja cuando se conoce el color de una captura: la pantalla montada, o nadie. */
let oyente = null;

/** Color de marca de una captura: "#rrggbb", null si no se pudo leer, undefined si todavía no se sabe. */
export const colorDeCaptura = (src) => colores.get(src);

/** La pantalla montada se anota para redibujar cuando llega un color. → función para dejar de escuchar. */
export function escucharColores(funcion) {
  oyente = funcion;
  return () => {
    if (oyente === funcion) oyente = null;
  };
}

function leerPixel(img) {
  try {
    const lienzo = el("canvas", { width: 5, height: 5 });
    const contexto = lienzo.getContext("2d", { willReadFrequently: true });
    contexto.drawImage(img, 0, 0);
    return hexDePixel(contexto.getImageData(4, 4, 1, 1).data);
  } catch {
    return null;
  }
}

function anotarColor(img, src) {
  if (colores.has(src)) return;
  colores.set(src, img.naturalWidth ? leerPixel(img) : null);
  oyente?.(src);
}

function pedirColor(img, src) {
  if (colores.has(src)) return;
  img.setAttribute("data-color", "");
  if (img.complete && img.naturalWidth) anotarColor(img, src);
}

function nuevo(src) {
  const img = el("img", { src, alt: "", decoding: "async", draggable: "false" });
  img.addEventListener("load", () => {
    if (img.hasAttribute("data-color")) anotarColor(img, src);
  });
  img.addEventListener("error", () => {
    img.setAttribute("data-fallida", "");
    if (img.hasAttribute("data-color") && !colores.has(src)) {
      colores.set(src, null);
      oyente?.(src);
    }
  });
  return img;
}

/**
 * Un <img> para `src`: uno suelto con ese src si hay (no se vuelve a pedir) o uno nuevo. `color`: leer su píxel de
 * marca cuando cargue (las capturas de escritorio de las tarjetas).
 */
function tomar(src, { alt = "", color = false } = {}) {
  const lista = sueltos.get(src);
  let img = lista?.pop();
  if (img) {
    cuantos--;
    if (!lista.length) sueltos.delete(src);
  } else {
    img = nuevo(src);
  }
  img.alt = alt;
  if (color) pedirColor(img, src);
  return img;
}

/** Devuelve un <img> que ya no se usa: sale del documento y queda listo para el próximo que pida su src. */
function soltar(img) {
  if (!img) return;
  img.remove();
  img.removeAttribute("class");
  if (img.hasAttribute("data-fallida")) return;
  const src = img.getAttribute("src");
  if (!sueltos.has(src)) sueltos.set(src, []);
  sueltos.get(src).push(img);
  cuantos++;
  while (cuantos > MAX_SUELTOS) {
    const [masViejo, viejos] = sueltos.entries().next().value;
    viejos.shift();
    cuantos--;
    if (!viejos.length) sueltos.delete(masViejo);
  }
}

/** El banco de <img> que usan las tarjetas y "Up next". */
export const imagenes = Object.freeze({ tomar, soltar });
