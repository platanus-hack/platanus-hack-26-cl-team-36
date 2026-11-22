// Pedidos a la API del backoffice (diseño §3, §5.3), con caché en memoria: las tandas no cambian una vez escritas.

export class ErrorDeDatos extends Error {
  /** @param {string} mensaje  @param {number} estado  código HTTP, o 0 si no hubo respuesta */
  constructor(mensaje, estado) {
    super(mensaje);
    this.name = "ErrorDeDatos";
    this.estado = estado;
  }
}

const segmentosCodificados = (id) => String(id).split("/").map(encodeURIComponent).join("/");

async function pedirJson(url) {
  let respuesta;
  try {
    respuesta = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new ErrorDeDatos(`${url}: ${error?.message ?? error}`, 0);
  }
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new ErrorDeDatos(`${url} respondió ${respuesta.status}`, respuesta.status);
  return respuesta.json();
}

let tandas = null;

/** → { carpeta, tandas: ResumenDeTanda[] } (de la más nueva a la más vieja). */
export function pedirTandas({ refrescar = false } = {}) {
  if (!tandas || refrescar) {
    tandas = pedirJson("/api/tandas").then((datos) => {
      // Tolera la forma anterior de la API (un arreglo) mientras se actualiza el servidor.
      if (Array.isArray(datos)) return { carpeta: null, tandas: datos };
      return { carpeta: datos?.carpeta ?? null, tandas: datos?.tandas ?? [] };
    });
    tandas.catch(() => {
      tandas = null;
    });
  }
  return tandas;
}

const detalle = new Map();

/** → Tanda | null (404). Guardada por id. */
export function pedirTanda(id) {
  if (!detalle.has(id)) {
    const promesa = pedirJson(`/api/tandas/${segmentosCodificados(id)}`);
    detalle.set(id, promesa);
    promesa.catch(() => detalle.delete(id));
  }
  return detalle.get(id);
}

/** "/archivos/<host>/visitor/<objetivo>/<corrida>/<perfil>/<archivo>", cada segmento codificado. */
export function urlDeArchivo(tandaId, perfil, archivo) {
  return `/archivos/${[...String(tandaId).split("/"), perfil, archivo].map(encodeURIComponent).join("/")}`;
}
