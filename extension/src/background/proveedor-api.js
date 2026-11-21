// Proveedor de temas que le pregunta al backend (ver backend/index.js).
//
//   POST {API_URL}/temas/buscar   { "url": "https://www.youtube.com" }
//     204 o cuerpo vacío → no hay tema (se sigue con el siguiente proveedor)
//     200 + tema         → se usa ese tema (misma forma que normalizarTema)
//
// Solo se envía el origen (esquema + dominio), nunca la ruta ni los parámetros.

import { API_URL } from "./config.js";
import { normalizarTema } from "./temas.js";

// Si el backend no responde a tiempo, seguimos con los temas locales.
const TIEMPO_MAXIMO_MS = 2000;

export const proveedorApi = {
  nombre: "api",

  async buscar(url) {
    const respuesta = await fetch(`${API_URL}/temas/buscar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: new URL(url).origin }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!respuesta.ok) throw new Error(`La API respondió ${respuesta.status}`);

    const texto = await respuesta.text();
    if (!texto) return null;
    const datos = JSON.parse(texto);
    if (!datos || Object.keys(datos).length === 0) return null; // null o {} también es "sin tema"
    return normalizarTema(datos);
  },
};
