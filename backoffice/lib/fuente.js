// Fuente de corridas: de dónde lee el backoffice las tandas. La del sistema de archivos (agents/.runs/) y la de S3
// (el mismo árbol en un bucket) implementan esta interfaz, así derivar.js, la API y la página no saben de dónde leen.
//
// Una fuente no valida nada: lib/tandas.js solo le pide ids que ella misma listó y nombres de perfil y
// de archivo que ya pasaron por NOMBRE_SEGURO y ARCHIVO_DE_PERFIL; lib/indice.js y lib/panel.js, claves que ella
// listó con listarCorridas o run_key de la tabla que pasaron por partesDeCorrida con el rol y el goal esperados.

import { crearFuenteDeArchivos } from "./fuentes/archivos.js";
import { crearFuenteS3, parsearAlmacen } from "./fuentes/s3.js";

/**
 * @typedef {Object} RangoPedido      Rango de bytes como en HTTP: { inicio, fin } incluye ambos extremos;
 *                                    sin fin, hasta el final; sin inicio, los últimos `fin` bytes.
 * @property {number} [inicio]
 * @property {number} [fin]
 *
 * @typedef {Object} ArchivoAbierto
 * @property {import("node:stream").Readable | null} cuerpo   null si el rango pedido no se puede servir (416)
 * @property {number} tamano                                  tamaño total del archivo, en bytes
 * @property {{ inicio: number, fin: number } | null} rango   el rango que trae `cuerpo`, o null si es el archivo entero
 *
 * @typedef {Object} Fuente
 * @property {string} descripcion     para el estado vacío: "agents/.runs" (relativa al repo) o una URI
 * @property {() => Promise<string[]>} listarIds
 *           ids de tanda "<host>/visitor/<objetivo>/<corrida>" que terminaron bien (manifest.json succeeded) y tienen
 *           route_tree.json, en cualquier orden
 * @property {() => Promise<string[]>} listarCorridas
 *           claves de las corridas de los cuatro roles del Overview, terminadas o no, en cualquier orden (ya validadas
 *           con partesDeCorrida; lib/fuentes/corridas.js): "<host>/cataloger/<corrida>",
 *           "<host>/guide/<goal>/<viewport>/<corrida>", "<host>/visitor/<goal>/<corrida>", "<host>/improver/<corrida>"
 * @property {(id: string) => Promise<string[]>} listarPerfiles
 *           subcarpetas de una tanda o de cualquier corrida (nombres sin validar)
 * @property {(id: string, relativa: string) => Promise<object | null>} leerJson
 *           "route_tree.json", "desktop/run.json"; null si no existe o no es JSON. `id` puede ser la clave de una
 *           corrida de cualquier agente ("<host>/cataloger/<corrida>", "goals.json")
 * @property {(id: string, relativa: string) => Promise<{ datos: object | null, estado: "ok" | "falta" | "danado" }>} leerJsonDetallado
 *           como leerJson, pero dice si el archivo falta o está dañado (no es JSON); avisa en la consola de un dañado
 * @property {(id: string, relativa: string) => Promise<string | null>} leerTexto
 *           un archivo de texto de una corrida ("tema.css" del improver), o null si no existe
 * @property {(id: string, relativa: string) => Promise<boolean>} existe
 *           "desktop/video.webm"
 * @property {(id: string, relativa: string, rango?: RangoPedido) => Promise<ArchivoAbierto | null>} abrirArchivo
 *           null si no existe
 * @property {(id: string, relativa: string, cabeceras: { tipo?: string, cache?: string }) => Promise<string>} [urlDeDescarga]
 *           solo S3: una URL firmada para bajar el archivo directo del almacén, que responde con ese Content-Type y
 *           Cache-Control (no mira si existe)
 * @property {string} [origenDeDescargas]  el origen de esas URLs ("https://<bucket>.s3.<region>.amazonaws.com"), para la CSP
 */

/**
 * La fuente configurada. `tipo` sale de BACKOFFICE_FUENTE: "archivos" (`raiz`) o "s3" (`almacen`, "s3://bucket/prefijo",
 * y `s3`, el cliente, los comandos y, para las descargas firmadas, `firmar` y `region` de lib/aws.js).
 * @param {{ tipo?: string, raiz?: string, almacen?: string,
 *           s3?: { cliente: object, comandos: object, firmar?: Function, region?: string } }} [opciones]
 * @returns {Fuente}
 */
export function crearFuente({ tipo = process.env.BACKOFFICE_FUENTE ?? "archivos", raiz, almacen, s3 } = {}) {
  if (tipo === "archivos") return crearFuenteDeArchivos({ raiz });
  if (tipo === "s3") {
    if (!s3) throw new Error("La fuente s3 necesita el cliente de S3 (lib/aws.js)");
    return crearFuenteS3({ ...parsearAlmacen(almacen), ...s3 });
  }
  throw new Error(`Fuente desconocida: ${tipo}`);
}
