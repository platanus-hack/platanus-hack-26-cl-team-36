// Índice del almacén para el Overview: las corridas de los cuatro roles (Fuente.listarCorridas) con el estado de su
// manifest.json y, de cada tanda del Visitante, sus intentos (lib/clasificar.js: run.json, o trace.json si la tanda
// todavía corre).
//
// Caché: lo cerrado se lee una sola vez y lo en curso se vuelve a leer en cada pasada.
// - El almacén entero se vuelve a listar (Fuente.listarCorridas) a lo más cada LISTADO_MS, para encontrar corridas
//   nuevas; entre listados, cada pasada usa las claves ya conocidas.
// - Una corrida cuyo manifest dice succeeded o failed no cambia más: se guarda entera (en el Visitante, con sus
//   intentos y si se lista), así la siguiente pasada no la vuelve a leer.
// - Un run.json bien leído tampoco cambia (el Visitante lo sube una vez, al terminar el intento): en una tanda que
//   todavía corre se guarda por carpeta y solo se miran las carpetas nuevas o sin run.json.
// - Lo demás (manifest running o ilegible, trace.json, run.json dañado o que falta) se vuelve a leer.
// La fuente solo recibe claves que ella misma listó (ya validadas con partesDeCorrida) o que validó quien llama, y
// carpetas de intento que pasan CARPETA.

import { partesDeCorrida } from "../public/nucleo/almacen.js";
import { intentoDelVisitante } from "./clasificar.js";

/**
 * Cada cuánto se vuelve a listar el almacén entero para encontrar corridas nuevas (en S3, unos 200 LIST con el volumen
 * del mock, cuando la página refresca cada 5 s). Una corrida nueva aparece a lo más en este plazo; lo que ya se conoce y
 * está abierto (running o sin manifest legible) se relee en cada pasada, así una corrida que termina se ve terminada en
 * la pasada siguiente. Una run_key que la tabla nombra antes del listado se lee igual por su clave (corrida()).
 */
export const LISTADO_MS = 30_000;

const CERRADA = new Set(["succeeded", "failed"]);
// Los mismos nombres de carpeta que acepta lib/tandas.js (NOMBRE_SEGURO).
const CARPETA = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
// Lecturas a la vez contra la fuente (en S3, pedidos en vuelo).
const EN_PARALELO = 24;

/**
 * @typedef {Object} CorridaDelIndice
 * @property {string} clave            "<host>/<rol>/…/<corrida>"
 * @property {"cataloger" | "guide" | "visitor" | "improver"} rol
 * @property {string} host             el del almacén (sin www.)
 * @property {string | null} goal
 * @property {string} corrida          el id de la corrida ("2026-11-21T10-00-00Z")
 * @property {string | null} status    manifest.status, o null si no hay manifest legible
 * @property {import("./clasificar.js").IntentoDelIndice[] | null} intentos   solo del Visitante, por carpeta
 * @property {boolean} listada         tanda del Visitante que idsDeTandas lista (la regla de Fuente.listarIds: terminó
 *                                     bien y tiene route_tree.json), o sea, que /archivos/ sirve
 */

/** Aplica `fn` a cada elemento con a lo más `limite` llamadas a la vez; conserva el orden. */
export async function mapearEnParalelo(elementos, limite, fn) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  const trabajar = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      resultados[i] = await fn(elementos[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajar));
  return resultados;
}

const esObjeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

/**
 * @param {import("./fuente.js").Fuente} fuente
 * @param {{ listadoMs?: number }} [opciones]  cada cuánto se vuelve a listar (LISTADO_MS; las pruebas lo acortan)
 */
