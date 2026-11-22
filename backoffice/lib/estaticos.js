// Archivos estáticos del backoffice (public/ y portada/): en memoria, con su ETag y comprimidos una sola vez; la
// versión de public/ (un hash de su contenido) y la página index.html con las URL versionadas y las precargas.
//
// Versión: la página pide todo lo suyo bajo v/<versión>/ (app.js, las hojas de estilos, y por las rutas relativas, cada
// módulo que importa), y servidor.js sirve v/<versión>/ con caché inmutable solo si es la versión actual. Un despliegue
// cambia la versión: una página nueva nunca recibe un módulo viejo de la caché, y una vieja que pide un módulo después
// del despliegue recibe 404, no uno nuevo que no calza con los suyos. La versión es un hash del contenido de public/,
// calculado al arrancar (sin tocar la imagen ni la infra) y otra vez si cambia un archivo (con `npm run dev`).
//
// Precargas: los <link rel="modulepreload"> de todo lo que importan precarga.js y app.js (así no se descubre nivel por nivel) y, por
// pantalla, un <meta name="precarga:<pantalla>"> con lo que esa pantalla agrega: precarga.js elige el de la ruta.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { memorizar } from "./memoria.js";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

// Tipos que vale la pena comprimir (JS, CSS, JSON, SVG, HTML, texto); nunca un text/event-stream (cada evento tiene que
// llegar apenas se escribe).
const COMPRIMIBLE = /^(?:text\/(?!event-stream)[a-z-]+|application\/(?:json|javascript)|image\/svg\+xml)(?:;|$)/;
// Menos que esto cabe en un paquete: comprimir no ahorra nada.
export const MINIMO_PARA_COMPRIMIR = 1024;

/** true si una respuesta de `tipo` (Content-Type) se comprime. */
export const esComprimible = (tipo) => COMPRIMIBLE.test(String(tipo ?? ""));

/**
 * La codificación de la respuesta según Accept-Encoding: "br" si se acepta, si no "gzip", si no null (sin comprimir).
 * @param {string | undefined} cabecera
 * @returns {"br" | "gzip" | null}
 */
export function elegirCodificacion(cabecera) {
  const pesos = new Map();
  for (const parte of String(cabecera ?? "").toLowerCase().split(",")) {
    const [nombre, ...parametros] = parte.split(";").map((texto) => texto.trim());
    if (!nombre) continue;
    const q = parametros.map((p) => /^q=([\d.]+)$/.exec(p)).find(Boolean);
    pesos.set(nombre, q ? Number(q[1]) : 1);
  }
  const acepta = (nombre) => (pesos.get(nombre) ?? pesos.get("*") ?? 0) > 0;
  return acepta("br") ? "br" : acepta("gzip") ? "gzip" : null;
}

/**
 * Comprime `cuerpo`. Lo estático se comprime una vez y se guarda: con el nivel más alto. Una respuesta de la API se
 * comprime en cada pedido: con un nivel rápido.
 * @param {Buffer} cuerpo
 * @param {"br" | "gzip"} codificacion
 * @param {{ estatico?: boolean }} [opciones]
 */
export function comprimir(cuerpo, codificacion, { estatico = false } = {}) {
  if (codificacion === "br") {
    return brotli(cuerpo, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: estatico ? zlib.constants.BROTLI_MAX_QUALITY : 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: cuerpo.length,
      },
    });
  }
  return gzip(cuerpo, { level: estatico ? 9 : 6 });
}

const hashDe = (cuerpo) => createHash("sha256").update(cuerpo).digest("base64url").slice(0, 22);

/**
 * Un archivo en memoria: `etag` es el de la versión sin comprimir; cada comprimida agrega su codificación ("…-br"), así
 * un caché no confunde una con otra.
 * @typedef {Object} Estatico
 * @property {Buffer} cuerpo
 * @property {string} hash
 * @property {string} etag
 * @property {Map<string, Promise<Buffer>>} comprimidos
 */

/** @returns {Estatico} */
function enMemoria(cuerpo) {
  const hash = hashDe(cuerpo);
  return { cuerpo, hash, etag: `"${hash}"`, comprimidos: new Map() };
}

