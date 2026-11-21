// Globo de ayuda compartido (tooltip; diseño §5.10): un solo [popover="manual"].globo ubicado por JS, que se da
// vuelta en los bordes de la ventana. Aparece al pasar el puntero (400 ms la primera vez, al instante durante
// 300 ms después de cerrar otro) y con el foco de teclado; se cierra al salir, al perder el foco y con Esc.

import { el } from "./dom.js";

const RETRASO = 400;
const GRACIA = 300;
const MARGEN = 8;

let globo = null;
let duenio = null;
let reloj = 0;
let cerradoEn = 0;

function elemento() {
  if (globo?.isConnected) return globo;
  globo = document.getElementById("globo") ?? document.body.appendChild(el("div", { id: "globo", class: "globo", popover: "manual", role: "tooltip" }));
  globo.setAttribute("role", "tooltip");
  document.addEventListener(
    "keydown",
    (evento) => {
      if (evento.key === "Escape" && duenio) {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        ocultarGlobo();
      }
    },
    true,
  );
  addEventListener("scroll", () => duenio && ocultarGlobo(), { capture: true, passive: true });
  return globo;
}

function ubicar(objetivo) {
  const caja = objetivo.getBoundingClientRect();
  const ancho = globo.offsetWidth;
  const alto = globo.offsetHeight;
  let x = caja.left + caja.width / 2 - ancho / 2;
  x = Math.min(Math.max(MARGEN, x), innerWidth - ancho - MARGEN);
  let y = caja.top - alto - 6;
  if (y < MARGEN) y = caja.bottom + 6;
  if (y + alto > innerHeight - MARGEN) y = Math.max(MARGEN, innerHeight - alto - MARGEN);
  globo.style.left = `${Math.round(x)}px`;
  globo.style.top = `${Math.round(y)}px`;
}

function mostrar(objetivo, contenido) {
  elemento();
  clearTimeout(reloj);
  duenio = objetivo;
  const nodo = typeof contenido === "function" ? contenido() : contenido;
  globo.replaceChildren(nodo instanceof Node ? nodo : document.createTextNode(String(nodo ?? "")));
  try {
    if (!globo.matches(":popover-open")) globo.showPopover();
  } catch {
    return;
  }
  ubicar(objetivo);
  objetivo.setAttribute("aria-describedby", "globo");
}

/** Cierra el globo si está abierto. → true si estaba abierto. */
export function ocultarGlobo() {
  clearTimeout(reloj);
  if (!duenio) return false;
  if (duenio.getAttribute("aria-describedby") === "globo") duenio.removeAttribute("aria-describedby");
  duenio = null;
  cerradoEn = performance.now();
  try {
    globo?.hidePopover();
  } catch {
    // ya estaba cerrado
  }
  return true;
}

/**
 * Asocia un globo a `elemento`. `contenido`: texto, nodo o función que devuelve uno (se arma al mostrar).
 * `senal`: AbortSignal de la vista; al abortar se quitan los oyentes y se cierra si era de este elemento.
 */
export function conGlobo(objetivo, contenido, { senal } = {}) {
  const opciones = senal ? { signal: senal } : undefined;
  const programar = () => {
    clearTimeout(reloj);
    const reciente = performance.now() - cerradoEn < GRACIA;
    if (reciente) mostrar(objetivo, contenido);
    else reloj = setTimeout(() => mostrar(objetivo, contenido), RETRASO);
  };
  const salir = () => {
    clearTimeout(reloj);
    if (duenio === objetivo) ocultarGlobo();
  };
  objetivo.addEventListener("pointerenter", (evento) => evento.pointerType === "mouse" && programar(), opciones);
  objetivo.addEventListener("pointerleave", salir, opciones);
  objetivo.addEventListener("focus", () => objetivo.matches(":focus-visible") && mostrar(objetivo, contenido), opciones);
  objetivo.addEventListener("blur", salir, opciones);
  objetivo.addEventListener("pointerdown", salir, opciones);
  senal?.addEventListener("abort", salir, { once: true });
  return objetivo;
}
