// El riel vertical de la tanda (columna izquierda): una fila por traza (o por página, en la Propuesta) con su punto,
// su nombre, una cifra y una línea de por qué. Pasar sobre una fila la anticipa; un clic la elige. Al pie, las otras
// tandas de la misma tarea. En el teléfono es una fila horizontal (estilos/marco-tanda.css).

import { el, reemplazar } from "../nucleo/dom.js";
import { enlaceATanda } from "../nucleo/rutas.js";
import { fechaDeCorrida, otrasDeLaTarea } from "./riel-estado.js";

/** Desplaza `contenedor` (no la hoja) lo justo para que se vea `fila`. */
function asegurarVisible(contenedor, fila) {
  const caja = contenedor.getBoundingClientRect();
  const r = fila.getBoundingClientRect();
  if (r.top < caja.top) contenedor.scrollTop -= caja.top - r.top + 8;
  else if (r.bottom > caja.bottom) contenedor.scrollTop += r.bottom - caja.bottom + 8;
  if (r.left < caja.left) contenedor.scrollLeft -= caja.left - r.left + 8;
  else if (r.right > caja.right) contenedor.scrollLeft += r.right - caja.right + 8;
}

/**
 * @typedef {{ id: string, punto?: string | null, nombre: string, cifra: string, cifraAviso?: boolean, detalle?: string, titulo?: string }} Fila
 *
 * @param {{ titulo: string, orden: string, etiqueta: string, filas: Fila[], senal: AbortSignal,
 *           alApuntar?: (id: string | null) => void, alElegir: (id: string) => void,
 *           otras?: { titulo: string, tanda: object, pestana: string, resumen: (id: string) => string | null, fecha: (iso: string) => string } | null }} opciones
 */
export function crearRiel({ titulo, orden, etiqueta, filas, senal, alApuntar = () => {}, alElegir, otras = null }) {
  const botones = new Map();
  const lista = el(
    "div",
    { class: "carril-lista", role: "group", "aria-label": etiqueta },
    filas.map((fila) => {
      const boton = el(
        "button",
        { type: "button", class: `carril-fila${fila.punto ? "" : " carril-sin-punto"}`, tabindex: "-1", "data-id": fila.id, "data-foco": `riel:${fila.id}`, title: fila.titulo ?? null },
        el(
          "span",
          { class: "carril-linea" },
          fila.punto ? el("span", { class: `carril-punto carril-punto-${fila.punto}`, "aria-hidden": "true" }) : null,
          el("span", { class: "carril-nombre", texto: fila.nombre }),
          el("span", { class: `carril-cifra${fila.cifraAviso ? " carril-cifra-aviso" : ""}`, texto: fila.cifra }),
        ),
        fila.detalle ? el("span", { class: "carril-motivos", texto: fila.detalle }) : null,
      );
      botones.set(fila.id, boton);
      return boton;
    }),
  );
  const filaDe = (evento) => (evento.target instanceof Element ? evento.target.closest(".carril-fila") : null);
  lista.addEventListener("click", (evento) => {
    const fila = filaDe(evento);
    if (fila) alElegir(fila.dataset.id);
  }, { signal: senal });
  lista.addEventListener("pointerover", (evento) => alApuntar(filaDe(evento)?.dataset.id ?? null), { signal: senal });
  lista.addEventListener("pointerleave", () => alApuntar(null), { signal: senal });

  const nodo = el(
    "aside",
    { class: "carril", "aria-label": etiqueta },
    el("div", { class: "carril-cabecera" }, el("span", { class: "tanda-etiqueta", texto: titulo }), el("span", { class: "carril-orden", texto: orden })),
    lista,
    pieDeOtras(otras),
  );

  // Una sola parada de Tab en el riel (tabindex móvil): la fila elegida o, sin elegida, la primera.
  const ponerParada = (id) => {
    const parada = botones.get(id) ?? botones.values().next().value;
    for (const boton of botones.values()) boton.tabIndex = boton === parada ? 0 : -1;
  };
  ponerParada(null);

  return {
    nodo,
    /** Marca la fila elegida (o ninguna) y la deja a la vista dentro del riel; con `enfocar`, le pasa el foco. */
    marcar(id, { enfocar = false } = {}) {
      for (const [clave, boton] of botones) {
        if (clave === id) boton.setAttribute("aria-current", "true");
        else boton.removeAttribute("aria-current");
      }
      ponerParada(id);
      const boton = id ? botones.get(id) : null;
      if (boton && enfocar) boton.focus({ preventScroll: true });
      if (boton) requestAnimationFrame(() => asegurarVisible(nodo, boton));
    },
  };
}

function pieDeOtras(otras) {
  if (!otras) return null;
  const vecinas = otrasDeLaTarea(otras.tanda?.vecinas);
  if (!vecinas.length) return null;
  const pie = el("nav", { class: "carril-pie", "aria-label": otras.titulo }, el("span", { class: "tanda-etiqueta", texto: otras.titulo }));
  reemplazar(
    pie,
    pie.firstChild,
    vecinas.map(({ id, fecha }) =>
      el(
        "a",
        { class: "carril-otra", href: enlaceATanda(id, otras.pestana), "data-foco": `riel:otra:${id}` },
        el("span", { texto: otras.fecha(fechaDeCorrida(fecha)) }),
        el("span", { class: "num", texto: otras.resumen(id) ?? "" }),
      ),
    ),
  );
  return pie;
}
