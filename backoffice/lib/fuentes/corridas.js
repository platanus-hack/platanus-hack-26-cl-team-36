// Las corridas de todos los agentes del Overview en el layout del almacén (public/nucleo/almacen.js), igual en todas
// las fuentes: cada una pone solo cómo se listan las subcarpetas de una carpeta (readdir o ListObjectsV2 con "/").
//
//   <host>/cataloger/<corrida>/                   <host>/improver/<corrida>/
//   <host>/guide/<goal>/<viewport>/<corrida>/     <host>/visitor/<goal>/<corrida>/
//
// Solo baja por nombres que calzan con el layout (HOST, OBJETIVO, VIEWPORT, CORRIDA) y devuelve claves que
// partesDeCorrida acepta: nada de lo que llega de la fuente sale sin validar.

import { CORRIDA, HOST, OBJETIVO, VIEWPORT, partesDeCorrida } from "../../public/nucleo/almacen.js";

/** Los roles del Overview, en el orden del pipeline. */
export const ROLES = ["cataloger", "guide", "visitor", "improver"];

// Los niveles entre el agente y la corrida (los mismos que PROFUNDIDAD en almacen.js).
const NIVELES = { cataloger: [], guide: [OBJETIVO, VIEWPORT], visitor: [OBJETIVO], improver: [] };

/**
 * Claves de corrida ("wom.cl/guide/baja-fibra/desktop/2026-11-21T10-05-00Z") de los cuatro roles, en cualquier orden.
 * @param {(carpeta: string) => Promise<string[]>} subcarpetas  nombres de las subcarpetas de una carpeta relativa a
 *        la raíz del almacén ("" es la raíz); [] si no existe
 * @returns {Promise<string[]>}
 */
export async function listarCorridasCon(subcarpetas) {
  async function bajar(carpeta, niveles) {
    const nombres = await subcarpetas(carpeta);
    if (!niveles.length) return nombres.filter((nombre) => CORRIDA.test(nombre)).map((nombre) => `${carpeta}/${nombre}`);
    const [patron, ...resto] = niveles;
    const hijas = await Promise.all(nombres.filter((nombre) => patron.test(nombre)).map((nombre) => bajar(`${carpeta}/${nombre}`, resto)));
    return hijas.flat();
  }
  const hosts = (await subcarpetas("")).filter((nombre) => HOST.test(nombre));
  const porHost = await Promise.all(
    hosts.map(async (host) => {
      const agentes = new Set(await subcarpetas(host));
      const porRol = await Promise.all(ROLES.filter((rol) => agentes.has(rol)).map((rol) => bajar(`${host}/${rol}`, NIVELES[rol])));
      return porRol.flat();
    }),
  );
  return porHost.flat().filter((clave) => partesDeCorrida(clave) !== null);
}
