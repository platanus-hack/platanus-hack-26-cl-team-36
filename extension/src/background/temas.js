// Lógica pura de temas: sin APIs del navegador, para poder testearla con Node
// (ver test/). No uses `browser.*` aquí.
//
// Un tema normalizado tiene esta forma:
//
//   {
//     id: "rev-mwr9p1h5-de8737",
//     nombre: "Revisión mwr9p1h5-de8737",
//     css: "html.mi-tema { ... }",        // contenido CSS, todo bajo html.mi-tema
//     features: {},                       // id de feature → opciones (la API todavía no manda)
//     eventosNavegacion: [],              // eventos del sitio que re-ejecutan las features
//   }
//
// Los temas llegan de la API: el CSS que generó la revisión de cada página (ver revisiones.js).

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