/** El ETag de `archivo` con `codificacion` (null: sin comprimir). */
export const etagDe = (archivo, codificacion) => (codificacion ? `"${archivo.hash}-${codificacion}"` : archivo.etag);

/**
 * true si If-None-Match nombra a `archivo` en cualquiera de sus codificaciones (comparación débil, RFC 9110 §13.1.2).
 * @param {string | undefined} cabecera
 * @param {Estatico} archivo
 */
export function sigueVigente(cabecera, archivo) {
  if (!cabecera) return false;
  return cabecera.split(",").some((parte) => {
    const etiqueta = parte.trim().replace(/^W\//, "");
    return etiqueta === "*" || etiqueta === archivo.etag || etiqueta.startsWith(`"${archivo.hash}-`);
  });
}

/** El cuerpo de `archivo` con `codificacion` (null: tal cual), comprimido la primera vez que se pide. */
export function cuerpoDe(archivo, codificacion) {
  if (!codificacion) return Promise.resolve(archivo.cuerpo);
  if (!archivo.comprimidos.has(codificacion)) {
    const promesa = comprimir(archivo.cuerpo, codificacion, { estatico: true });
    promesa.catch(() => archivo.comprimidos.delete(codificacion));
    archivo.comprimidos.set(codificacion, promesa);
  }
  return archivo.comprimidos.get(codificacion);
}

// `import … from "./x.js"`, `import "./x.js"` y `export … from "./x.js"`: solo rutas relativas.
const IMPORTACION = /(?:^|[\s;])(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?["'](\.{1,2}\/[^"']+\.js)["']/g;

/** Las rutas relativas que importa un módulo (en el orden en que aparecen). */
export function importsDe(texto) {
  return [...String(texto).matchAll(IMPORTACION)].map((partes) => partes[1]);
}

const MARCA_DE_PRECARGAS = "<!-- precargas: las escribe el servidor (lib/estaticos.js) -->";
const PREFIJO_DE_VERSION = "v";
// Los módulos que la página carga con <script>: no se precargan.
const ENTRADAS = ["precarga.js", "app.js"];
// Las secciones del diccionario que se cargan al empezar (iniciarI18n), en el idioma por defecto.
const SECCIONES_SIEMPRE = ["i18n/en/comun.js", "i18n/en/datos.js"];

const escaparAtributo = (texto) => String(texto).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * @param {string} raiz  la carpeta de los archivos (public/ o portada/)
 */
export function crearEstaticos(raiz) {
  /** @type {Map<string, { firma: string, promesa: Promise<Estatico> }>} */
  const archivos = new Map();

  /**
   * El archivo de `ruta` (absoluta, dentro de la raíz), o null si no existe. Se relee si cambió su fecha o su tamaño.
   * @param {string} ruta
   * @returns {Promise<Estatico | null>}
   */
  async function leer(ruta) {
    const info = await stat(ruta).catch(() => null);
    if (!info?.isFile()) return null;
    const firma = `${info.mtimeMs}:${info.size}`;
    const guardado = archivos.get(ruta);
    if (guardado?.firma === firma) return guardado.promesa;
    const promesa = readFile(ruta).then(enMemoria);
    promesa.catch(() => archivos.delete(ruta));
    archivos.set(ruta, { firma, promesa });
    return promesa;
  }

  const absoluta = (relativa) => path.join(raiz, ...relativa.split("/"));
  const leerRelativa = (relativa) => leer(absoluta(relativa));

  async function relativas() {
    const todas = await readdir(raiz, { recursive: true });
    return todas
      .map((relativa) => relativa.split(path.sep).join("/"))
      .filter((relativa) => !relativa.split("/").some((parte) => parte.startsWith(".")))
      .sort();
  }

  // La versión: un hash de cada ruta con el de su contenido. Se recalcula a lo más cada segundo (y solo relee lo que
  // cambió): así la página de `npm run dev` ve un archivo editado sin reiniciar.
  const version = memorizar(async () => {
    const hash = createHash("sha256");
    for (const relativa of await relativas()) {
      const archivo = await leerRelativa(relativa);
      if (archivo) hash.update(`${relativa} ${archivo.hash}\n`);
    }
    return hash.digest("hex").slice(0, 12);
  }, 1000);

  /** Todo lo que importa `inicio` (relativa a la raíz), sin repetir, `inicio` primero; solo archivos que existen. */
  async function cierre(inicio, vistos = new Set()) {
    if (vistos.has(inicio)) return vistos;
    const archivo = await leerRelativa(inicio);
    if (!archivo) return vistos;
    vistos.add(inicio);
    for (const importada of importsDe(archivo.cuerpo.toString("utf8"))) {
      const destino = path.posix.normalize(path.posix.join(path.posix.dirname(inicio), importada));
      if (!destino.startsWith("../")) await cierre(destino, vistos);
    }
    return vistos;
  }

  /** index.html con las URL bajo v/<versión>/ y las precargas, armado una vez por versión. */
  async function armarPagina(actual) {
    const original = await leerRelativa("index.html");
    if (!original) return null;
    const prefijo = `${PREFIJO_DE_VERSION}/${actual}/`;
    // Primero lo que importa precarga.js (así empieza antes), después lo demás de app.js.
    const deApp = await cierre("app.js", await cierre("precarga.js"));
    const existe = async (relativa) => (await leerRelativa(relativa)) !== null;
    const comunes = [...[...deApp].filter((relativa) => !ENTRADAS.includes(relativa)), ...SECCIONES_SIEMPRE];
    const enlaces = [];
    for (const relativa of comunes) {
      if (await existe(relativa)) enlaces.push(`<link rel="modulepreload" href="${escaparAtributo(prefijo + relativa)}">`);
    }
    const pantallas = (await relativas()).filter((relativa) => /^pantallas\/[a-z0-9-]+\.js$/.test(relativa));
    for (const pantalla of pantallas) {
      const id = path.posix.basename(pantalla, ".js");
      const propios = [...(await cierre(pantalla))].filter((relativa) => !deApp.has(relativa));
      for (const extra of [`i18n/en/${id}.js`, `estilos/${id}.css`]) if (await existe(extra)) propios.push(extra);
      const contenido = propios.map((relativa) => prefijo + relativa).join(" ");
      enlaces.push(`<meta name="precarga:${id}" content="${escaparAtributo(contenido)}">`);
    }
    const texto = original.cuerpo
      .toString("utf8")
      // Lo propio de la página (relativo, sin esquema): bajo la versión.
      .replace(/\b(href|src)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+)"/gi, (_, atributo, valor) => `${atributo}="${prefijo}${valor}"`)
      .replace(MARCA_DE_PRECARGAS, enlaces.join("\n  "));
    return enMemoria(Buffer.from(texto, "utf8"));
  }

  let pagina = { version: null, promesa: null };

  return {
    leer,

    /** La versión actual de los archivos (12 caracteres hex). */
    version: () => version(),

    /** Cierre de imports de un módulo (relativo a la raíz). Para pruebas y para la página. */
    cierre: async (inicio) => [...(await cierre(inicio))],

    /**
     * index.html listo para servir, con su versión: las URL propias bajo v/<versión>/ y las precargas.
     * @returns {Promise<{ version: string, archivo: Estatico | null }>}
     */
    async pagina() {
      const actual = await version();
      if (pagina.version !== actual) {
        const promesa = armarPagina(actual);
        promesa.catch(() => {
          if (pagina.promesa === promesa) pagina = { version: null, promesa: null };
        });
        pagina = { version: actual, promesa };
      }
      return { version: actual, archivo: await pagina.promesa };
    },

    /**
     * Lee y comprime de antemano lo que se puede comprimir (al arrancar, para que el primer pedido no espere el brotli
     * de three.js). Nunca lanza.
     * @param {(relativa: string) => string} tipoDe  el Content-Type de cada archivo
     */
    async calentar(tipoDe) {
      try {
        await this.pagina();
        for (const relativa of await relativas()) {
          const archivo = await leerRelativa(relativa);
          if (!archivo || !esComprimible(tipoDe(relativa)) || archivo.cuerpo.length < MINIMO_PARA_COMPRIMIR) continue;
          await Promise.all([cuerpoDe(archivo, "br"), cuerpoDe(archivo, "gzip")]);
        }
      } catch (error) {
        console.error("estaticos: no se pudieron preparar los archivos comprimidos.", error);
      }
    },
  };
}

export { MARCA_DE_PRECARGAS, PREFIJO_DE_VERSION };
