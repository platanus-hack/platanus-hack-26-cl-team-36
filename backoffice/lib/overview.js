// Las cifras y listas del Overview (contrato del Overview v3, §1 y §2). Lógica pura: lib/panel.js lee el almacén y la
// tabla y arma las respuestas con esto.
//
// GET /api/resumen → { ahora, roles }: todas las corridas del almacén por rol y estado (un agente = una corrida; un
//   visitante = un intento), con los visitantes por dispositivo. `en_cola` sale de la tabla (enColaDeRevision en
//   lib/tarjeta.js) y no entra en las cifras visibles: la página la usa solo para dibujar contornos.
// GET /api/overview[?pestana=<p>&pagina=<n>&link=<texto>] → { ahora, disponible, umbralDetenidaMin, busqueda, cuentas,
//   pestanas, tarjetas }: con `link`, solo las revisiones cuyo link calza (public/nucleo/links.js), en cifras y pestañas;
//   listasDelOverview() arma cuentas y pestañas (paginadas en el servidor: parametrosDelOverview); las tarjetas salen
//   de lib/tarjeta.js. Solo entran las revisiones vigentes, una por página (lib/panel.js): si la vigente corre, la tarjeta
//   dice que corre aunque una anterior se haya entregado; las reemplazadas no cuentan en ninguna cifra ni pestaña.

import { calzaLink, normalizarBusqueda } from "../public/nucleo/links.js";
import { estadoDeCorrida } from "./clasificar.js";

/** Tarjetas por página: cada pestaña trae una página de 6 (la primera, o la pedida en la pestaña pedida). */
export const POR_PAGINA = 6;
/** La página más alta que se acepta en la URL (más allá, vale la última que exista). */
export const PAGINA_MAXIMA = 9999;
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
 * Los parámetros de GET /api/overview, normalizados: `pestana` una de PESTANAS (si no, ninguna), `pagina` un entero
 * desde 1 hasta PAGINA_MAXIMA (uno que no es entero positivo vale 1) y `link` la búsqueda normalizada (null si no
 * hay). Sin pestaña o en la página 1, la página es la de siempre: { pestana: null, pagina: 1 }.
 * @param {{ pestana?: unknown, pagina?: unknown, link?: unknown }} [crudos]  tal como llegan en la URL
 * @returns {{ pestana: string | null, pagina: number, link: string | null }}
 */
export function parametrosDelOverview({ pestana, pagina, link } = {}) {
  const valida = PESTANAS.includes(pestana) ? pestana : null;
  const pedida = /^\d{1,9}$/.test(String(pagina ?? "")) ? Number(pagina) : 1;
  const acotada = Math.min(PAGINA_MAXIMA, Math.max(1, pedida));
  const busqueda = normalizarBusqueda(link) || null;
  return valida && acotada > 1 ? { pestana: valida, pagina: acotada, link: busqueda } : { pestana: null, pagina: 1, link: busqueda };
}

/**
 * cuentas y pestañas del Overview.
 * - cuentas.running: las que corren según la tabla (incluye las detenidas); stalled ⊂ running; live = running + queued
 *   (= pestanas.live.total).
 * - pestañas (por creada descendente, desempate por id): recent, todas (también las en cola); live, running + stalled
 *   + queued; delivered; failed. Cada una con los ids de una página de POR_PAGINA (la 1, o `pagina` en la pedida,
 *   acotada a la última que existe), su número, cuántas páginas hay y el total.
 * - con `link`, todo (cifras y pestañas) cuenta solo las revisiones cuyo link calza.
 * @param {{ revision: string, creada: string | null, url?: string | null, estado: "running" | "stalled" | "queued" | "delivered" | "failed" }[]} todas
 * @param {{ pestana?: string | null, pagina?: number, link?: string | null }} [pedida]  ya normalizada (parametrosDelOverview)
 */
export function listasDelOverview(todas, { pestana = null, pagina = 1, link = null } = {}) {
  const revisiones = link ? todas.filter((revision) => calzaLink(revision.url, link)) : todas;
  const ordenadas = [...revisiones].sort(masNuevaPrimero);
  const de = (...estados) => ordenadas.filter((revision) => estados.includes(revision.estado));
  const enPestana = (nombre, lista) => {
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    const esta = nombre === pestana ? Math.min(pagina, paginas) : 1;
    const desde = (esta - 1) * POR_PAGINA;
    return { ids: lista.slice(desde, desde + POR_PAGINA).map((revision) => revision.revision), total: lista.length, pagina: esta, paginas };
  };
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
