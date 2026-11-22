// Las descargas públicas de la extensión que ofrece la portada: el .xpi para Firefox y el .zip para Chrome. Los
// releases viven en el repo personal, que es privado: el workflow descarga-extension.yml copia los archivos del último
// release al almacén, bajo una carpeta que no es un sitio (empieza con "_", así HOST no la lista como corrida):
//
//   _descargas/firefox/ultima.json                         { "version": "0.7.0", "publicado": "2026-11-22T08:21:28Z" }
//   _descargas/firefox/chameleon-mode-<versión>.xpi
//   _descargas/chrome/ultima.json
//   _descargas/chrome/chameleon-mode-chrome-<versión>.zip
//
// Se lee con la misma fuente que las corridas (archivos en local, S3 en AWS). Nada de lo que viene de ultima.json se
// usa sin validar: el nombre del archivo se arma con la versión, no se toma del JSON.

export const CARPETA = "_descargas";
const NUMERO = "(?:0|[1-9]\\d{0,8})";
const VERSION = new RegExp(`^${NUMERO}(?:\\.${NUMERO}){2}$`);

/** Por navegador: el nombre del archivo de una versión y el patrón que lo reconoce. */
export const NAVEGADORES = {
  firefox: { archivo: (version) => `chameleon-mode-${version}.xpi`, patron: new RegExp(`^chameleon-mode-${NUMERO}(?:\\.${NUMERO}){2}\\.xpi$`) },
  chrome: { archivo: (version) => `chameleon-mode-chrome-${version}.zip`, patron: new RegExp(`^chameleon-mode-chrome-${NUMERO}(?:\\.${NUMERO}){2}\\.zip$`) },
};

/** El navegador de un archivo publicado ("chameleon-mode-chrome-0.7.0.zip" → "chrome"), o null si no es uno. */
export const navegadorDeArchivo = (archivo) =>
  Object.keys(NAVEGADORES).find((navegador) => NAVEGADORES[navegador].patron.test(String(archivo))) ?? null;

// Cada visita a la portada pregunta por la última versión: se relee del almacén a lo más una vez por minuto.
const VIGENCIA_MS = 60_000;

/**
 * @param {import("./fuente.js").Fuente} fuente
 * @param {{ reloj?: () => number }} [opciones]
 */
export function crearDescargas(fuente, { reloj = Date.now } = {}) {
  const guardadas = new Map();

  async function leerUltima(navegador) {
    const datos = await fuente.leerJson(CARPETA, `${navegador}/ultima.json`);
    const version = typeof datos?.version === "string" ? datos.version : "";
    if (!VERSION.test(version)) return null;
    const publicado = typeof datos.publicado === "string" && !Number.isNaN(Date.parse(datos.publicado)) ? new Date(datos.publicado).toISOString() : null;
    return { version, archivo: NAVEGADORES[navegador].archivo(version), publicado };
  }

  return {
    /**
     * La última versión publicada para `navegador` ("firefox" o "chrome"), { version, archivo, publicado }, o null si
     * no hay ninguna o el navegador no es uno de NAVEGADORES.
     */
    async ultima(navegador) {
      if (!Object.hasOwn(NAVEGADORES, navegador)) return null;
      const guardada = guardadas.get(navegador);
      if (guardada && reloj() - guardada.leida < VIGENCIA_MS) return guardada.valor;
      const valor = await leerUltima(navegador);
      guardadas.set(navegador, { valor, leida: reloj() });
      return valor;
    },

    /** Un archivo publicado por su nombre ("chameleon-mode-0.7.0.xpi"); null si el nombre no calza o no existe. */
    abrir(archivo, rango) {
      const navegador = navegadorDeArchivo(archivo);
      if (!navegador) return null;
      return fuente.abrirArchivo(CARPETA, `${navegador}/${archivo}`, rango);
    },
  };
}
