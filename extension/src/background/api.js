// Cliente del backend (ver backend/index.js), en {urlDeLaApi()} (ver config.js).
//
//   POST /revisiones y GET /revisiones?url=  (ver revisiones.js): la URL de la página sin query ni hash.
//   La API busca la revisión de esa página en DynamoDB y, si terminó, devuelve el tema.css que dejó en S3.

import { urlDeLaApi } from "./config.js";
import { leerRevision } from "./revisiones.js";

// Si el backend no responde a tiempo, no se aplica tema. Holgado: no frena la página (el tema llega cuando llega)
// y la respuesta trae el CSS.
const TIEMPO_MAXIMO_REVISION_MS = 5000;

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
