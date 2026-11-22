// Lógica pura de las revisiones: el tema que los agentes generan para cada página.
// Sin `browser.*`: se testea con Node (ver test/revisiones.test.js).
//
//   GET  /revisiones?url=<url> → 200 { success, revision, status, css?, tema? } (`css` si status "done"; `tema`, el
//                                tema.json del improver con sus `features`, si lo dejó);
//                                404 { success: false } si la página no tiene revisión. Es lo que usa la extensión.
//   POST /revisiones { url }   → lo mismo, pero una página nueva dispara su revisión: 202 { …, status: "queued" }.
//                                La extensión no lo usa (ver el TODO en index.js).
//
// Un resultado es { estado: "listo", revision, css, tema? } | { estado: "esperando", revision } | { estado: "sin-revision" }
// (404) | { estado: "fin" } (`failed` y respuestas raras). Los errores pasajeros (red, timeout, 5xx) lanzan en api.js y
// resolverRevision los devuelve como { estado: "error" }: mientras se espera una revisión, se vuelve a intentar.

import { sanearCss } from "./css-remoto.js";
import { sanearTema } from "./tema-remoto.js";
import { normalizarTema } from "./temas.js";

// Cada cuánto el content script vuelve a preguntar mientras la revisión corre (de INTERVALO a INTERVALO_MAXIMO,
// multiplicando por FACTOR en cada vuelta), y hasta cuándo.
export const INTERVALO_REVISION_MS = 3000;
export const INTERVALO_MAXIMO_REVISION_MS = 15_000;
export const FACTOR_INTERVALO_REVISION = 1.5;
export const TOPE_REVISION_MS = 10 * 60_000;

const FORMATO_REVISION = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// La URL que se envía: sin query ni hash (pueden llevar tokens o datos de la cuenta).
export function urlDePagina(url) {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

export function leerRevision(datos) {
  const { success, revision, status, css, tema } = datos ?? {};
  if (success !== true || typeof revision !== "string" || revision.length > 40 || !FORMATO_REVISION.test(revision)) {
    return { estado: "fin" };
  }
  if (status === "queued" || status === "running") return { estado: "esperando", revision };
  if (status === "done" && typeof css === "string") {
    return { estado: "listo", revision, css, ...(tema && typeof tema === "object" && !Array.isArray(tema) && { tema }) };
  }
  return { estado: "fin" };
}

// El id es estable por revisión (`rev-<revision>`) para que los votos sobre ese tema se puedan agrupar.
// Sin CSS aplicable no hay tema, aunque el tema.json traiga vistas.
export function temaDeRevision(revision, css, tema, log = console) {
  const saneado = sanearCss(css);
  if (!saneado.css) return null;
  const { features, rechazos } = sanearTema(tema);
  if (rechazos.length) log.warn(`[mi-tema] La revisión ${revision} trae partes del tema que no se aplican:`, rechazos);
  return normalizarTema({ id: `rev-${revision}`, nombre: `Revisión ${revision}`, css: saneado.css, features });
}

// `consultar`: consultarRevision (o pedirRevision) de api.js. Nunca lanza; "listo" trae `tema` en vez de `css`.
// → { estado: "listo", revision, tema } | { estado: "esperando" | "sin-revision" | "fin" | "error" }
export async function resolverRevision(url, { consultar, log = console }) {
  let resultado;
  try {
    resultado = await consultar(urlDePagina(url));
  } catch (error) {
    log.debug("[mi-tema] La API no respondió por la revisión de la página:", error);
    return { estado: "error" };
  }
  if (resultado?.estado === "esperando" || resultado?.estado === "sin-revision") return resultado;
  if (resultado?.estado !== "listo") return { estado: "fin" };
  const tema = temaDeRevision(resultado.revision, resultado.css, resultado.tema, log);
  if (!tema) {
    log.warn(`[mi-tema] La revisión ${resultado.revision} no dejó CSS aplicable.`);
    return { estado: "fin" };
  }
  return { estado: "listo", revision: resultado.revision, tema };
}
