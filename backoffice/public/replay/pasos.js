// Lista de pasos del Replay (columna izquierda): número, acción y descripción corta de cada paso, con el actual
// resaltado. Es un `role="listbox"` con `aria-activedescendant`: el foco queda en la lista y nunca en las filas, así
// que al cambiar de paso las filas se marcan sin que el foco se caiga.

import { textoDeFirma } from "../datos/textos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { marcaDeSenal } from "../nucleo/iconos.js";
import { resumenDelPaso, tonoDelPaso } from "./paso.js";

const idDeOpcion = (indice) => `replay-paso-${indice}`;

/** Desplaza `contenedor` (no la página) lo justo para que se vea `elemento`. */
function asegurarVisible(contenedor, elemento) {
  const caja = contenedor.getBoundingClientRect();
  const fila = elemento.getBoundingClientRect();
  if (fila.top < caja.top) contenedor.scrollTop -= caja.top - fila.top + 4;
  else if (fila.bottom > caja.bottom) contenedor.scrollTop += fila.bottom - caja.bottom + 4;
}

/**
 * @param {{ t: Function, elegir: (indice: number) => void, mover: (delta: number) => void, senal: AbortSignal }} opciones
 */
export function crearListaDePasos({ t, elegir, mover, senal }) {
  const lista = el("ol", {
    class: "replay-pasos-lista",
    role: "listbox",
    tabindex: "0",
    "aria-label": t("replay.pasos.etiqueta"),
    "data-foco": "replay:pasos",
    "data-foco-inicial": "",
  });
  let actual = -1;

  lista.addEventListener(
    "keydown",
    (evento) => {
      if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
      if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        mover(evento.key === "ArrowDown" ? 1 : -1);
      }
    },
    { signal: senal },
  );
  lista.addEventListener(
    "click",
    (evento) => {
      const opcion = evento.target instanceof Element ? evento.target.closest('[role="option"]') : null;
      if (!opcion) return;
      lista.focus({ preventScroll: true });
      elegir(Number(opcion.dataset.indice));
    },
    { signal: senal },
  );

  function fila(paso, indice) {
    const firma = textoDeFirma(paso.firma, t) || paso.descripcion || "";
    const resumen = resumenDelPaso(paso);
    const tono = tonoDelPaso(paso);
    const senales = paso.senales ?? [];
    return el(
      "li",
      {
        id: idDeOpcion(indice),
        class: `replay-paso${tono ? ` tono-${tono}` : ""}`,
        role: "option",
        "aria-selected": "false",
        "aria-label": [t("replay.pasos.opcion", { n: paso.numero, firma }), resumen, ...senales.map((s) => t(`comun.senal.${s}`))].filter(Boolean).join(". "),
        "data-indice": String(indice),
      },
      el("span", { class: "replay-paso-numero num", "aria-hidden": "true", texto: String(paso.numero) }),
      el(
        "span",
        { class: "replay-paso-texto", "aria-hidden": "true" },
        el("span", { class: "replay-paso-accion truncar", title: firma, texto: firma }),
        resumen ? el("span", { class: "replay-paso-resumen truncar", title: resumen, texto: resumen }) : null,
      ),
      senales.length ? el("span", { class: "replay-paso-senales", "aria-hidden": "true" }, senales.map((s) => marcaDeSenal(s))) : null,
    );
  }

  /** Arma las filas de un intento. */
  function pintar(intento) {
    reemplazar(lista, (intento?.pasos ?? []).map(fila));
    actual = -1;
  }

  /** Resalta el paso `indice` y lo deja a la vista dentro de la lista. */
  function marcar(indice) {
    if (indice === actual) return;
    lista.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    actual = indice;
    const opcion = lista.querySelector(`#${idDeOpcion(indice)}`);
    if (!opcion) {
      lista.removeAttribute("aria-activedescendant");
      return;
    }
    opcion.setAttribute("aria-selected", "true");
    lista.setAttribute("aria-activedescendant", idDeOpcion(indice));
    asegurarVisible(lista, opcion);
  }

  /** Vuelve a dejar el paso actual a la vista (después de que la lista cambió de alto). */
  function revelar() {
    const opcion = lista.querySelector('[aria-selected="true"]');
    if (opcion) asegurarVisible(lista, opcion);
  }

  return { nodo: lista, pintar, marcar, revelar };
}
