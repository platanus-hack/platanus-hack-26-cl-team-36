// La hoja donde se abre una tanda, sobre la vista de la que vino (el Overview, Revisiones…). Esa vista queda montada
// debajo, atenuada e inerte, en el mismo scroll; la hoja entra desde la derecha y sale con el movimiento inverso.

import { el } from "./dom.js";

const ENTRADA = { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const SALIDA = { duration: 160, easing: "cubic-bezier(0.64, 0, 0.78, 0)", fill: "forwards" };
const FUERA = { opacity: 0, transform: "translateX(24px)" };
const DENTRO = { opacity: 1, transform: "none" };

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Abre la hoja con `contenido` sobre `fondo` (el <main> del armazón); `titulo` (con id) la nombra.
 * → { nodo, cerrar(): Promise<void> }.
 * @param {Node} contenido
 * @param {{ fondo: HTMLElement, titulo: HTMLElement }} opciones
 */
export function abrirHoja(contenido, { fondo, titulo }) {
  const nodo = el("div", { class: "hoja", role: "region", "aria-labelledby": titulo.id }, contenido);
  fondo.after(nodo);
  fondo.inert = true;
  document.documentElement.classList.add("con-hoja");
  if (!movimientoReducido()) nodo.animate([FUERA, DENTRO], ENTRADA);
  let cerrada = null;
  return {
    nodo,
    cerrar() {
      cerrada ??= (async () => {
        fondo.inert = false;
        document.documentElement.classList.remove("con-hoja");
        nodo.inert = true;
        // Con cuadros lentos (un lienzo WebGL pesado) `finished` puede tardar: a lo más 40 ms después de la salida.
        if (!movimientoReducido()) {
          const tope = new Promise((listo) => setTimeout(listo, SALIDA.duration + 40));
          await Promise.race([nodo.animate([DENTRO, FUERA], SALIDA).finished.catch(() => {}), tope]);
        }
        nodo.remove();
      })();
      return cerrada;
    },
  };
}
