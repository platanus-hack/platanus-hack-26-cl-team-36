// La descarga pública de la extensión para Firefox, que ofrece la portada. El .xpi de cada release (firmado por
// Mozilla) vive en el repo personal, que es privado: el workflow descarga-extension.yml lo copia al almacén, bajo una
// carpeta que no es un sitio (empieza con "_", así HOST no la lista como corrida):
//
//   _descargas/firefox/ultima.json                  { "version": "0.6.0", "publicado": "2026-11-22T07:46:23Z" }
//   _descargas/firefox/chameleon-mode-<versión>.xpi
//
// Se lee con la misma fuente que las corridas (archivos en local, S3 en AWS). Nada de lo que viene de ultima.json se
// usa sin validar: el nombre del archivo se arma con la versión, no se toma del JSON.

export const CARPETA = "_descargas";
const ULTIMA = "firefox/ultima.json";
const VERSION = /^(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){2}$/;
export const ARCHIVO_XPI = /^chameleon-mode-(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){2}\.xpi$/;
// Cada visita a la portada pregunta por la última versión: se relee del almacén a lo más una vez por minuto.
const VIGENCIA_MS = 60_000;

const archivoDe = (version) => `chameleon-mode-${version}.xpi`;

/**
 * @param {import("./fuente.js").Fuente} fuente
 * @param {{ reloj?: () => number }} [opciones]
 */
export function crearDescargas(fuente, { reloj = Date.now } = {}) {
  let guardada = null;

  async function leerUltima() {
    const datos = await fuente.leerJson(CARPETA, ULTIMA);
    const version = typeof datos?.version === "string" ? datos.version : "";
    if (!VERSION.test(version)) return null;
    const publicado = typeof datos.publicado === "string" && !Number.isNaN(Date.parse(datos.publicado)) ? new Date(datos.publicado).toISOString() : null;
    return { version, archivo: archivoDe(version), publicado };
  }

  return {
    /** La última versión publicada, { version, archivo, publicado }, o null si no hay ninguna. */
    async firefox() {
      if (guardada && reloj() - guardada.leida < VIGENCIA_MS) return guardada.valor;
      const valor = await leerUltima();
      guardada = { valor, leida: reloj() };
      return valor;
    },

    /** Un .xpi publicado por su nombre ("chameleon-mode-0.6.0.xpi"); null si el nombre no calza o no existe. */
    abrirXpi(archivo, rango) {
      if (!ARCHIVO_XPI.test(archivo)) return null;
      return fuente.abrirArchivo(CARPETA, `firefox/${archivo}`, rango);
    },
  };
}
