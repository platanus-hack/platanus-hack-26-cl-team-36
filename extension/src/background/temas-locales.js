// Carga los temas empaquetados en src/temas/<id>/ (tema.json + tema.css).
//
// Por ahora la API solo dice qué tema usar y el contenido vive aquí. Cuando la API
// devuelva el tema completo, esto deja de hacer falta.

import { FORMATO_ID, normalizarTema } from "./temas.js";

async function leer(ruta, formato) {
  const respuesta = await fetch(browser.runtime.getURL(ruta));
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (${respuesta.status})`);
  return formato === "json" ? respuesta.json() : respuesta.text();
}

const cache = new Map(); // id → Promise<tema>

export function cargarTemaLocal(id) {
  if (!FORMATO_ID.test(id)) return Promise.reject(new Error(`id de tema inválido: ${JSON.stringify(id)}`));

  if (!cache.has(id)) {
    const promesa = Promise.all([leer(`temas/${id}/tema.json`, "json"), leer(`temas/${id}/tema.css`, "text")])
      .then(([datos, css]) => normalizarTema({ ...datos, id, css }));
    promesa.catch(() => cache.delete(id)); // reintentar en la próxima llamada
    cache.set(id, promesa);
  }
  return cache.get(id);
}
