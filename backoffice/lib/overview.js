// Las cifras y listas del Overview (contrato del Overview v3, §1 y §2). Lógica pura: lib/panel.js lee el almacén y la
// tabla y arma las respuestas con esto.
//
// GET /api/resumen → { ahora, roles }: todas las corridas del almacén por rol y estado (un agente = una corrida; un
//   visitante = un intento), con los visitantes por dispositivo. `en_cola` sale de la tabla (enColaDeRevision en
//   lib/tarjeta.js) y no entra en las cifras visibles: la página la usa solo para dibujar contornos.
// GET /api/overview → { ahora, disponible, umbralDetenidaMin, cuentas, pestanas, cola, tarjetas }: listasDelOverview()
//   arma cuentas, pestañas y cola; las tarjetas salen de lib/tarjeta.js.

import { estadoDeCorrida } from "./clasificar.js";

/** Cuántos ids trae cada pestaña (y la cola): la página muestra hasta 6 tarjetas. */
export const MAXIMO_POR_PESTANA = 6;

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
const primeroEnLlegar = (a, b) => tiempo(a.creada) - tiempo(b.creada) || compararTexto(a.revision, b.revision);

/**
 * cuentas, pestañas y cola del Overview.
 * - cuentas.running: las que corren según la tabla (incluye las detenidas); stalled ⊂ running; live = running + queued.
 * - pestañas (por creada descendente, desempate por id; hasta MAXIMO_POR_PESTANA ids y el total): recent, todas menos
 *   las queued; live, running + stalled; delivered; failed.
 * - cola: las queued por orden de llegada (creada ascendente).
 * @param {{ revision: string, creada: string | null, estado: "running" | "stalled" | "queued" | "delivered" | "failed" }[]} revisiones
 */
export function listasDelOverview(revisiones) {
  const ordenadas = [...revisiones].sort(masNuevaPrimero);
  const de = (...estados) => ordenadas.filter((revision) => estados.includes(revision.estado));
  const pestana = (lista) => ({ ids: lista.slice(0, MAXIMO_POR_PESTANA).map((revision) => revision.revision), total: lista.length });
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
      recent: pestana(de("running", "stalled", "delivered", "failed")),
      live: pestana(de("running", "stalled")),
      delivered: pestana(de("delivered")),
      failed: pestana(de("failed")),
    },
    cola: pestana(de("queued").sort(primeroEnLlegar)),
  };
}

/** Los ids que necesitan tarjeta: los de cada pestaña y los de la cola, sin repetir, en ese orden. */
export function idsConTarjeta({ pestanas, cola }) {
  return [...new Set([...Object.values(pestanas).flatMap((pestana) => pestana.ids), ...cola.ids])];
}
