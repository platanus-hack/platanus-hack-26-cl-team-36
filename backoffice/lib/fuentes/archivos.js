// Fuente de corridas en el sistema de archivos (layout en public/nucleo/almacen.js): cada tanda es una corrida
// del Visitante que terminó bien, con route_tree.json, criteria.json y una carpeta por perfil.

import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTE, CORRIDA, HOST, MANIFIESTO, OBJETIVO, idDeTanda } from "../../public/nucleo/almacen.js";
import { resolverRango } from "./rango.js";

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

  // Una corrida en curso, abandonada o fallida no es una tanda.
  const terminoBien = async (id) => {
    try {
      return JSON.parse(await readFile(rutaDe(id, MANIFIESTO), "utf8")).status === "succeeded";
    } catch {
      return false;
    }
  };

  return {
    descripcion: describirCarpeta(base),

    async listarIds() {
      const ids = [];
      for (const host of (await subcarpetas(base)).filter((nombre) => HOST.test(nombre))) {
        for (const objetivo of (await subcarpetas(path.join(base, host, AGENTE))).filter((nombre) => OBJETIVO.test(nombre))) {
          for (const corrida of await subcarpetas(path.join(base, host, AGENTE, objetivo))) {
            const id = idDeTanda(host, objetivo, corrida);
            if (CORRIDA.test(corrida) && existsSync(rutaDe(id, "route_tree.json")) && (await terminoBien(id))) ids.push(id);
          }
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
      const servido = resolverRango(rango, tamano);
      if (servido === undefined) return { cuerpo: createReadStream(ruta), tamano, rango: null };
      if (servido === null) return { cuerpo: null, tamano, rango: null };
      return { cuerpo: createReadStream(ruta, { start: servido.inicio, end: servido.fin }), tamano, rango: servido };
    },
  };
}
