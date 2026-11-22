// Las cifras y listas del Overview (contrato del Overview v3, §1 y §2). Lógica pura: lib/panel.js lee el almacén y la
// tabla y arma las respuestas con esto.
//
// GET /api/resumen → { ahora, roles }: todas las corridas del almacén por rol y estado (un agente = una corrida; un
//   visitante = un intento), con los visitantes por dispositivo. `en_cola` sale de la tabla (enColaDeRevision en
//   lib/tarjeta.js) y no entra en las cifras visibles: la página la usa solo para dibujar contornos.
// GET /api/overview[?pestana=<p>&limite=<n>] → { ahora, disponible, umbralDetenidaMin, cuentas, pestanas, tarjetas }:
//   listasDelOverview() arma cuentas y pestañas (paginadas en el servidor: parametrosDelOverview); las tarjetas salen
//   de lib/tarjeta.js.

import { estadoDeCorrida } from "./clasificar.js";

/** Cuántos ids trae cada pestaña por defecto (y como mínimo, la pedida): la página parte mostrando 6 tarjetas. */
export const MAXIMO_POR_PESTANA = 6;
/** El tope de `limite` (la página pide de a 10 más con "Show 10 more"). */
export const LIMITE_MAXIMO = 500;
export const PESTANAS = ["recent", "live", "delivered", "failed"];

const RESULTADOS_DEL_VISITANTE = ["logrado", "fallido", "abandonado", "sin_medir", "error", "en_curso"];
const ROLES_CON_MANIFIESTO = ["cataloger", "guide", "improver"];

const vacioDeAgente = () => ({ logrado: 0, fallido: 0, en_curso: 0, en_cola: 0 });
const vacioDeVisitante = () => ({ logrado: 0, fallido: 0, abandonado: 0, sin_medir: 0, error: 0, en_curso: 0, en_cola: 0 });

/**
 * Los conteos de /api/resumen.
 * @param {{ corridas: { rol: string, status: unknown }[], intentos: { estado: string, dispositivo: string }[],
 *           enCola?: { cataloger?: number, guide?: number, visitor?: number, improver?: number } }} entrada
 *        corridas: una por manifest.json (las del Visitante se ignoran: cuentan sus intentos); intentos: los del
 *        Visitante (lib/clasificar.js); enCola: la suma de enColaDeRevision de las revisiones que corren.
 */
export function contarResumen({ corridas, intentos, enCola = {} }) {
  const roles = {
    cataloger: vacioDeAgente(),
    guide: vacioDeAgente(),
    visitor: { all: vacioDeVisitante(), desktop: vacioDeVisitante(), mobile: vacioDeVisitante() },
    improver: vacioDeAgente(),
  };
  for (const { rol, status } of corridas) {
    const estado = estadoDeCorrida(status);
    if (estado && ROLES_CON_MANIFIESTO.includes(rol)) roles[rol][estado] += 1;
  }
  for (const { estado, dispositivo } of intentos) {
    if (!RESULTADOS_DEL_VISITANTE.includes(estado)) continue;
    roles.visitor[dispositivo === "mobile" ? "mobile" : "desktop"][estado] += 1;
    roles.visitor.all[estado] += 1;
  }
  for (const rol of ROLES_CON_MANIFIESTO) roles[rol].en_cola = enCola[rol] ?? 0;
  // Un Visitante en cola es un cuadrito sin dispositivo: vale lo mismo en all, desktop y mobile.
  for (const vista of ["all", "desktop", "mobile"]) roles.visitor[vista].en_cola = enCola.visitor ?? 0;
  return roles;
}

const tiempo = (valor) => {
  const ms = typeof valor === "string" ? Date.parse(valor) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};
const compararTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const masNuevaPrimero = (a, b) => tiempo(b.creada) - tiempo(a.creada) || compararTexto(a.revision, b.revision);

/**
 * Los parámetros de GET /api/overview, normalizados: `pestana` una de PESTANAS (si no, ninguna) y `limite` un entero
 * entre MAXIMO_POR_PESTANA y LIMITE_MAXIMO (uno que no es entero o es menor vale MAXIMO_POR_PESTANA). Sin pestaña o
 * con el límite por defecto, la respuesta es la de siempre: { pestana: null, limite: MAXIMO_POR_PESTANA }.
 * @param {{ pestana?: unknown, limite?: unknown }} [crudos]  tal como llegan en la URL
 * @returns {{ pestana: string | null, limite: number }}
 */
export function parametrosDelOverview({ pestana, limite } = {}) {
  const valida = PESTANAS.includes(pestana) ? pestana : null;
  const pedido = /^\d+$/.test(String(limite ?? "")) ? Number(limite) : MAXIMO_POR_PESTANA;
  const acotado = Math.min(LIMITE_MAXIMO, Math.max(MAXIMO_POR_PESTANA, pedido));
  return valida && acotado > MAXIMO_POR_PESTANA ? { pestana: valida, limite: acotado } : { pestana: null, limite: MAXIMO_POR_PESTANA };
}

/**
 * cuentas y pestañas del Overview.
 * - cuentas.running: las que corren según la tabla (incluye las detenidas); stalled ⊂ running; live = running + queued
 *   (= pestanas.live.total).
 * - pestañas (por creada descendente, desempate por id; ids hasta MAXIMO_POR_PESTANA, o `limite` en la pedida, y el
 *   total): recent, todas (también las en cola); live, running + stalled + queued; delivered; failed.
 * @param {{ revision: string, creada: string | null, estado: "running" | "stalled" | "queued" | "delivered" | "failed" }[]} revisiones
 * @param {{ pestana?: string | null, limite?: number }} [pagina]  ya normalizada (parametrosDelOverview)
 */
export function listasDelOverview(revisiones, { pestana = null, limite = MAXIMO_POR_PESTANA } = {}) {
  const ordenadas = [...revisiones].sort(masNuevaPrimero);
  const de = (...estados) => ordenadas.filter((revision) => estados.includes(revision.estado));
  const enPestana = (nombre, lista) => ({
    ids: lista.slice(0, nombre === pestana ? limite : MAXIMO_POR_PESTANA).map((revision) => revision.revision),
    total: lista.length,
  });
  const cuantas = (...estados) => de(...estados).length;
  return {
    cuentas: {
      total: revisiones.length,
      running: cuantas("running", "stalled"),
      stalled: cuantas("stalled"),
      queued: cuantas("queued"),
      live: cuantas("running", "stalled", "queued"),
      delivered: cuantas("delivered"),
      failed: cuantas("failed"),
    },
    pestanas: {
      recent: enPestana("recent", ordenadas),
      live: enPestana("live", de("running", "stalled", "queued")),
      delivered: enPestana("delivered", de("delivered")),
      failed: enPestana("failed", de("failed")),
    },
  };
}

/** Los ids que necesitan tarjeta: los de cada pestaña, sin repetir, en ese orden. */
export function idsConTarjeta({ pestanas }) {
  return [...new Set(Object.values(pestanas).flatMap((pestana) => pestana.ids))];
}
