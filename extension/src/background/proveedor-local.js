// Proveedor de temas que lee los temas empaquetados en src/temas/.
//
// Un proveedor es cualquier objeto con `buscar(url) → Promise<tema | null>`.
// Cuando exista la API, se agrega un `proveedor-api.js` con la misma forma y se
// pone primero en la lista de background/index.js; este queda como respaldo.

import { normalizarTema, temaParaUrl } from "./temas.js";

const CARPETA = "temas";

async function leer(ruta, formato) {
  const respuesta = await fetch(browser.runtime.getURL(ruta));
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (${respuesta.status})`);
  return formato === "json" ? respuesta.json() : respuesta.text();
}

// Cada tema es una carpeta src/temas/<id>/ con tema.json + tema.css,
// y src/temas/index.json lista los ids.
async function cargarTemas() {
  const ids = await leer(`${CARPETA}/index.json`, "json");
  return Promise.all(
    ids.map(async (id) => {
      const [datos, css] = await Promise.all([
        leer(`${CARPETA}/${id}/tema.json`, "json"),
        leer(`${CARPETA}/${id}/tema.css`, "text"),
      ]);
      return normalizarTema({ ...datos, id, css });
    }),
  );
}

let cache = null;

export const proveedorLocal = {
  async buscar(url) {
    cache ??= cargarTemas().catch((error) => {
      cache = null; // reintentar en la próxima llamada
      throw error;
    });
    return temaParaUrl(await cache, url);
  },
};
