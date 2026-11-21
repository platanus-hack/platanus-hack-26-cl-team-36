// Avisos breves (toasts) y anuncios para lectores de pantalla (diseño §5.10). Los avisos se usan solo para
// "Enlace copiado" y el de los enlaces viejos.

import { copiarTexto, el } from "./dom.js";
import { icono } from "./iconos.js";
import { t } from "./i18n.js";

const MAXIMO = 3;
let pila = null;
let pausado = false;
const relojes = new Map(); // aviso → { restante, desde, id }

function contenedor() {
  if (pila?.isConnected) return pila;
  pila = document.getElementById("avisos") ?? document.body.appendChild(el("div", { id: "avisos", class: "avisos", popover: "manual" }));
  pila.setAttribute("aria-label", t("comun.aviso.region"));
  pila.addEventListener("pointerenter", () => {
    pausado = true;
    for (const [aviso, reloj] of relojes) {
      clearTimeout(reloj.id);
      reloj.restante -= performance.now() - reloj.desde;
      relojes.set(aviso, reloj);
    }
  });
  pila.addEventListener("pointerleave", () => {
    pausado = false;
    for (const [aviso, reloj] of relojes) programar(aviso, Math.max(800, reloj.restante));
  });
  return pila;
}

function mostrarPila() {
  const caja = contenedor();
  try {
    if (!caja.matches(":popover-open")) caja.showPopover();
    else {
      // Vuelve a ponerla encima de un diálogo abierto después.
      caja.hidePopover();
      caja.showPopover();
    }
  } catch {
    // Sin Popover API: la pila igual se ve por CSS.
  }
}

function quitar(aviso) {
  const reloj = relojes.get(aviso);
  if (reloj) clearTimeout(reloj.id);
  relojes.delete(aviso);
  aviso.remove();
  if (pila && !pila.childElementCount) {
    try {
      pila.hidePopover();
    } catch {
      // nada que cerrar
    }
  }
}

function programar(aviso, duracion) {
  const reloj = { restante: duracion, desde: performance.now(), id: 0 };
  if (!pausado) reloj.id = setTimeout(() => quitar(aviso), duracion);
  relojes.set(aviso, reloj);
}

/** Muestra un aviso abajo a la derecha (máximo 3; se pausa con el puntero encima) y lo anuncia. */
export function avisar(texto, { duracion = 4000 } = {}) {
  const caja = contenedor();
  const aviso = el(
    "div",
    { class: "aviso" },
    el("span", { class: "aviso-texto", texto }),
    el("button", {
      type: "button",
      class: "boton boton-icono",
      "aria-label": t("comun.accion.cerrar"),
      onclick: () => quitar(aviso),
    }, icono("cerrar")),
  );
  caja.append(aviso);
  while (caja.childElementCount > MAXIMO) quitar(caja.firstElementChild);
  mostrarPila();
  programar(aviso, duracion);
  anunciar(texto);
  return aviso;
}

let anunciador = null;

/** Texto para lectores de pantalla (aria-live="polite"), sin nada visible. */
export function anunciar(texto) {
  if (!anunciador?.isConnected) {
    anunciador =
      document.getElementById("anunciador") ??
      document.body.appendChild(el("div", { id: "anunciador", class: "visualmente-oculto", "aria-live": "polite" }));
  }
  anunciador.textContent = "";
  // Un cuadro después, para que el mismo texto dos veces seguidas también se anuncie.
  setTimeout(() => {
    anunciador.textContent = String(texto ?? "");
  }, 50);
}

/** Copia el enlace a la vista actual y lo avisa ("Enlace copiado"). */
export async function copiarEnlace(href = location.href) {
  const pudo = await copiarTexto(href);
  avisar(t(pudo ? "comun.aviso.enlaceCopiado" : "comun.aviso.noSePudoCopiar"));
  return pudo;
}
