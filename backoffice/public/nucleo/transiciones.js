// Transiciones de vista (diseño §5.10, §6.3). Los datos se cargan ANTES de llamar: durante la transición la página
// está congelada. Firefox no tiene tipos de transición: la dirección va en <html data-nav="…">.

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** true si conviene animar (hay View Transitions y no se pidió menos movimiento). */
export function puedeAnimar() {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function" && !movimientoReducido();
}

// Si el navegador no llega a llamar la transición (documento que no pinta: pestaña o panel oculto), se salta.
const ESPERA_DE_TRANSICION = 250;

/**
 * Corre `actualizarDom` (sincrónico o asíncrono) dentro de una transición de vista cuando se puede.
 * Resuelve cuando el DOM nuevo ya está puesto (no espera a que termine la animación). `actualizarDom` corre
 * una sola vez siempre, aunque la transición no llegue a empezar; si lanza, el error sale de aquí.
 * @param {() => void | Promise<void>} actualizarDom
 * @param {{ direccion?: "adelante" | "atras" | "lado" }} opciones
 */
export async function conTransicion(actualizarDom, { direccion = "lado" } = {}) {
  if (!puedeAnimar() || document.visibilityState !== "visible") {
    await actualizarDom();
    return;
  }
  // startViewTransition llama al callback en la próxima oportunidad de pintar, que en un documento que no pinta
  // nunca llega: a los 250 ms se salta la transición y se actualiza igual (una sola vez). No se espera
  // updateCallbackDone, que en ese caso podría no resolverse nunca: se espera la actualización misma.
  let actualizacion = null;
  let avisarInicio;
  const empezo = new Promise((listo) => (avisarInicio = listo));
  const unaVez = () => {
    if (!actualizacion) {
      actualizacion = Promise.resolve().then(actualizarDom);
      avisarInicio();
    }
    return actualizacion;
  };
  const raiz = document.documentElement;
  raiz.dataset.nav = direccion;
  let transicion;
  try {
    transicion = document.startViewTransition(unaVez);
  } catch {
    delete raiz.dataset.nav;
    await unaVez();
    return;
  }
  transicion.finished
    .catch(() => {})
    .finally(() => {
      if (raiz.dataset.nav === direccion) delete raiz.dataset.nav;
    });
  // Si la animación se salta (otra navegación la interrumpe), el DOM igual se actualizó.
  transicion.ready.catch(() => {});
  transicion.updateCallbackDone.catch(() => {}); // el error de actualizarDom sale de `actualizacion`
  const reloj = setTimeout(() => {
    if (actualizacion) return;
    transicion.skipTransition();
    unaVez();
  }, ESPERA_DE_TRANSICION);
  await empezo;
  clearTimeout(reloj);
  await actualizacion;
}
