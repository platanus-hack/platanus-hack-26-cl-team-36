// Cliente del backend (ver backend/index.js).
//
//   POST {urlDeLaApi()}/temas/buscar   { "url": "https://www.youtube.com" }   (ver config.js)
//     { success: true,  tema: "youtube" } → hay tema
//     { success: false, ... }             → el sitio no tiene tema (la API responde 404)
//
// A /temas/buscar solo se envía el origen (esquema + dominio), nunca la ruta ni los parámetros.
//
//   POST /revisiones y GET /revisiones?url=  (ver revisiones.js): la URL de la página sin query ni hash.

import { urlDeLaApi } from "./config.js";
import { leerRevision } from "./revisiones.js";

// Si el backend no responde a tiempo, se trata como caído (no se aplica tema).
const TIEMPO_MAXIMO_MS = 2000;
// Más holgado que /temas/buscar: no frena la página (el tema remoto llega cuando llega) y trae el CSS.
const TIEMPO_MAXIMO_REVISION_MS = 5000;

// Devuelve el id del tema, o null si el sitio no tiene tema.
// Lanza error si el backend no responde o responde algo inesperado.
export async function consultarTema(url) {
  const respuesta = await fetch(`${await urlDeLaApi()}/temas/buscar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: new URL(url).origin }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });

  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    throw new Error(`La API respondió ${respuesta.status} sin JSON válido`);
  }

  if (datos?.success === true && typeof datos.tema === "string") return datos.tema;
  if (datos?.success === false) return null;
  throw new Error(`Respuesta inesperada de la API (${respuesta.status}): ${JSON.stringify(datos)}`);
}

// Lanzan si la API no responde o no manda JSON (resolverRevision lo trata como "fin").
export async function pedirRevision(url) {
  return leerRespuestaRevision(
    await fetch(`${await urlDeLaApi()}/revisiones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_REVISION_MS),
    }),
  );
}

export async function consultarRevision(url) {
  return leerRespuestaRevision(
    await fetch(`${await urlDeLaApi()}/revisiones?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_REVISION_MS),
    }),
  );
}

async function leerRespuestaRevision(respuesta) {
  try {
    return leerRevision(await respuesta.json());
  } catch {
    throw new Error(`La API respondió ${respuesta.status} sin JSON válido`);
  }
}
