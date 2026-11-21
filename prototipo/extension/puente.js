/**
 * Cliente del puente local. Solo lo usa el script de fondo: toda la red sale de ahí.
 */

import { leerUrlPuente } from "./almacen.js";

/**
 * @typedef {object} SolicitudGeneracion
 * @property {string} id_solicitud
 * @property {string} sitio
 * @property {string} patron_ruta
 * @property {string} mapa_pagina
 * @property {string} sugerencia
 * @property {string[]} preferencias
 * @property {null} piel_actual
 */

/**
 * @typedef {object} RespuestaGeneracion
 * @property {string} id_solicitud
 * @property {string} nombre
 * @property {string} descripcion
 * @property {string} css
 * @property {string} explicacion
 * @property {Array<{ texto: string, alcance: "global" | "sitio" }>} preferencias_detectadas
 * @property {number} duracion_ms
 * @property {string} modelo
 */

/**
 * @typedef {object} SaludPuente
 * @property {boolean} ok
 * @property {string} [version]
 * @property {string} [modelo]
 * @property {"listo" | "no_encontrado"} [claude]
 * @property {string} [mensaje]
 */

const ESPERA_SALUD_MS = 3_000;
const ESPERA_GENERACION_MS = 180_000;
const ESPERA_CONSULTA_MS = 10_000;
const PAUSA_SONDEO_MS = 2_000;
const SONDEO_MAXIMO_MS = 180_000;
const MENSAJE_SIN_PUENTE = "No se pudo conectar con el puente local. ¿Está encendido?";

/** Error con un mensaje listo para mostrar en el panel. */
export class ErrorPuente extends Error {
  /**
   * @param {string} mensaje
   * @param {{ codigo?: string, deRed?: boolean }} [detalle]
   */
  constructor(mensaje, { codigo = "desconocido", deRed = false } = {}) {
    super(mensaje);
    this.name = "ErrorPuente";
    this.codigo = codigo;
    this.deRed = deRed;
  }
}

/**
 * @param {string} ruta
 * @param {RequestInit & { esperaMs: number }} opciones
 * @returns {Promise<Response>}
 */
async function llamar(ruta, { esperaMs, ...opciones }) {
  const base = await leerUrlPuente();
  try {
    return await fetch(`${base}${ruta}`, { ...opciones, signal: AbortSignal.timeout(esperaMs) });
  } catch {
    throw new ErrorPuente(MENSAJE_SIN_PUENTE, { codigo: "sin_conexion", deRed: true });
  }
}

/**
 * Convierte una respuesta de error del puente (`{ error, mensaje }`) en un `ErrorPuente`.
 * @param {Response} respuesta
 * @returns {Promise<ErrorPuente>}
 */
async function leerError(respuesta) {
  try {
    const cuerpo = await respuesta.json();
    return new ErrorPuente(cuerpo.mensaje ?? `El puente respondió ${respuesta.status}.`, { codigo: cuerpo.error });
  } catch {
    return new ErrorPuente(`El puente respondió ${respuesta.status}.`);
  }
}

/** @returns {Promise<SaludPuente>} */
export async function consultarSalud() {
  try {
    const respuesta = await llamar("/salud", { esperaMs: ESPERA_SALUD_MS });
    if (!respuesta.ok) throw await leerError(respuesta);
    return await respuesta.json();
  } catch (error) {
    return { ok: false, mensaje: error instanceof Error ? error.message : MENSAJE_SIN_PUENTE };
  }
}

/**
 * Consulta una generación ya pedida.
 * @param {string} idSolicitud
 * @returns {Promise<RespuestaGeneracion | null>} `null` si sigue en curso.
 */
export async function consultarGeneracion(idSolicitud) {
  const respuesta = await llamar(`/generaciones/${encodeURIComponent(idSolicitud)}`, { esperaMs: ESPERA_CONSULTA_MS });
  if (respuesta.status === 202) return null;
  if (respuesta.status === 404) {
    throw new ErrorPuente("El puente no conoce esta generación. Vuelve a intentarlo.", { codigo: "desconocida" });
  }
  if (!respuesta.ok) throw await leerError(respuesta);
  return await respuesta.json();
}

/**
 * Espera el resultado de una generación consultando al puente cada poco.
 * @param {string} idSolicitud
 * @returns {Promise<RespuestaGeneracion>}
 */
export async function esperarGeneracion(idSolicitud) {
  const limite = Date.now() + SONDEO_MAXIMO_MS;
  while (Date.now() < limite) {
    const resultado = await consultarGeneracion(idSolicitud);
    if (resultado !== null) return resultado;
    await new Promise((resolver) => setTimeout(resolver, PAUSA_SONDEO_MS));
  }
  throw new ErrorPuente("La generación tardó demasiado.", { codigo: "tiempo_agotado" });
}

/**
 * Pide una piel al puente. Si la conexión se corta a mitad de camino, intenta recuperar el
 * resultado con `GET /generaciones/<id_solicitud>`.
 * @param {SolicitudGeneracion} solicitud
 * @returns {Promise<RespuestaGeneracion>}
 */
export async function pedirGeneracion(solicitud) {
  let respuesta;
  try {
    respuesta = await llamar("/generaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solicitud),
      esperaMs: ESPERA_GENERACION_MS,
    });
  } catch (error) {
    try {
      return await esperarGeneracion(solicitud.id_solicitud);
    } catch {
      throw error;
    }
  }
  if (!respuesta.ok) throw await leerError(respuesta);
  return await respuesta.json();
}
