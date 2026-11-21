// Transiciones de vista (diseño §5.10, §6.3). Los datos se cargan ANTES de llamar: durante la transición la página
// está congelada. Firefox no tiene tipos de transición: la dirección va en <html data-nav="…">.

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** true si conviene animar (hay View Transitions y no se pidió menos movimiento). */
export function puedeAnimar() {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function" && !movimientoReducido();
}

/**
 * Corre `actualizarDom` (sincrónico o asíncrono) dentro de una transición de vista cuando se puede.
 * Resuelve cuando el DOM nuevo ya está puesto (no espera a que termine la animación).
 * @param {() => void | Promise<void>} actualizarDom
 * @param {{ direccion?: "adelante" | "atras" | "lado" }} opciones
 */
export async function conTransicion(actualizarDom, { direccion = "lado" } = {}) {
  if (!puedeAnimar()) {
    await actualizarDom();
    return;
  }
  const raiz = document.documentElement;
  raiz.dataset.nav = direccion;
  let transicion;
  try {
    transicion = document.startViewTransition(() => actualizarDom());
  } catch {
    delete raiz.dataset.nav;
    await actualizarDom();
    return;
  }
  transicion.finished
    .catch(() => {})
    .finally(() => {
      if (raiz.dataset.nav === direccion) delete raiz.dataset.nav;
    });
  // Si la animación se salta (otra navegación la interrumpe), el DOM igual se actualizó.
  transicion.ready.catch(() => {});
  await transicion.updateCallbackDone;
}
