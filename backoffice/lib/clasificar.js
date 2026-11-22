// Clasificación de corridas e intentos para el Overview (contrato del Overview v3, §0). Lógica pura.
//
// - Corrida de un agente (cataloger, guide, improver; también la tanda del Visitante): por `manifest.status`,
//   succeeded → logrado, failed → fallido, running → en_curso; sin manifest legible u otro estado → no cuenta.
// - Intento del Visitante: por su run.json, exactamente como lib/derivar.js (resultadoDelRun); un run.json dañado o
//   que no es un objeto → error. Sin run.json, con trace.json `status: "running"` en una tanda cuyo manifest dice
//   running → en_curso. Si no, no es un intento (todavía no parte o quedó a medias en una tanda cerrada).
// - Dispositivo: el ancho del `viewport` de run.json ("390x844") bajo ANCHO_MOVIL es mobile; el resto, desktop (sin
//   viewport también). Nunca el nombre del perfil. De un intento en curso, trace.json no trae viewport: mobile solo si
//   `profile === "mobile"`.

import { resultadoDelRun } from "./derivar.js";

/** Ancho en px bajo el cual un viewport es de teléfono: hoy 390x844 → mobile, 1024x768 → desktop. */
export const ANCHO_MOVIL = 700;

/** Estados de un agente (un cuadrito o un tramo) en el orden en que se dibujan. */
export const ESTADOS_DE_AGENTE = ["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso", "en_cola"];

const ESTADO_DE_MANIFIESTO = { succeeded: "logrado", failed: "fallido", running: "en_curso" };
// Nombres de archivo de captura que se pueden servir (los mismos que ARCHIVO_DE_PERFIL en lib/tandas.js).
const CAPTURA = /^step_\d{2,3}\.png$/;
const CAPTURA_DE_INICIO = "step_00.png";

const esObjeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);
const textoONulo = (valor) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/**
 * "desktop" o "mobile" según el ancho del viewport ("390x844", o { width }).
 * @param {unknown} viewport
 * @returns {"desktop" | "mobile"}
 */
export function dispositivoDeViewport(viewport) {
  const ancho = esObjeto(viewport) ? Number(viewport.width) : Number.parseInt(String(viewport ?? "").split("x")[0], 10);
  return Number.isFinite(ancho) && ancho > 0 && ancho < ANCHO_MOVIL ? "mobile" : "desktop";
}

/**
 * El estado de una corrida según `manifest.status`, o null si no cuenta.
 * @param {unknown} status
 * @returns {"logrado" | "fallido" | "en_curso" | null}
 */
export const estadoDeCorrida = (status) =>
  typeof status === "string" && Object.hasOwn(ESTADO_DE_MANIFIESTO, status) ? ESTADO_DE_MANIFIESTO[status] : null;

/**
 * @typedef {Object} IntentoDelIndice   un intento del Visitante tal como lo guarda lib/indice.js
 * @property {string} carpeta
 * @property {"logrado" | "fallido" | "abandonado" | "sin_medir" | "error" | "en_curso"} estado
 * @property {"desktop" | "mobile"} dispositivo
 * @property {string | null} url        start.url (o start_url) del run.json
 * @property {string | null} titulo     start.title del run.json
 * @property {string | null} captura    la captura de la página de inicio ("step_00.png"), solo con run.json
 * @property {string | null} instruccion
 */

/**
 * Un intento a partir de lo leído de su carpeta, o null si no cuenta.
 * @param {string} carpeta
 * @param {{ run: { datos: unknown, estado: "ok" | "falta" | "danado" }, traza?: unknown, tandaEnCurso?: boolean }} leido
 * @returns {IntentoDelIndice | null}
 */
export function intentoDelVisitante(carpeta, { run, traza = null, tandaEnCurso = false }) {
  if (run.estado === "ok" && esObjeto(run.datos)) {
    const datos = run.datos;
    const inicio = esObjeto(datos.start) ? datos.start : {};
    const estado = resultadoDelRun(datos);
    // Sin start.screenshot, step_00.png existe si el intento partió (todos menos los errores sin página de inicio).
    const captura = CAPTURA.test(String(inicio.screenshot ?? "")) ? inicio.screenshot : estado === "error" ? null : CAPTURA_DE_INICIO;
    return {
      carpeta,
      estado,
      dispositivo: dispositivoDeViewport(datos.viewport),
      url: textoONulo(inicio.url) ?? textoONulo(datos.start_url),
      titulo: textoONulo(inicio.title),
      captura,
      instruccion: textoONulo(datos.instruction),
    };
  }
  // Dañado (no es JSON) o JSON que no es un intento: un error de la herramienta, sin viewport (desktop).
  if (run.estado !== "falta") {
    return { carpeta, estado: "error", dispositivo: "desktop", url: null, titulo: null, captura: null, instruccion: null };
  }
  if (tandaEnCurso && esObjeto(traza) && traza.status === "running") {
    return {
      carpeta,
      estado: "en_curso",
      dispositivo: traza.profile === "mobile" ? "mobile" : "desktop",
      url: null,
      titulo: null,
      captura: null,
      instruccion: null,
    };
  }
  return null;
}
