// Lógica pura de temas: sin APIs del navegador, para poder testearla con Node
// (ver test/). No uses `browser.*` aquí.
//
// Un tema normalizado tiene esta forma:
//
//   {
//     id: "youtube",
//     nombre: "YouTube morado",
//     css: "html.mi-tema { ... }",        // contenido CSS, todo bajo html.mi-tema
//     features: { "modo-foco": { ... } }, // id de feature → opciones
//     eventosNavegacion: ["yt-navigate-finish"], // eventos del sitio que re-ejecutan las features
//   }
//
// Qué tema va en qué sitio lo decide la API (backend/temas.js), no el tema.

export const FORMATO_ID = /^[a-z0-9-]+$/;

export function normalizarTema(datos) {
  const { id, nombre = id, css, features = {}, eventosNavegacion = [] } = datos ?? {};

  if (typeof id !== "string" || !FORMATO_ID.test(id)) {
    throw new Error(`Tema inválido: \`id\` debe ser minúsculas, números y guiones (recibí ${JSON.stringify(id)})`);
  }
  if (typeof css !== "string") {
    throw new Error(`Tema "${id}": falta \`css\``);
  }
  if (typeof features !== "object" || features === null || Array.isArray(features)) {
    throw new Error(`Tema "${id}": \`features\` debe ser un objeto { id: opciones }`);
  }

  return { id, nombre, css, features, eventosNavegacion };
}

// Decide el tema de una página:
//   1. Le pregunta a la API qué tema corresponde (`consultarApi(url) → id | null`).
//   2. Si la API dice que hay tema, lo carga (`cargarTema(id) → tema`).
// Si la API no responde o no tiene tema para el sitio, no se aplica nada.
export async function resolverTema(url, { consultarApi, cargarTema, log = console }) {
  let id;
  try {
    id = await consultarApi(url);
  } catch (error) {
    log.warn("[mi-tema] La API no está disponible, no se aplica tema:", error);
    return null;
  }
  if (!id) {
    log.debug(`[mi-tema] La API no tiene tema para ${url}`);
    return null;
  }
  try {
    return await cargarTema(id);
  } catch (error) {
    log.error(`[mi-tema] La API pidió el tema "${id}", pero no se pudo cargar:`, error);
    return null;
  }
}
