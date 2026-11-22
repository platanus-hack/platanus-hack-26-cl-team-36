// Filas de fichas que se desplazan de lado (perfiles de la telaraña, intentos del Replay): la ficha elegida siempre a
// la vista y una señal en el borde donde quedan fichas ocultas. Las cuentas son puras (node:test las importa).

/** Holgura (px) que se deja entre la ficha y el borde de la fila al traerla a la vista. */
export const HOLGURA = 24;

/**
 * Dónde desplazar la fila (scrollLeft) para que la ficha quede entera a la vista; si ya lo está, donde estaba.
 * @param {{ izquierda: number, ancho: number }} ficha  posición de la ficha dentro del contenido de la fila
 * @param {{ desplazado: number, visible: number, total: number }} fila  scrollLeft, clientWidth, scrollWidth
 */
export function desplazamientoParaVer(ficha, { desplazado, visible, total }) {
  const maximo = Math.max(0, total - visible);
  let destino = desplazado;
  if (ficha.izquierda < desplazado) destino = ficha.izquierda - HOLGURA;
  else if (ficha.izquierda + ficha.ancho > desplazado + visible) destino = ficha.izquierda + ficha.ancho - visible + HOLGURA;
  return Math.min(maximo, Math.max(0, destino));
}

/** ¿Quedan fichas ocultas a la izquierda o a la derecha? */
export function bordesOcultos({ desplazado, visible, total }) {
  return { izquierda: desplazado > 1, derecha: desplazado + visible < total - 1 };
}

const medir = (fila) => ({ desplazado: fila.scrollLeft, visible: fila.clientWidth, total: fila.scrollWidth });
const reducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Trae la ficha a la vista desplazando solo su fila (nunca la página). */
export function mostrarEnFila(fila, ficha) {
  if (!fila || !ficha) return;
  const izquierda = ficha.getBoundingClientRect().left - fila.getBoundingClientRect().left + fila.scrollLeft;
  const destino = desplazamientoParaVer({ izquierda, ancho: ficha.offsetWidth }, medir(fila));
  if (Math.abs(destino - fila.scrollLeft) >= 1) fila.scrollTo({ left: destino, behavior: reducido() ? "auto" : "smooth" });
}

/**
 * Marca la fila con `data-mas-izquierda` / `data-mas-derecha` cuando hay fichas ocultas de ese lado (el CSS pone el
 * desvanecido) y lo mantiene al desplazarla o cambiar de tamaño.
 */
export function seguirBordes(fila, senal) {
  if (!fila) return;
  const marcar = () => {
    const { izquierda, derecha } = bordesOcultos(medir(fila));
    fila.toggleAttribute("data-mas-izquierda", izquierda);
    fila.toggleAttribute("data-mas-derecha", derecha);
  };
  fila.addEventListener("scroll", marcar, { passive: true, signal: senal });
  if (typeof ResizeObserver === "function") {
    const observador = new ResizeObserver(marcar);
    observador.observe(fila);
    senal?.addEventListener("abort", () => observador.disconnect(), { once: true });
  }
  marcar();
}
