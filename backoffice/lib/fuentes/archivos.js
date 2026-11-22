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

// Archivos dañados ya avisados en la consola (una línea por archivo y versión, no una por pedido).
const avisados = new Set();

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
      // Una tanda tiene route_tree.json; si aún no (el evaluador lo escribe al final, o se cortó), basta con que
      // algún intento tenga su run.json: se lista como incompleta en vez de desaparecer.
      const esTanda = async (carpeta) =>
        existsSync(path.join(carpeta, "route_tree.json")) ||
        (await subcarpetas(carpeta)).some((perfil) => existsSync(path.join(carpeta, perfil, "run.json")));
      const ids = [];
      for (const nombre of await subcarpetas(base)) {
        if (nombre === CARPETA_DE_ARCHIVO) continue;
        if (NOMBRE_DE_TANDA.test(nombre)) {
          if (await esTanda(path.join(base, nombre))) ids.push(nombre);
          continue;
        }
        for (const fecha of await subcarpetas(path.join(base, nombre))) {
          if (NOMBRE_DE_TANDA.test(fecha) && (await esTanda(path.join(base, nombre, fecha)))) ids.push(`${nombre}/${fecha}`);
        }
      }
      return ids;
    },

    listarPerfiles: (id) => subcarpetas(rutaDe(id)),

    async leerJson(id, relativa) {
      return (await this.leerJsonDetallado(id, relativa)).datos;
    },

    async leerJsonDetallado(id, relativa) {
      const ruta = rutaDe(id, relativa);
      let texto;
      try {
        texto = await readFile(ruta, "utf8");
      } catch {
        return { datos: null, estado: "falta" };
      }
      try {
        return { datos: JSON.parse(texto), estado: "ok" };
      } catch (error) {
        const clave = `${ruta}:${texto.length}`;
        if (!avisados.has(clave)) {
          avisados.add(clave);
          console.error(`corridas: «${describirCarpeta(ruta)}» está dañado (no es JSON válido: ${error.message}).`);
        }
        return { datos: null, estado: "danado" };
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
