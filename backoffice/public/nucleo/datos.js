// Pedidos a la API del backoffice (diseño §3, §5.3), con caché en memoria: las tandas no cambian una vez escritas.
// Las rutas son relativas a la página: el backoffice vive en /backoffice/ (servidor.js), así que "api/tandas"
// pide /backoffice/api/tandas.

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
    tandas = pedirJson("api/tandas").then((datos) => {
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
    const promesa = pedirJson(`api/tandas/${segmentosCodificados(id)}`);
    detalle.set(id, promesa);
    promesa.catch(() => detalle.delete(id));
  }
  return detalle.get(id);
}

// Las revisiones cambian mientras corren: sin caché, la pantalla vuelve a pedirlas cada pocos segundos.
/** → { disponible, revisiones: ResumenDeRevision[] } */
export const pedirRevisiones = () => pedirJson("api/revisiones");
/** → AvanceDeRevision | null (404) */
export const pedirRevision = (revision) => pedirJson(`api/revisiones/${encodeURIComponent(revision)}`);
// El Overview también se refresca cada pocos segundos: sin caché.
/** → { ahora, roles: { cataloger, guide, visitor: { all, desktop, mobile }, improver } } (contrato §1) | null (404) */
export const pedirResumen = () => pedirJson("api/resumen");
/**
 * → { ahora, disponible, umbralDetenidaMin, busqueda, cuentas, pestanas, tarjetas } (contrato §2 y §7) | null (404).
 * Cada pestaña trae una página de 6 ids: la 1, o `pagina` en `pestana` (paginado, contrato §7.4). Con `link`, solo las
 * revisiones cuyo link calza.
 */
export function pedirOverview({ pestana = null, pagina = null, link = null } = {}) {
  const consulta = new URLSearchParams();
  if (pestana) consulta.set("pestana", pestana);
  if (pagina > 1) consulta.set("pagina", String(pagina));
  if (link) consulta.set("link", link);
  const texto = consulta.toString();
  return pedirJson(`api/overview${texto ? `?${texto}` : ""}`);
}
/** "resultados/<clave de corrida>/<archivo>" */
export const urlDeResultado = (clave) => `resultados/${segmentosCodificados(clave)}`;

// La propuesta del Diseñador cambia mientras diseña: sin caché, la pestaña la vuelve a pedir hasta que termina.
/** → Propuesta (lib/propuestas.js) | null (404: la tanda no existe) */
export const pedirPropuesta = (tandaId) => pedirJson(`api/propuestas/${segmentosCodificados(tandaId)}`);
/** "propuestas/<corrida del Diseñador>/vistas/<nombre>.png" */
export const urlDePropuesta = (clave) => `propuestas/${segmentosCodificados(clave)}`;

/** Evento que avisa el estado de la propuesta de una tanda (detail: { tandaId, estado }): el marco pinta su pestaña. */
export const EVENTO_PROPUESTA = "backoffice:propuesta";

/** "archivos/<host>/visitor/<objetivo>/<corrida>/<perfil>/<archivo>", cada segmento codificado. */
export function urlDeArchivo(tandaId, perfil, archivo) {
  return `archivos/${[...String(tandaId).split("/"), perfil, archivo].map(encodeURIComponent).join("/")}`;
}
