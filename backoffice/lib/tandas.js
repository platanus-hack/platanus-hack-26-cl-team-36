// Lectura de tandas a través de una fuente de corridas (lib/fuente.js). Aquí se valida todo lo que
// llega desde afuera: un id solo vale si la fuente lo listó, y de un perfil solo se sirven capturas y video.

import { armarTanda, resumirTanda } from "./derivar.js";
import { crearFuenteDeArchivos } from "./fuentes/archivos.js";

const NOMBRE_DE_TANDA = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
const NOMBRE_SEGURO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
// Solo estos archivos de un perfil se sirven al navegador.
export const ARCHIVO_DE_PERFIL = /^(step_\d{2,3}\.png|video\.webm)$/;
// El orden de los perfiles en el evaluador: first_time, hurried, mobile; los demás, por nombre.
const ORDEN_DE_PERFILES = ["first_time", "hurried", "mobile"];

/** @typedef {import("./fuente.js").Fuente} Fuente */

/** Acepta una fuente o, por comodidad, la ruta de una carpeta de corridas. */
const comoFuente = (fuente) => (typeof fuente === "string" ? crearFuenteDeArchivos({ raiz: fuente }) : fuente);

const esIdValido = (id) => {
  const partes = String(id).split("/");
  if (partes.length === 1) return NOMBRE_DE_TANDA.test(partes[0]);
  return partes.length === 2 && NOMBRE_SEGURO.test(partes[0]) && NOMBRE_DE_TANDA.test(partes[1]);
};

const fechaDe = (id) => id.split("/").at(-1);
const tareaDe = (id) => (id.includes("/") ? id.split("/")[0] : null);

/**
 * Ids de las tandas, de la más nueva a la más vieja: "wom-baja-fibra/2026-11-21_07-16-33".
 * @param {Fuente | string} fuente
 */
export async function idsDeTandas(fuente) {
  const ids = (await comoFuente(fuente).listarIds()).filter(esIdValido);
  return [...new Set(ids)].sort((a, b) =>
    fechaDe(a) < fechaDe(b) ? 1 : fechaDe(a) > fechaDe(b) ? -1 : a < b ? -1 : a > b ? 1 : 0,
  );
}

/** Tandas vecinas en la lista global (de la más nueva a la más vieja) y las otras de la misma tarea. */
export function vecinasDe(id, ids) {
  const posicion = ids.indexOf(id);
  const tarea = tareaDe(id);
  return {
    anterior: posicion >= 0 ? (ids[posicion + 1] ?? null) : null,
    siguiente: posicion > 0 ? ids[posicion - 1] : null,
    mismaTarea: tarea
      ? ids.filter((otro) => otro !== id && tareaDe(otro) === tarea).map((otro) => ({ id: otro, fecha: fechaDe(otro) }))
      : [],
  };
}

async function leerSinVecinas(fuente, id) {
  const [arbol, criterio] = await Promise.all([
    fuente.leerJson(id, "route_tree.json"),
    fuente.leerJson(id, "criteria.json"),
  ]);
  const perfiles = (await fuente.listarPerfiles(id)).filter((perfil) => NOMBRE_SEGURO.test(perfil));
  const intentos = [];
  for (const perfil of perfiles) {
    const run = await fuente.leerJson(id, `${perfil}/run.json`);
    if (!run) continue;
    intentos.push({ perfil, run, video: await fuente.existe(id, `${perfil}/video.webm`) });
  }
  const posicion = (perfil) =>
    ORDEN_DE_PERFILES.includes(perfil) ? ORDEN_DE_PERFILES.indexOf(perfil) : ORDEN_DE_PERFILES.length;
  intentos.sort((a, b) => posicion(a.perfil) - posicion(b.perfil) || (a.perfil < b.perfil ? -1 : 1));
  return armarTanda({ id, arbol, criterio, intentos });
}

/**
 * La tanda completa, o null si el id no es una tanda que la fuente conoce.
 * @param {Fuente | string} fuente
 * @param {string} id
 */
export async function leerTanda(fuente, id) {
  const origen = comoFuente(fuente);
  const ids = await idsDeTandas(origen);
  if (!ids.includes(id)) return null;
  const tanda = await leerSinVecinas(origen, id);
  return { ...tanda, vecinas: vecinasDe(id, ids) };
}

/**
 * Lo que devuelve GET /api/tandas.
 * @param {Fuente | string} fuente
 * @returns {Promise<{ carpeta: string, tandas: object[] }>}
 */
export async function listarTandas(fuente) {
  const origen = comoFuente(fuente);
  const tandas = [];
  for (const id of await idsDeTandas(origen)) {
    // Una tanda que no se puede leer (un run.json a medio escribir, una forma inesperada) no tumba la lista.
    try {
      tandas.push(resumirTanda(await leerSinVecinas(origen, id)));
    } catch (error) {
      console.error(`tandas: no se pudo leer «${id}»; se omite de la lista.`, error);
    }
  }
  return { carpeta: origen.descripcion, tandas };
}

/**
 * Abre una captura o el video de un perfil, o null si lo pedido no es un archivo servible de una tanda.
 * @param {Fuente | string} fuente
 * @param {{ id: string, perfil: string, archivo: string, rango?: import("./fuente.js").RangoPedido }} pedido
 */
export async function abrirArchivoDeIntento(fuente, { id, perfil, archivo, rango }) {
  if (!NOMBRE_SEGURO.test(perfil) || !ARCHIVO_DE_PERFIL.test(archivo)) return null;
  const origen = comoFuente(fuente);
  if (!(await idsDeTandas(origen)).includes(id)) return null;
  return origen.abrirArchivo(id, `${perfil}/${archivo}`, rango);
}