export function crearIndice(fuente, { listadoMs = LISTADO_MS } = {}) {
  /** @type {Map<string, CorridaDelIndice>} */
  const cerradas = new Map();
  /** @type {Map<string, import("./clasificar.js").IntentoDelIndice>} intentos con run.json de tandas que todavía no cierran */
  const runsLeidos = new Map();
  const avisados = new Set();
  let conocidas = [];
  let vigenteHasta = Number.NEGATIVE_INFINITY;
  let listando = null;

  // Las claves del último listado mientras tenga menos de listadoMs; si no, se lista de nuevo (uno a la vez).
  function claves() {
    if (performance.now() < vigenteHasta) return Promise.resolve(conocidas);
    listando ??= Promise.resolve()
      .then(() => fuente.listarCorridas())
      .then((listadas) => {
        conocidas = [...new Set(listadas)];
        vigenteHasta = performance.now() + listadoMs;
        return conocidas;
      })
      .finally(() => {
        listando = null;
      });
    return listando;
  }

  async function leerJson(clave, relativa) {
    if (fuente.leerJsonDetallado) return fuente.leerJsonDetallado(clave, relativa);
    const datos = await fuente.leerJson(clave, relativa);
    return { datos, estado: datos ? "ok" : "falta" };
  }

  async function leerIntentos(clave, status) {
    const tandaEnCurso = status === "running";
    const carpetas = (await fuente.listarPerfiles(clave)).filter((carpeta) => CARPETA.test(carpeta)).sort();
    const intentos = await Promise.all(
      carpetas.map(async (carpeta) => {
        const id = `${clave}/${carpeta}`;
        if (runsLeidos.has(id)) return runsLeidos.get(id);
        const run = await leerJson(clave, `${carpeta}/run.json`);
        if (run.estado === "ok" && esObjeto(run.datos)) {
          const intento = intentoDelVisitante(carpeta, { run });
          runsLeidos.set(id, intento);
          return intento;
        }
        const traza = run.estado === "falta" && tandaEnCurso ? (await leerJson(clave, `${carpeta}/trace.json`)).datos : null;
        return intentoDelVisitante(carpeta, { run, traza, tandaEnCurso });
      }),
    );
    return intentos.filter(Boolean);
  }

  /**
   * Una corrida, de la caché si está cerrada; null si la clave no es una corrida o no se pudo leer.
   * @param {string} clave  una clave listada por la fuente o una run_key ya validada
   * @returns {Promise<CorridaDelIndice | null>}
   */
  async function corrida(clave) {
    if (cerradas.has(clave)) return cerradas.get(clave);
    const partes = partesDeCorrida(clave);
    if (!partes) return null;
    try {
      const { datos: manifiesto } = await leerJson(clave, "manifest.json");
      const status = esObjeto(manifiesto) && typeof manifiesto.status === "string" ? manifiesto.status : null;
      const intentos = partes.agente === "visitor" ? await leerIntentos(clave, status) : null;
      const leida = {
        clave,
        rol: partes.agente,
        host: partes.host,
        goal: partes.objetivo,
        corrida: partes.corrida,
        status,
        intentos,
        listada: partes.agente === "visitor" && status === "succeeded" && (await fuente.existe(clave, "route_tree.json")),
      };
      if (CERRADA.has(status)) {
        cerradas.set(clave, leida);
        for (const intento of leida.intentos ?? []) runsLeidos.delete(`${clave}/${intento.carpeta}`);
      }
      return leida;
    } catch (error) {
      // Una corrida que no se puede leer (un permiso, un corte de red) no tumba el resumen: se omite y se reintenta.
      if (!avisados.has(clave)) {
        avisados.add(clave);
        console.error(`indice: no se pudo leer «${clave}»; se omite.`, error);
      }
      return null;
    }
  }

  return {
    corrida,

    /**
     * Una pasada por el almacén: las claves conocidas (listadas de nuevo si el listado tiene LISTADO_MS o más), con lo
     * cerrado de la caché y lo abierto releído.
     * @returns {Promise<{ corridas: CorridaDelIndice[], porClave: Map<string, CorridaDelIndice> }>}
     */
    async leer() {
      const corridas = (await mapearEnParalelo(await claves(), EN_PARALELO, corrida)).filter(Boolean);
      return { corridas, porClave: new Map(corridas.map((leida) => [leida.clave, leida])) };
    },
  };
}
