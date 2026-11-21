// Riel de pasos del Replay (diseño §10.6): una lista `role="listbox"` con `aria-activedescendant`. El foco queda en
// la lista y nunca en las filas, así que al cambiar de paso se reemplazan las filas sin que el foco se caiga.
// Pasos seguidos con la misma acción se juntan en una fila ("desplazar ↓ ×10 · 4 veces") salvo el grupo del paso
// elegido, que se muestra abierto. En pantallas angostas el CSS lo vuelve una tira horizontal de números.

import { textoDeFirma } from "../datos/textos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { icono, marcaDeSenal } from "../nucleo/iconos.js";
import { agruparRepetidos, esProblema } from "./sincronia.js";

const idDeOpcion = (indice) => `replay-paso-${indice}`;

/** Desplaza `contenedor` (no la página) lo justo para que se vea `elemento`. */
function asegurarVisible(contenedor, elemento) {
  const caja = contenedor.getBoundingClientRect();
  const fila = elemento.getBoundingClientRect();
  if (fila.top < caja.top) contenedor.scrollTop -= caja.top - fila.top + 4;
  else if (fila.bottom > caja.bottom) contenedor.scrollTop += fila.bottom - caja.bottom + 4;
  if (fila.left < caja.left) contenedor.scrollLeft -= caja.left - fila.left + 8;
  else if (fila.right > caja.right) contenedor.scrollLeft += fila.right - caja.right + 8;
}

/**
 * @param {{ t: Function, elegir: (indice: number) => void, mover: (delta: number) => void, senal: AbortSignal }} opciones
 * @returns {{ nodo: HTMLElement, pintar: (datos: { intento: object, indice: number, soloSenales: boolean }) => void }}
 */
export function crearRail({ t, elegir, mover, senal }) {
  const lista = el("ol", {
    class: "replay-rail-lista",
    role: "listbox",
    tabindex: "0",
    "aria-label": t("replay.rail.etiqueta"),
    "data-foco": "replay:rail",
    "data-foco-inicial": "",
  });
  const vacio = el("p", { class: "replay-rail-vacio texto-3", hidden: true, texto: t("replay.rail.ningunoConSenales") });

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

  function fila({ intento, desde, hasta, actual }) {
    const pasos = intento.pasos.slice(desde, hasta + 1);
    const primero = pasos[0];
    const firma = textoDeFirma(primero.firma, t) || primero.descripcion || "";
    const repetido = hasta > desde;
    const senales = [...new Set(pasos.flatMap((paso) => paso.senales ?? []))];
    const fuera = pasos.some((paso) => paso.carril === "fuera-de-ruta");
    const carril = primero.carril === "sin-ruta" ? null : fuera ? "fuera-de-ruta" : "en-ruta";
    const etiqueta = [
      repetido
        ? t("replay.rail.opcionRepetida", { desde: primero.numero, hasta: pasos[pasos.length - 1].numero, firma: t("replay.rail.repetido", { firma, n: pasos.length }) })
        : t("replay.rail.opcion", { n: primero.numero, firma }),
      ...senales.map((senal) => t(`comun.senal.${senal}`)),
      carril ? t(`comun.carril.${carril}`) : null,
    ]
      .filter(Boolean)
      .join(". ");
    return el(
      "li",
      {
        id: idDeOpcion(desde),
        class: `replay-rail-fila${repetido ? " replay-rail-grupo" : ""}${senales.length ? " con-senal" : ""}`,
        role: "option",
        "aria-selected": actual ? "true" : "false",
        "aria-label": etiqueta,
        "data-indice": String(desde),
        title: repetido ? null : firma,
      },
      el("span", { class: "replay-rail-numero num", "aria-hidden": "true", texto: repetido ? `${primero.numero}–${pasos[pasos.length - 1].numero}` : String(primero.numero) }),
      el("span", { class: "replay-rail-firma truncar", "aria-hidden": "true", texto: repetido ? t("replay.rail.repetido", { firma, n: pasos.length }) : firma }),
      el("span", { class: "replay-rail-senales", "aria-hidden": "true" }, senales.map((senal) => marcaDeSenal(senal))),
      carril
        ? el("span", { class: `replay-rail-carril carril-${carril}`, "aria-hidden": "true" }, icono(carril))
        : el("span", { class: "replay-rail-carril", "aria-hidden": "true" }),
    );
  }

  function pintar({ intento, indice, soloSenales }) {
    const pasos = intento?.pasos ?? [];
    const filas = [];
    if (soloSenales) {
      pasos.forEach((paso, i) => {
        if (i === indice || esProblema(paso)) filas.push(fila({ intento, desde: i, hasta: i, actual: i === indice }));
      });
    } else {
      for (const grupo of agruparRepetidos(pasos)) {
        const abierto = indice >= grupo.desde && indice <= grupo.hasta;
        if (abierto || grupo.desde === grupo.hasta) {
          for (let i = grupo.desde; i <= grupo.hasta; i += 1) filas.push(fila({ intento, desde: i, hasta: i, actual: i === indice }));
        } else filas.push(fila({ intento, desde: grupo.desde, hasta: grupo.hasta, actual: false }));
      }
    }
    reemplazar(lista, filas);
    vacio.hidden = !(soloSenales && !pasos.some(esProblema));
    if (indice >= 0 && pasos.length) {
      lista.setAttribute("aria-activedescendant", idDeOpcion(indice));
      const activa = lista.querySelector(`#${idDeOpcion(indice)}`);
      if (activa) asegurarVisible(lista, activa);
    } else lista.removeAttribute("aria-activedescendant");
  }

  return { nodo: el("div", { class: "replay-rail-contenido" }, lista, vacio), lista, pintar };
}
