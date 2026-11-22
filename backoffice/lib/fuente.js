// Fuente de corridas: de dónde lee el backoffice las tandas. Hoy solo existe la del sistema de archivos
// (agents/.runs/); esta interfaz es la costura para agregar otra (por ejemplo S3) sin tocar derivar.js,
// la API ni la página. Ver §4.5 del diseño para lo que necesitaría una fuente S3.
//
// Una fuente no valida nada: lib/tandas.js solo le pide ids que ella misma listó y nombres de perfil y
// de archivo que ya pasaron por NOMBRE_SEGURO y ARCHIVO_DE_PERFIL.

import { crearFuenteDeArchivos } from "./fuentes/archivos.js";

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
 *           ids de tanda "<host>/visitor/<objetivo>/<corrida>" que tienen route_tree.json, en cualquier orden
 * @property {(id: string) => Promise<string[]>} listarPerfiles
 *           subcarpetas de una tanda (nombres sin validar)
 * @property {(id: string, relativa: string) => Promise<object | null>} leerJson
 *           "route_tree.json", "first_time/run.json"; null si no existe o no es JSON
 * @property {(id: string, relativa: string) => Promise<{ datos: object | null, estado: "ok" | "falta" | "danado" }>} leerJsonDetallado
 *           como leerJson, pero dice si el archivo falta o está dañado (no es JSON); avisa en la consola de un dañado
 * @property {(id: string, relativa: string) => Promise<boolean>} existe
 *           "first_time/video.webm"
 * @property {(id: string, relativa: string, rango?: RangoPedido) => Promise<ArchivoAbierto | null>} abrirArchivo
 *           null si no existe
 */

/**
 * La fuente configurada. `tipo` sale de BACKOFFICE_FUENTE; por ahora solo "archivos".
 * @param {{ tipo?: string, raiz?: string }} [opciones]
 * @returns {Fuente}
 */
export function crearFuente({ tipo = process.env.BACKOFFICE_FUENTE ?? "archivos", raiz } = {}) {
  if (tipo === "archivos") return crearFuenteDeArchivos({ raiz });
  throw new Error(`Fuente desconocida: ${tipo}`);
}
