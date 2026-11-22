// Un almacén en memoria con la interfaz Fuente completa (lib/fuente.js), para probar el Overview sin disco ni red:
// { "<clave de corrida>/<relativa>": string | Buffer }. Cuenta lo que se lee, para probar la caché.

import { Readable } from "node:stream";
import { listarCorridasCon } from "../lib/fuentes/corridas.js";
import { partesDeTanda } from "../public/nucleo/almacen.js";

/**
 * @param {Record<string, string | Buffer>} [inicial]
 */
export function almacenEnMemoria(inicial = {}) {
  const archivos = new Map(Object.entries(inicial));
  const lecturas = [];
  let arbol = null;

  // carpeta → nombres de sus subcarpetas (se rehace al escribir o borrar).
  function subcarpetas(carpeta) {
    if (!arbol) {
      arbol = new Map();
      for (const ruta of archivos.keys()) {
        const partes = ruta.split("/");
        for (let i = 0; i < partes.length - 1; i += 1) {
          const padre = partes.slice(0, i).join("/");
          if (!arbol.has(padre)) arbol.set(padre, new Set());
          arbol.get(padre).add(partes[i]);
        }
      }
    }
    return [...(arbol.get(carpeta) ?? [])];
  }
  const leer = (ruta) => {
    lecturas.push(ruta);
    return archivos.get(ruta);
  };
  const json = (ruta) => {
    const valor = leer(ruta);
    if (valor === undefined) return { datos: null, estado: "falta" };
    try {
      return { datos: JSON.parse(String(valor)), estado: "ok" };
    } catch {
      return { datos: null, estado: "danado" };
    }
  };
  const tieneArchivo = (ruta) => archivos.has(ruta);
  const listarCorridas = () => listarCorridasCon(async (carpeta) => subcarpetas(carpeta));

  return {
    descripcion: "memoria://almacen",
    lecturas,
    escribir(ruta, contenido) {
      archivos.set(ruta, typeof contenido === "string" || Buffer.isBuffer(contenido) ? contenido : JSON.stringify(contenido));
      arbol = null;
    },
    borrar(ruta) {
      archivos.delete(ruta);
      arbol = null;
    },

    async listarIds() {
      const ids = [];
      for (const clave of await listarCorridas()) {
        if (!partesDeTanda(clave) || !tieneArchivo(`${clave}/route_tree.json`)) continue;
        if (json(`${clave}/manifest.json`).datos?.status === "succeeded") ids.push(clave);
      }
      return ids;
    },
    listarCorridas,
    listarPerfiles: async (id) => subcarpetas(id),
    leerJson: async (id, relativa) => json(`${id}/${relativa}`).datos,
    leerJsonDetallado: async (id, relativa) => json(`${id}/${relativa}`),
    async leerTexto(id, relativa) {
      const valor = leer(`${id}/${relativa}`);
      return valor === undefined ? null : String(valor);
    },
    existe: async (id, relativa) => tieneArchivo(`${id}/${relativa}`),
    async abrirArchivo(id, relativa) {
      const valor = archivos.get(`${id}/${relativa}`);
      if (valor === undefined) return null;
      const bytes = Buffer.from(valor);
      return { cuerpo: Readable.from([bytes]), tamano: bytes.length, rango: null };
    },
  };
}

/** Un almacén chico con corridas de todos los roles y nombres que no calzan con el layout (fuente.test.js, fuente-s3). */
export const CORRIDAS_DE_EJEMPLO = {
  "demo.cl/cataloger/2026-11-21T09-00-00Z/manifest.json": JSON.stringify({ agent: "cataloger", status: "succeeded" }),
  "demo.cl/cataloger/2026-11-21T09-00-00Z/goals.json": JSON.stringify({ goals: [{ id: "tarea-demo" }] }),
  "demo.cl/cataloger/no-es-corrida/manifest.json": "{}",
  "demo.cl/guide/tarea-demo/desktop/2026-11-21T09-10-00Z/manifest.json": JSON.stringify({ status: "failed" }),
  "demo.cl/guide/tarea-demo/mobile/2026-11-21T09-11-00Z/manifest.json": JSON.stringify({ status: "running" }),
  "demo.cl/guide/tarea-demo/tablet/2026-11-21T09-12-00Z/manifest.json": "{}",
  "demo.cl/guide/Tarea_Mala/desktop/2026-11-21T09-13-00Z/manifest.json": "{}",
  "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z/manifest.json": JSON.stringify({ status: "succeeded" }),
  "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z/desktop/run.json": JSON.stringify({ viewport: "1024x768" }),
  "demo.cl/improver/2026-11-21T14-00-00Z/manifest.json": JSON.stringify({ agent: "improver", status: "succeeded" }),
  "demo.cl/improver/2026-11-21T14-00-00Z/tema.css": "html.mi-tema { --mi-acento: #ABC; }",
  "demo.cl/improver/2026-11-21T15-00-00Z/manifest.json": JSON.stringify({ agent: "improver", status: "running" }),
  "demo.cl/summary/2026-11-21T15-00-00Z/manifest.json": "{}",
  "localhost:8080/cataloger/2026-11-21T09-00-00Z/manifest.json": "{}",
  "Mayus.cl/cataloger/2026-11-21T09-00-00Z/manifest.json": "{}",
  "otro_/cataloger/2026-11-21T09-00-00Z/manifest.json": "{}",
};

/** Las claves que listarCorridas() tiene que devolver de CORRIDAS_DE_EJEMPLO (ordenadas). */
export const CLAVES_DE_EJEMPLO = [
  "demo.cl/cataloger/2026-11-21T09-00-00Z",
  "demo.cl/guide/tarea-demo/desktop/2026-11-21T09-10-00Z",
  "demo.cl/guide/tarea-demo/mobile/2026-11-21T09-11-00Z",
  "demo.cl/improver/2026-11-21T14-00-00Z",
  "demo.cl/improver/2026-11-21T15-00-00Z",
  "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z",
  "localhost:8080/cataloger/2026-11-21T09-00-00Z",
];
