/**
 * Acceso al almacenamiento de la extensión. El script de fondo no guarda nada esencial en
 * memoria: lo duradero va en `storage.local` y lo de la sesión del navegador en `storage.session`.
 */

import { clavePiel } from "./rutas.js";

/**
 * @typedef {object} Configuracion
 * @property {string} sugerencia Instrucción global del usuario.
 * @property {boolean} adaptar_todos Interruptor "Adaptar todos los sitios".
 * @property {string[]} sitios_apagados Sitios con "Adaptar este sitio" apagado.
 */

/**
 * @typedef {object} Piel
 * @property {number} version_esquema
 * @property {string} id
 * @property {string} sitio
 * @property {string} patron_ruta
 * @property {string} nombre
 * @property {string} descripcion
 * @property {string} css CSS tal como llegó del puente; se sanea al inyectar.
 * @property {string | null} padre_id
 * @property {string} explicacion
 * @property {string} sugerencia Instrucción con la que se generó.
 * @property {number} duracion_ms
 * @property {string} modelo
 */

/**
 * @typedef {object} EstadoPestana
 * @property {string} sitio
 * @property {string} patron_ruta
 * @property {"inactiva" | "generando" | "aplicada" | "original" | "error"} estado
 * @property {string} [motivo] Por qué está inactiva.
 * @property {string} [id_solicitud] Generación que espera la pestaña.
 * @property {number} [inicio_ms] Cuándo empezó esa generación.
 * @property {string} [css] CSS saneado de la piel de la pestaña (inyectado si `estado` es "aplicada").
 * @property {{ nombre: string, explicacion: string, duracion_ms: number, modelo: string }} [piel]
 * @property {string} [mensaje] Mensaje de error.
 */

/**
 * @typedef {object} RegistroGeneracion
 * @property {string} id_solicitud
 * @property {string} clave Sitio, patrón de ruta y sugerencia.
 * @property {string} sitio
 * @property {string} patron_ruta
 * @property {string} sugerencia
 * @property {number} inicio_ms
 */

export const URL_PUENTE_POR_DEFECTO = "http://127.0.0.1:8765";

const CLAVE_CONFIGURACION = "configuracion";
const CLAVE_URL_PUENTE = "url_puente";
const PREFIJO_PIEL = "piel:";
const PREFIJO_PESTANA = "pestana:";
const PREFIJO_GENERACION = "generacion:";

/** @type {Configuracion} */
const CONFIGURACION_INICIAL = { sugerencia: "", adaptar_todos: false, sitios_apagados: [] };

/** @returns {Promise<Configuracion>} */
export async function leerConfiguracion() {
  const guardado = await browser.storage.local.get(CLAVE_CONFIGURACION);
  return { ...CONFIGURACION_INICIAL, ...guardado[CLAVE_CONFIGURACION] };
}

/** @param {Configuracion} configuracion */
export async function guardarConfiguracion(configuracion) {
  await browser.storage.local.set({ [CLAVE_CONFIGURACION]: configuracion });
}

/**
 * URL base del puente local. Se puede cambiar (para pruebas) con `url_puente` en `storage.local`.
 * @returns {Promise<string>}
 */
export async function leerUrlPuente() {
  const guardado = await browser.storage.local.get(CLAVE_URL_PUENTE);
  return guardado[CLAVE_URL_PUENTE] || URL_PUENTE_POR_DEFECTO;
}

/** @param {string} url Vacía para volver a la URL por defecto. */
export async function guardarUrlPuente(url) {
  const limpia = url.trim().replace(/\/+$/, "");
  if (limpia === "") {
    await browser.storage.local.remove(CLAVE_URL_PUENTE);
    return;
  }
  const destino = new URL(limpia);
  if (destino.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(destino.hostname)) {
    throw new Error("El puente tiene que estar en este equipo (http://127.0.0.1:<puerto>).");
  }
  await browser.storage.local.set({ [CLAVE_URL_PUENTE]: destino.origin });
}

/**
 * @param {string} sitio
 * @param {string} patronRuta
 * @returns {Promise<Piel | null>}
 */
export async function leerPiel(sitio, patronRuta) {
  const clave = PREFIJO_PIEL + clavePiel(sitio, patronRuta);
  const guardado = await browser.storage.local.get(clave);
  return guardado[clave] ?? null;
}

/** @param {Piel} piel */
export async function guardarPiel(piel) {
  await browser.storage.local.set({ [PREFIJO_PIEL + clavePiel(piel.sitio, piel.patron_ruta)]: piel });
}

/** @returns {Promise<number>} Cuántas pieles se borraron. */
export async function borrarPieles() {
  const claves = Object.keys(await browser.storage.local.get(null)).filter((clave) => clave.startsWith(PREFIJO_PIEL));
  await browser.storage.local.remove(claves);
  return claves.length;
}

/** @returns {Promise<number>} */
export async function contarPieles() {
  return Object.keys(await browser.storage.local.get(null)).filter((clave) => clave.startsWith(PREFIJO_PIEL)).length;
}

/**
 * @param {number} tabId
 * @returns {Promise<EstadoPestana | null>}
 */
export async function leerEstadoPestana(tabId) {
  const clave = PREFIJO_PESTANA + tabId;
  const guardado = await browser.storage.session.get(clave);
  return guardado[clave] ?? null;
}

/**
 * @param {number} tabId
 * @param {EstadoPestana} estado
 */
export async function guardarEstadoPestana(tabId, estado) {
  await browser.storage.session.set({ [PREFIJO_PESTANA + tabId]: estado });
}

/** @param {number} tabId */
export async function borrarEstadoPestana(tabId) {
  await browser.storage.session.remove(PREFIJO_PESTANA + tabId);
}

/** @returns {Promise<Array<{ tabId: number, estado: EstadoPestana }>>} */
export async function listarEstadosPestanas() {
  const todo = await browser.storage.session.get(null);
  return Object.entries(todo)
    .filter(([clave]) => clave.startsWith(PREFIJO_PESTANA))
    .map(([clave, estado]) => ({ tabId: Number(clave.slice(PREFIJO_PESTANA.length)), estado }));
}

/** @param {RegistroGeneracion} registro */
export async function guardarGeneracion(registro) {
  await browser.storage.session.set({ [PREFIJO_GENERACION + registro.id_solicitud]: registro });
}

/** @param {string} idSolicitud */
export async function borrarGeneracion(idSolicitud) {
  await browser.storage.session.remove(PREFIJO_GENERACION + idSolicitud);
}

/** @returns {Promise<RegistroGeneracion[]>} */
export async function listarGeneraciones() {
  const todo = await browser.storage.session.get(null);
  return Object.entries(todo)
    .filter(([clave]) => clave.startsWith(PREFIJO_GENERACION))
    .map(([, registro]) => registro);
}
