// Cliente del backend (ver backend/index.js).
//
//   POST {API_URL}/temas/buscar   { "url": "https://www.youtube.com" }
//     { success: true,  tema: "youtube" } → hay tema
//     { success: false, ... }             → el sitio no tiene tema (la API responde 404)
//
// Solo se envía el origen (esquema + dominio), nunca la ruta ni los parámetros.

import { API_URL } from "./config.js";

// Si el backend no responde a tiempo, se trata como caído (no se aplica tema).
const TIEMPO_MAXIMO_MS = 2000;

// Devuelve el id del tema, o null si el sitio no tiene tema.
// Lanza error si el backend no responde o responde algo inesperado.
export async function consultarTema(url) {
  const respuesta = await fetch(`${API_URL}/temas/buscar`, {
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
