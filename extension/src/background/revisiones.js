// Lógica pura de las revisiones: el tema que los agentes generan para cada página.
// Sin `browser.*`: se testea con Node (ver test/revisiones.test.js).
//
//   GET  /revisiones?url=<url> → 200 { success, revision, status, css? } (`css` si status "done");
//                                404 { success: false } si la página no tiene revisión. Es lo que usa la extensión.
//   POST /revisiones { url }   → lo mismo, pero una página nueva dispara su revisión: 202 { …, status: "queued" }.
//                                La extensión no lo usa (ver el TODO en index.js).
//
// Un resultado es { estado: "listo", revision, css } | { estado: "esperando", revision } | { estado: "fin" }.
// "fin" cubre 404, `failed`, error de red y respuestas raras: no se aplica nada y no se insiste.

import { sanearCss } from "./css-remoto.js";
import { normalizarTema } from "./temas.js";

// Cada cuánto el content script vuelve a preguntar mientras la revisión corre, y hasta cuándo.
export const INTERVALO_REVISION_MS = 15_000;
export const TOPE_REVISION_MS = 10 * 60_000;

const FORMATO_REVISION = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// La URL que se envía: sin query ni hash (pueden llevar tokens o datos de la cuenta).
export function urlDePagina(url) {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

export function leerRevision(datos) {
  const { success, revision, status, css } = datos ?? {};
  if (success !== true || typeof revision !== "string" || revision.length > 40 || !FORMATO_REVISION.test(revision)) {
    return { estado: "fin" };
  }
  if (status === "queued" || status === "running") return { estado: "esperando", revision };
  if (status === "done" && typeof css === "string") return { estado: "listo", revision, css };
  return { estado: "fin" };
}

// El id es estable por revisión (`rev-<revision>`) para que los votos sobre ese tema se puedan agrupar.
export function temaDeRevision(revision, css) {
  const saneado = sanearCss(css);
  if (!saneado.css) return null;
  return normalizarTema({ id: `rev-${revision}`, nombre: `Revisión ${revision}`, css: saneado.css });
}

// `consultar`: consultarRevision (o pedirRevision) de api.js. Nunca lanza; "listo" trae `tema` en vez de `css`.
export async function resolverRevision(url, { consultar, log = console }) {
  let resultado;
  try {
    resultado = await consultar(urlDePagina(url));
  } catch (error) {
    log.debug("[mi-tema] Sin revisión para la página:", error);
    return { estado: "fin" };
  }
  if (resultado?.estado === "esperando") return resultado;
  if (resultado?.estado !== "listo") return { estado: "fin" };
  const tema = temaDeRevision(resultado.revision, resultado.css);
  if (!tema) {
    log.warn(`[mi-tema] La revisión ${resultado.revision} no dejó CSS aplicable.`);
    return { estado: "fin" };
  }
  return { estado: "listo", tema };
}
