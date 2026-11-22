// Memoria corta de lecturas y respuestas, compartida por lib/panel.js y lib/tandas.js.

/** Cuánto se reutiliza una lectura o una respuesta ya terminada (los pedidos de una misma pasada llegan juntos). */
export const MEMORIA_MS = 2000;

/**
 * La función memorizada: mientras la promesa corre, todos la comparten; ya resuelta, por `ms` más. Un error no se
 * guarda. Cuenta con el reloj del proceso, no con el inyectado (el del mock está quieto).
 * Con `{ desde }` (un performance.now()) solo sirve una lectura que empezó en ese momento o después: si la guardada
 * es más vieja, empieza otra, que queda como la compartida (así varios que preguntan a la vez comparten la nueva).
 * Con `rancioMs`, una lectura vencida hace menos de `rancioMs` se sirve igual mientras otra empieza por detrás: quien
 * pregunta no espera, y la siguiente pregunta recibe la nueva.
 * @template T
 * @param {() => Promise<T> | T} fn
 * @param {number} [ms]
 * @param {{ rancioMs?: number }} [opciones]
 * @returns {(opciones?: { desde?: number }) => Promise<T>}
 */
export function memorizar(fn, ms = MEMORIA_MS, { rancioMs = 0 } = {}) {
  let guardada = null;
  let lista = null;
  const empezar = () => {
    const actual = { promesa: null, desde: performance.now(), hasta: null };
    actual.promesa = Promise.resolve()
      .then(fn)
      .then(
        (valor) => {
          actual.hasta = performance.now() + ms;
          // Una lectura vieja que termina tarde no pisa a una más nueva.
          if (!lista || actual.desde >= lista.desde) lista = actual;
          return valor;
        },
        (error) => {
          if (guardada === actual) guardada = null;
          throw error;
        },
      );
    guardada = actual;
    return actual.promesa;
  };
  return ({ desde } = {}) => {
    if (!guardada) return empezar();
    if (desde !== undefined) return guardada.desde >= desde ? guardada.promesa : empezar();
    const ahora = performance.now();
    if (guardada.hasta === null || ahora < guardada.hasta) {
      // Ya hay una nueva en curso: mientras no termine, la anterior todavía sirve si no está demasiado vieja.
      if (guardada.hasta === null && lista && ahora < lista.hasta + rancioMs) return lista.promesa;
      return guardada.promesa;
    }
    if (ahora < guardada.hasta + rancioMs) {
      const vieja = guardada.promesa;
      empezar().catch((error) => console.warn("memoria: falló el recálculo por detrás; se reintenta.", error));
      return vieja;
    }
    return empezar();
  };
}
