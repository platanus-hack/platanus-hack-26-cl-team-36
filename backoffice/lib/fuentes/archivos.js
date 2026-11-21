// Fuente de corridas en el sistema de archivos: una carpeta con <tarea>/<fecha-hora>/ (o <fecha-hora>/)
// por tanda, cada una con route_tree.json, criteria.json y una carpeta por perfil.
//
// La carpeta `archivo/` de la raíz guarda tandas viejas que ya no se muestran (por ejemplo
// archivo/2026-11-21-4-exploradores/<tarea>/<fecha-hora>/): nunca se lista. Para verlas, se apunta
// BACKOFFICE_CORRIDAS a una de sus subcarpetas.

import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOMBRE_DE_TANDA = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
export const CARPETA_DE_ARCHIVO = "archivo";
const RAIZ_DEL_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RAIZ_POR_DEFECTO = path.join(RAIZ_DEL_REPO, "agents", ".runs");

async function subcarpetas(carpeta) {
  try {
    const entradas = await readdir(carpeta, { withFileTypes: true });
    return entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name);
  } catch {
    return [];
  }
}

/** La carpeta relativa a la raíz del repo si está dentro de él; si no, absoluta. */
export function describirCarpeta(raiz) {
  const relativa = path.relative(RAIZ_DEL_REPO, raiz);
  return relativa && !relativa.startsWith("..") && !path.isAbsolute(relativa)
    ? relativa.split(path.sep).join("/")
    : raiz;
}

/**
 * @param {{ raiz?: string }} [opciones]
 * @returns {import("../fuente.js").Fuente}
 */
export function crearFuenteDeArchivos({ raiz = RAIZ_POR_DEFECTO } = {}) {
  const base = path.resolve(raiz);
  const rutaDe = (id, relativa = "") => path.join(base, ...id.split("/"), ...relativa.split("/").filter(Boolean));

  return {
    descripcion: describirCarpeta(base),

    async listarIds() {
      const ids = [];
      for (const nombre of await subcarpetas(base)) {
        if (nombre === CARPETA_DE_ARCHIVO) continue;
        if (NOMBRE_DE_TANDA.test(nombre)) {
          if (existsSync(path.join(base, nombre, "route_tree.json"))) ids.push(nombre);
          continue;
        }
        for (const fecha of await subcarpetas(path.join(base, nombre))) {
          if (NOMBRE_DE_TANDA.test(fecha) && existsSync(path.join(base, nombre, fecha, "route_tree.json"))) {
            ids.push(`${nombre}/${fecha}`);
          }
        }
      }
      return ids;
    },

    listarPerfiles: (id) => subcarpetas(rutaDe(id)),

    async leerJson(id, relativa) {
      try {
        return JSON.parse(await readFile(rutaDe(id, relativa), "utf8"));
      } catch {
        return null;
      }
    },

    async existe(id, relativa) {
      try {
        return (await stat(rutaDe(id, relativa))).isFile();
      } catch {
        return false;
      }
    },

    async abrirArchivo(id, relativa, rango) {
      const ruta = rutaDe(id, relativa);
      let tamano;
      try {
        const info = await stat(ruta);
        if (!info.isFile()) return null;
        tamano = info.size;
      } catch {
        return null;
      }
      if (!rango || (rango.inicio === undefined && rango.fin === undefined)) {
        return { cuerpo: createReadStream(ruta), tamano, rango: null };
      }
      const inicio = rango.inicio !== undefined ? rango.inicio : Math.max(0, tamano - rango.fin);
      const fin = rango.inicio !== undefined && rango.fin !== undefined ? Math.min(rango.fin, tamano - 1) : tamano - 1;
      if (inicio > fin || inicio >= tamano) return { cuerpo: null, tamano, rango: null };
      return { cuerpo: createReadStream(ruta, { start: inicio, end: fin }), tamano, rango: { inicio, fin } };
    },
  };
}
