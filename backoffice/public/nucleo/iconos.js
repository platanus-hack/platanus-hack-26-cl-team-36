// Íconos (16×16, trazo currentColor 1.5) y estados con ícono + texto (diseño §5.8). Nunca solo color.

import { el, svg } from "./dom.js";
import { t } from "./i18n.js";

const R = { fill: "currentColor", stroke: "none" }; // relleno
const RECORTE = { class: "icono-recorte" }; // trazo del color del fondo, sobre un relleno

/** nombre → lista de [etiqueta SVG, atributos]. */
const FORMAS = {
  logrado: [["circle", { cx: 8, cy: 8, r: 6.5, ...R }], ["path", { d: "M5.2 8.2l1.9 1.9 3.8-4", ...RECORTE }]],
  fallido: [["rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 }], ["path", { d: "M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" }]],
  abandonado: [["circle", { cx: 8, cy: 8, r: 5.75 }], ["path", { d: "M5.25 8h5.5" }]],
  "error-herramienta": [
    ["path", { d: "M10.6 2.6a3.1 3.1 0 0 0-3 4.1l-4.8 4.8a1.25 1.25 0 0 0 1.8 1.8l4.8-4.8a3.1 3.1 0 0 0 4.1-3l-1.9 1.3-1.9-.5-.5-1.9z" }],
  ],
  // Llegan, pero con dificultad (titular de la cabecera de la tanda y Corridas): un check dentro de un triángulo de aviso.
  dificultad: [["path", { d: "M8 1.75l6.5 11.5H1.5z" }], ["path", { d: "M5.6 9.6l1.6 1.6 3.2-3.4" }]],
  // Alguien se trabó en esta página (marca de la telaraña): triángulo de aviso con "!".
  "sin-efecto": [["circle", { cx: 8, cy: 8, r: 5.75 }], ["path", { d: "M3.9 12.1l8.2-8.2" }]],
  volvio: [["path", { d: "M6 3.75L2.75 7 6 10.25" }], ["path", { d: "M3 7h6.75a3.5 3.5 0 0 1 0 7H8" }]],
  "error-visible": [["path", { d: "M8 2.25l6.25 11H1.75z" }], ["path", { d: "M8 6.5v3" }], ["path", { d: "M8 11.4v.1" }]],
  bloqueo: [["path", { d: "M8 1.75l5.25 2v4.1c0 3-2.2 5.3-5.25 6.4-3.05-1.1-5.25-3.4-5.25-6.4v-4.1z" }]],
  "en-ruta": [["circle", { cx: 8, cy: 8, r: 3.75, ...R }]],
  "fuera-de-ruta": [["circle", { cx: 8, cy: 8, r: 3.5 }]],
  indirecto: [["circle", { cx: 8, cy: 8, r: 5.75 }], ["path", { d: "M8 2.25a5.75 5.75 0 0 1 0 11.5z", ...R }]],
  buscar: [["circle", { cx: 7, cy: 7, r: 4.5 }], ["path", { d: "M10.4 10.4L13.75 13.75" }]],
  menu: [["path", { d: "M2.5 4h11M2.5 8h11M2.5 12h11" }]],
  cerrar: [["path", { d: "M4 4l8 8M12 4l-8 8" }]],
  anterior: [["path", { d: "M10 3.5L5.5 8l4.5 4.5" }]],
  siguiente: [["path", { d: "M6 3.5L10.5 8 6 12.5" }]],
  copiar: [
    ["rect", { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }],
    ["path", { d: "M10.5 5.5V3.75a1.25 1.25 0 0 0-1.25-1.25h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5" }],
  ],
  reproducir: [["path", { d: "M5 3.25v9.5L12.5 8z", ...R }]],
  pausar: [["path", { d: "M5.5 3.5v9M10.5 3.5v9" }]],
  acercar: [["circle", { cx: 7, cy: 7, r: 4.5 }], ["path", { d: "M10.4 10.4L13.75 13.75M5 7h4M7 5v4" }]],
  alejar: [["circle", { cx: 7, cy: 7, r: 4.5 }], ["path", { d: "M10.4 10.4L13.75 13.75M5 7h4" }]],
  ajustar: [["path", { d: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" }]],
  "enlace-externo": [
    ["path", { d: "M9 2.5h4.5V7M13.5 2.5L7.5 8.5" }],
    ["path", { d: "M11.5 9.5v2.75a1.25 1.25 0 0 1-1.25 1.25h-6.5a1.25 1.25 0 0 1-1.25-1.25v-6.5A1.25 1.25 0 0 1 3.75 4.5H6.5" }],
  ],
  info: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M8 7.25v3.75M8 4.9v.1" }]],
  teclado: [["rect", { x: 1.5, y: 3.75, width: 13, height: 8.5, rx: 1.5 }], ["path", { d: "M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" }]],
  "orden-asc": [["path", { d: "M8 13V3M4.5 6.5L8 3l3.5 3.5" }]],
  "orden-desc": [["path", { d: "M8 3v10M4.5 9.5L8 13l3.5-3.5" }]],
  historia: [["path", { d: "M2.5 13.5C4 8.5 7.5 5 12 3.25" }], ["circle", { cx: 12.75, cy: 3.25, r: 1.75, ...R }]],
  corridas: [["rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2 }], ["path", { d: "M2.5 6.25h11M2.5 9.75h11" }]],
  idioma: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12" }]],
  marca: [["circle", { cx: 8, cy: 8, r: 2.25 }], ["circle", { cx: 8, cy: 8, r: 6, "stroke-dasharray": "1.5 2.2" }], ["path", { d: "M10.25 8h4" }]],
  check: [["path", { d: "M3.5 8.5l3 3 6-7" }]],
  proximamente: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M8 4.75V8l2.25 1.5" }]],
};

export const NOMBRES_DE_ICONO = Object.freeze(Object.keys(FORMAS));

/** Ícono SVG en línea. Decorativo (aria-hidden) salvo que reciba `etiqueta`. */
export function icono(nombre, { etiqueta = null, clase = "" } = {}) {
  const formas = FORMAS[nombre];
  if (!formas) console.warn(`iconos: no existe el ícono «${nombre}»`);
  return svg(
    "svg",
    {
      class: `icono icono-${nombre}${clase ? ` ${clase}` : ""}`,
      viewBox: "0 0 16 16",
      width: 16,
      height: 16,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      focusable: "false",
      "aria-hidden": etiqueta ? null : "true",
      role: etiqueta ? "img" : null,
      "aria-label": etiqueta,
    },
    (formas ?? []).map(([etiquetaSvg, atributos]) => svg(etiquetaSvg, atributos)),
  );
}

const ICONO_DE_RESULTADO = { logrado: "logrado", fallido: "fallido", abandonado: "abandonado", error: "error-herramienta" };

/** Texto de un resultado: "Logrado · por la ruta", "Error de la herramienta". */
export function textoDeResultado(resultado, logro = null) {
  const base = t(`comun.resultado.${resultado}`);
  return resultado === "logrado" && logro ? `${base} · ${t(`comun.logro.${logro}`)}` : base;
}

/**
 * Insignia de resultado de un intento: ícono + texto, clase `insignia insignia-<resultado>`.
 * Compacta: solo el ícono, con el texto en aria-label y title.
 */
export function insignia(resultado, { logro = null, compacta = false } = {}) {
  const texto = textoDeResultado(resultado, logro);
  const nombre = resultado === "logrado" && logro === "indirecto" ? "indirecto" : (ICONO_DE_RESULTADO[resultado] ?? "info");
  const clase = `insignia insignia-${resultado}${compacta ? " insignia-compacta" : ""}`;
  if (compacta) return el("span", { class: clase, role: "img", "aria-label": texto, title: texto }, icono(nombre));
  return el("span", { class: clase }, icono(nombre), el("span", { texto }));
}

const SENALES = {
  no_effect: { icono: "sin-efecto", tono: "aviso" },
  went_back: { icono: "volvio", tono: "aviso" },
  visible_error: { icono: "error-visible", tono: "peligro" },
  security_block: { icono: "bloqueo", tono: "peligro" },
};

/** Marca de una señal de un paso (no_effect, went_back, visible_error, security_block). */
export function marcaDeSenal(senal, { compacta = true } = {}) {
  const datos = SENALES[senal] ?? { icono: "info", tono: "neutro" };
  const texto = t(`comun.senal.${senal}`);
  const clase = `insignia insignia-${datos.tono}${compacta ? " insignia-compacta" : ""}`;
  if (compacta) return el("span", { class: clase, role: "img", "aria-label": texto, title: texto }, icono(datos.icono));
  return el("span", { class: clase }, icono(datos.icono), el("span", { texto }));
}
