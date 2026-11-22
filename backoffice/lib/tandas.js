// Lectura de tandas a través de una fuente de corridas (lib/fuente.js). Aquí se valida todo lo que
// llega desde afuera: un id solo vale si la fuente lo listó, y de un perfil solo se sirven capturas y video.

import { ARCHIVO_DANADO, armarTanda, resumirTanda } from "./derivar.js";
import { crearFuenteDeArchivos } from "./fuentes/archivos.js";
import { AGENTE, partesDeTanda } from "../public/nucleo/almacen.js";

const NOMBRE_SEGURO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
// Solo estos archivos de un perfil se sirven al navegador.
export const ARCHIVO_DE_PERFIL = /^(step_\d{2,3}\.png|video\.webm)$/;
// El orden de los perfiles en el Visitante: first_time, hurried, mobile; los demás, por nombre.
const ORDEN_DE_PERFILES = ["first_time", "hurried", "mobile"];

/** @typedef {import("./fuente.js").Fuente} Fuente */

/** Acepta una fuente o, por comodidad, la ruta de una carpeta de corridas. */
const comoFuente = (fuente) => (typeof fuente === "string" ? crearFuenteDeArchivos({ raiz: fuente }) : fuente);

const esIdValido = (id) => partesDeTanda(id) !== null;

const fechaDe = (id) => partesDeTanda(id).corrida;
const tareaDe = (id) => {
  const { host, objetivo } = partesDeTanda(id);
  return `${host}/${AGENTE}/${objetivo}`;
};

/**
 * Ids de las tandas, de la más nueva a la más vieja: "wom.cl/visitor/baja-fibra/2026-11-21T07-16-33Z".
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

/** Lee un JSON diciendo si falta o está dañado (con una fuente que no lo distingue, un null es que falta). */
async function leerDetallado(fuente, id, relativa) {
  if (fuente.leerJsonDetallado) return fuente.leerJsonDetallado(id, relativa);
  const datos = await fuente.leerJson(id, relativa);
  return { datos, estado: datos ? "ok" : "falta" };
}

/**
 * El intento de un run.json que no se puede leer: queda como error de la herramienta («archivo dañado») en vez de
 * desaparecer de la tanda (que mostraría 7 de 8 exploradores sin decirlo).
 */
const runDanado = (perfil) => ({ profile: perfil, end_reason: ARCHIVO_DANADO, final_message: `${perfil}/run.json no es JSON válido`, steps: [] });

async function leerSinVecinas(fuente, id) {
  const [arbol, criterio] = await Promise.all([
    leerDetallado(fuente, id, "route_tree.json"),
    fuente.leerJson(id, "criteria.json"),
  ]);
  const perfiles = (await fuente.listarPerfiles(id)).filter((perfil) => NOMBRE_SEGURO.test(perfil));
  const intentos = [];
  for (const perfil of perfiles) {
    // Sin run.json (todavía no termina): no es un intento. Con un run.json dañado: un intento con error.
    const { datos: run, estado } = await leerDetallado(fuente, id, `${perfil}/run.json`);
    if (estado === "danado") intentos.push({ perfil, run: runDanado(perfil), video: false });
    if (!run) continue;
    intentos.push({ perfil, run, video: await fuente.existe(id, `${perfil}/video.webm`) });
  }
  const posicion = (perfil) =>
    ORDEN_DE_PERFILES.includes(perfil) ? ORDEN_DE_PERFILES.indexOf(perfil) : ORDEN_DE_PERFILES.length;
  intentos.sort((a, b) => posicion(a.perfil) - posicion(b.perfil) || (a.perfil < b.perfil ? -1 : 1));
  return armarTanda({ id, arbol: arbol.datos, criterio, intentos, estadoDelArbol: arbol.estado });
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
