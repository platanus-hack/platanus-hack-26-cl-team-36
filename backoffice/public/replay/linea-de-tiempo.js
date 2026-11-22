// Línea de tiempo del Replay (abajo, a todo el ancho): reproducir/pausar, la velocidad, una barra para recorrer los pasos con una
// marca por paso (coloreada si tiene señal o sale de la ruta) y "Paso n de N". La barra avanza por pasos, no por
// segundos: cada posición es la captura de un paso.

import { el, reemplazar } from "../nucleo/dom.js";
import { icono } from "../nucleo/iconos.js";
import { VELOCIDADES } from "./animacion.js";
import { tonoDelPaso } from "./paso.js";

/**
 * @param {{ t: Function, fmt: object, senal: AbortSignal, elegir: (indice: number) => void, alternar: () => void,
 *           velocidad: (valor: number) => void }} opciones
 */
export function crearLineaDeTiempo({ t, fmt, senal, elegir, alternar, velocidad }) {
  let total = 0;

  const botonReproducir = el(
    "button",
    {
      type: "button",
      class: "boton boton-secundario boton-icono replay-reproducir",
      "aria-label": t("replay.linea.reproducir"),
      "aria-keyshortcuts": "Space",
      "data-foco": "replay:reproducir",
    },
    icono("reproducir"),
  );
  botonReproducir.addEventListener("click", () => alternar(), { signal: senal });

  // Velocidad: un <select> nativo con aspecto de botón, pegado a reproducir (teclas , y .).
  const textoVelocidad = (valor) => t("replay.linea.velocidadValor", { v: fmt.numero(valor) });
  const selectorVelocidad = el(
    "select",
    {
      class: "replay-velocidad num",
      "aria-label": t("replay.linea.velocidad"),
      "aria-keyshortcuts": ", .",
      title: t("replay.linea.velocidadAyuda"),
      "data-foco": "replay:velocidad",
    },
    VELOCIDADES.map((valor) => el("option", { value: String(valor), texto: textoVelocidad(valor) })),
  );
  selectorVelocidad.addEventListener("change", () => velocidad(Number(selectorVelocidad.value)), { signal: senal });

  const barra = el("input", {
    type: "range",
    class: "replay-barra",
    min: "0",
    max: "0",
    step: "1",
    value: "0",
    "aria-label": t("replay.linea.etiqueta"),
    "data-foco": "replay:barra",
  });
  barra.addEventListener("input", () => elegir(Number(barra.value)), { signal: senal });
  const marcas = el("div", { class: "replay-marcas", "aria-hidden": "true" });
  const posicion = el("span", { class: "replay-posicion num" });
  const nodo = el(
    "section",
    { class: "replay-linea", "aria-label": t("replay.linea.etiqueta") },
    botonReproducir,
    selectorVelocidad,
    el("div", { class: "replay-pista" }, marcas, barra),
    posicion,
  );

  /** Arma la barra y las marcas de un intento. */
  function pintar(intento) {
    const pasos = intento.pasos ?? [];
    total = pasos.length;
    nodo.hidden = !total;
    barra.max = String(Math.max(0, total - 1));
    reemplazar(
      marcas,
      pasos.map((paso, indice) => {
        const tono = tonoDelPaso(paso);
        return el("span", {
          class: `replay-marca${tono ? ` tono-${tono}` : ""}`,
          estilo: { "--pos": `${total > 1 ? (indice / (total - 1)) * 100 : 0}%` },
        });
      }),
    );
  }

  /** Lleva la barra, la marca actual y el texto al paso `indice`. */
  function marcar(indice) {
    barra.value = String(indice);
    const texto = t("replay.linea.posicion", { n: indice + 1, total });
    posicion.textContent = texto;
    barra.setAttribute("aria-valuetext", texto);
    marcas.querySelector(".actual")?.classList.remove("actual");
    marcas.children[indice]?.classList.add("actual");
  }

  function ponerReproduciendo(activo) {
    botonReproducir.setAttribute("aria-label", t(activo ? "replay.linea.pausar" : "replay.linea.reproducir"));
    botonReproducir.replaceChildren(icono(activo ? "pausar" : "reproducir"));
    botonReproducir.classList.toggle("activo", activo);
  }

  function ponerVelocidad(valor) {
    selectorVelocidad.value = String(valor);
  }

  return { nodo, pintar, marcar, ponerReproduciendo, ponerVelocidad };
}
