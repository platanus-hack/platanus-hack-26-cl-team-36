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
  // Sin ruta de la Guía ni juez: un círculo punteado (no se sabe cómo terminó).
  "sin-medir": [["circle", { cx: 8, cy: 8, r: 5.75, "stroke-dasharray": "2.2 2.2" }]],
  "error-herramienta": [
    ["path", { d: "M10.6 2.6a3.1 3.1 0 0 0-3 4.1l-4.8 4.8a1.25 1.25 0 0 0 1.8 1.8l4.8-4.8a3.1 3.1 0 0 0 4.1-3l-1.9 1.3-1.9-.5-.5-1.9z" }],
  ],
  // Llegan, pero con dificultad (titular de la cabecera de la tanda y Corridas): un check dentro de un triángulo de aviso.
  dificultad: [["path", { d: "M8 1.75l6.5 11.5H1.5z" }], ["path", { d: "M5.6 9.6l1.6 1.6 3.2-3.4" }]],
  // Alguien se trabó en esta página (marca de la telaraña): triángulo de aviso con "!".
  atasco: [["path", { d: "M8 1.75l6.5 11.5H1.5z" }], ["path", { d: "M8 6v3.25" }], ["path", { d: "M8 11.1v.15" }]],
  "sin-efecto": [["circle", { cx: 8, cy: 8, r: 5.75 }], ["path", { d: "M3.9 12.1l8.2-8.2" }]],
  volvio: [["path", { d: "M6 3.75L2.75 7 6 10.25" }], ["path", { d: "M3 7h6.75a3.5 3.5 0 0 1 0 7H8" }]],
  "error-visible": [["path", { d: "M8 2.25l6.25 11H1.75z" }], ["path", { d: "M8 6.5v3" }], ["path", { d: "M8 11.4v.1" }]],
  bloqueo: [["path", { d: "M8 1.75l5.25 2v4.1c0 3-2.2 5.3-5.25 6.4-3.05-1.1-5.25-3.4-5.25-6.4v-4.1z" }]],
  "en-ruta": [["circle", { cx: 8, cy: 8, r: 3.75, ...R }]],
  "fuera-de-ruta": [["circle", { cx: 8, cy: 8, r: 3.5 }]],
  indirecto: [["circle", { cx: 8, cy: 8, r: 5.75 }], ["path", { d: "M8 2.25a5.75 5.75 0 0 1 0 11.5z", ...R }]],
  buscar: [["circle", { cx: 7, cy: 7, r: 4.5 }], ["path", { d: "M10.4 10.4L13.75 13.75" }]],
  menu: [["path", { d: "M2.5 4h11M2.5 8h11M2.5 12h11" }]],
  mas: [["circle", { cx: 3.5, cy: 8, r: 1.1, ...R }], ["circle", { cx: 8, cy: 8, r: 1.1, ...R }], ["circle", { cx: 12.5, cy: 8, r: 1.1, ...R }]],
  ayuda: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M6.3 6.4a1.75 1.75 0 0 1 3.4.6c0 1.2-1.7 1.4-1.7 2.5" }], ["path", { d: "M8 11.5v.1" }]],
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
  corridas: [["rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2 }], ["path", { d: "M2.5 6.25h11M2.5 9.75h11" }]],
  idioma: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12" }]],
  marca: [["circle", { cx: 8, cy: 8, r: 2.25 }], ["circle", { cx: 8, cy: 8, r: 6, "stroke-dasharray": "1.5 2.2" }], ["path", { d: "M10.25 8h4" }]],
  check: [["path", { d: "M3.5 8.5l3 3 6-7" }]],
  proximamente: [["circle", { cx: 8, cy: 8, r: 6 }], ["path", { d: "M8 4.75V8l2.25 1.5" }]],
  // Análisis del Replay (seguimiento de la ruta) y pestaña Propuesta.
  cursor: [["path", { d: "M3.5 2.5l9 3.9-3.9 1.4-1.4 3.9z" }], ["path", { d: "M8.9 8.9l3.6 3.6" }]],
  esperaba: [["path", { d: "M13.5 9.75a1.5 1.5 0 0 1-1.5 1.5H6l-3.5 2.75V3.75A1.5 1.5 0 0 1 4 2.25h8a1.5 1.5 0 0 1 1.5 1.5z" }]],
  ojo: [["path", { d: "M1.5 8s2.4-4.75 6.5-4.75S14.5 8 14.5 8s-2.4 4.75-6.5 4.75S1.5 8 1.5 8z" }], ["circle", { cx: 8, cy: 8, r: 2 }]],
  meta: [["path", { d: "M3.5 14.25V2.25M3.5 2.75h8.75l-1.75 3 1.75 3H3.5" }]],
  desvio: [["path", { d: "M4 2.5v3.75a3 3 0 0 0 3 3h5.5M10 6.75l2.5 2.5-2.5 2.5" }]],
  escritorio: [["rect", { x: 1.75, y: 2.75, width: 12.5, height: 8.5, rx: 1.5 }], ["path", { d: "M5.5 13.75h5M8 11.25v2.5" }]],
  movil: [["rect", { x: 4.5, y: 1.75, width: 7, height: 12.5, rx: 1.5 }], ["path", { d: "M7.25 11.75h1.5" }]],
  visitantes: [["circle", { cx: 6, cy: 5.5, r: 2.25 }], ["path", { d: "M2 13.25c0-2.2 1.8-4 4-4s4 1.8 4 4" }], ["circle", { cx: 11.5, cy: 6.25, r: 1.75 }], ["path", { d: "M11 9.4c1.8.25 3 1.7 3 3.85" }]],
  disenador: [["path", { d: "M13.5 2.5L7.25 8.75" }], ["path", { d: "M5.4 9.4c-1.5 0-2.4 1.1-2.4 2.4 0 .8-.4 1.3-1 1.7 2.7.9 5.3-.2 5.3-2.4 0-.9-.8-1.7-1.9-1.7z" }]],
  documento: [["path", { d: "M4.25 1.75h5l2.5 2.5v10h-7.5z" }], ["path", { d: "M9.25 1.75v2.5h2.5M6.25 8.25h3.5M6.25 10.75h3.5" }]],
  reintentar: [["path", { d: "M2.75 8a5.25 5.25 0 1 0 1.6-3.75" }], ["path", { d: "M2.75 2.5v3.25H6" }]],
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

// ── Íconos de 24×24 (Overview v3) ──────────────────────────────────────────
// Los de la maqueta del Overview, con sus mismos paths: otra grilla (24×24) y otro trazo (1.8–2) que los de 16×16,
// por eso van aparte y sin la clase `icono` (que los fijaría en 16 px). `circ` y `rect` son los ayudantes de la
// maqueta: arman los mismos `d` que ella.
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const rect = (x, y, w, h, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/** nombre → { viewBox, formas: [etiqueta SVG, atributos][] }. */
const FORMAS_24 = {
  dispositivos: [["path", { d: `${rect(2, 5, 13, 10, 1.5)}M6 19h5M8.5 15v4${rect(16, 8, 6, 12, 1.5)}` }]],
  escritorio: [["path", { d: `${rect(3, 4, 18, 12, 2)}M8 20h8M12 16v4` }]],
  movil: [["path", { d: `${rect(7, 2, 10, 20, 2)}M11 18h2` }]],
  catalogo: [["path", { d: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" }]],
  ruta: [["path", { d: `${circ(6, 19, 2)}${circ(18, 5, 2)}M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7` }]],
  visitantes: [["path", { d: `${circ(9, 8, 3)}M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6${circ(17, 9, 2.5)}M16 14.2c2.9.4 5 2.8 5 5.8` }]],
  tema: [["path", { d: "M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 5.9 17 3 12 3zM7.5 11h.01M10 7h.01M15 7h.01" }]],
  alerta: [["path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" }]],
  reloj: [["path", { d: `${circ(12, 12, 9)}M12 7v5l3 2` }]],
  cruz: [["path", { d: "M7 7l10 10M17 7 7 17" }]],
  extension: [
    [
      "path",
      {
        d: "M19.4 7.9c0 .3.1.6.3.9l1.6 1.6c.5.5.7 1.1.7 1.7s-.2 1.2-.7 1.7l-1.6 1.6c-.2.2-.5.3-.8.3-.5-.1-.8-.5-1-.9a2.5 2.5 0 1 0-3.2 3.2c.4.2.9.5.9 1 .1.3 0 .6-.3.8l-1.6 1.6c-.5.5-1.1.7-1.7.7s-1.2-.2-1.7-.7l-1.6-1.6c-.2-.2-.5-.3-.9-.3-.5.1-.8.5-1 1a2.5 2.5 0 1 1-3.2-3.2c.5-.2.9-.5 1-1 0-.3-.1-.6-.3-.9l-1.6-1.6C2.2 13.2 2 12.6 2 12s.2-1.2.7-1.7l1.5-1.5c.2-.2.6-.4.9-.3.5.1.9.5 1.1 1a2.5 2.5 0 1 0 3.3-3.3c-.5-.2-.9-.6-1-1.1 0-.3.1-.7.3-.9l1.5-1.5c.5-.5 1.1-.7 1.7-.7s1.2.2 1.7.7l1.6 1.6c.2.2.6.3.9.3.5-.1.8-.5 1-1a2.5 2.5 0 1 1 3.2 3.2c-.4.2-.9.5-.9 1z",
      },
    ],
  ],
  // El candado de la barra de navegador de cada tarjeta (trazo 2.4 a 10 px).
  candado: [["rect", { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }]],
  // La flecha entre etapas de la pista de arranque vacío: su caja es de 28×36 (CAJA_24), trazo 1.6.
  flecha: [["path", { d: "M4 18h18M17 13l5 5-5 5" }]],
};

/** Íconos cuya caja no es 0 0 24 24. */
const CAJA_24 = { flecha: "0 0 28 36" };

export const NOMBRES_DE_ICONO_24 = Object.freeze(Object.keys(FORMAS_24));

/**
 * Ícono de 24×24 (los de la maqueta del Overview): `tamano` en px (18 por defecto), `trazo` el stroke-width
 * (1.8 por defecto; la maqueta usa 2 en los de 14 px y 2.4 en el candado). Decorativo (aria-hidden) salvo con
 * `etiqueta`. Toma el color de `currentColor`.
 */
export function icono24(nombre, { tamano = 18, ancho = null, alto = null, trazo = 1.8, etiqueta = null, clase = "" } = {}) {
  const formas = FORMAS_24[nombre];
  if (!formas) console.warn(`iconos: no existe el ícono de 24 px «${nombre}»`);
  return svg(
    "svg",
    {
      class: `icono24 icono24-${nombre}${clase ? ` ${clase}` : ""}`,
      viewBox: CAJA_24[nombre] ?? "0 0 24 24",
      width: ancho ?? tamano,
      height: alto ?? tamano,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": trazo,
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

const ICONO_DE_RESULTADO = { logrado: "logrado", fallido: "fallido", abandonado: "abandonado", sin_medir: "sin-medir", error: "error-herramienta" };

/** Texto de un resultado: "Logrado · por la ruta", "Fallido · declaró que terminó sin llegar", "Error de la herramienta". */
export function textoDeResultado(resultado, logro = null) {
  const base = t(`comun.resultado.${resultado}`);
  return logro ? `${base} · ${t(`comun.logro.${logro}`)}` : base;
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
