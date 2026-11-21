// Línea de tiempo del Replay (diseño §10.6, §10.6.2): tira de capturas "después" (una por paso, la actual
// enmarcada), carril de la ruta (■ en ruta / □ fuera) y el reproductor: reproducir/pausar, una barra con una marca
// por paso (coloreada si tiene señal), el reloj, la velocidad y "solo pasos" (solo con video).
//
// La tira es un atajo para el puntero: el riel de pasos es su equivalente accesible, así que la tira no entra en el
// orden de tabulación y está oculta para lectores de pantalla.

import { el, reemplazar } from "../nucleo/dom.js";
import { kbd } from "../nucleo/atajos.js";
import { conGlobo } from "../nucleo/globo.js";
import { icono } from "../nucleo/iconos.js";
import { formatoReloj, ventanasDePasos } from "./sincronia.js";

const TONO_DE_SENAL = { no_effect: "aviso", went_back: "aviso", visible_error: "peligro", security_block: "peligro" };

function tonoDelPaso(paso) {
  const tonos = (paso.senales ?? []).map((senal) => TONO_DE_SENAL[senal] ?? "aviso");
  if (tonos.includes("peligro")) return "peligro";
  if (tonos.length) return "aviso";
  return paso.carril === "fuera-de-ruta" ? "fuera" : null;
}

const globoConTecla = (texto, tecla) => () => el("span", { class: "globo-con-tecla" }, el("span", { texto }), kbd(tecla));

/**
 * @param {{ t: Function, fmt: object, urlDeArchivo: Function, senal: AbortSignal, elegir: (indice: number) => void,
 *           buscar: (t: number) => void, alternar: () => void, velocidad: (direccion: 1 | -1) => void,
 *           soloPasos: () => void }} opciones
 */
export function crearLineaDeTiempo({ t, fmt, urlDeArchivo, senal, elegir, buscar, alternar, velocidad, soloPasos }) {
  let total = 0;
  let pasos = [];
  let indiceActual = -1;

  const tira = el("ol", { class: "replay-tira", "aria-hidden": "true" });
  tira.addEventListener(
    "click",
    (evento) => {
      const boton = evento.target instanceof Element ? evento.target.closest("button[data-indice]") : null;
      if (boton) elegir(Number(boton.dataset.indice));
    },
    { signal: senal },
  );

  const botonReproducir = el("button", {
    type: "button",
    class: "boton boton-secundario boton-icono replay-reproducir",
    "aria-label": t("replay.linea.reproducir"),
    "aria-keyshortcuts": "Space",
    "data-foco": "replay:reproducir",
  }, icono("reproducir"));
  botonReproducir.addEventListener("click", () => alternar(), { signal: senal });
  conGlobo(botonReproducir, () => globoConTecla(botonReproducir.getAttribute("aria-label"), "Space")(), { senal });

  const barra = el("input", {
    type: "range",
    class: "replay-barra",
    min: "0",
    max: "0",
    step: "0.1",
    value: "0",
    "aria-label": t("replay.linea.etiqueta"),
    "data-foco": "replay:barra",
  });
  barra.addEventListener("input", () => buscar(Number(barra.value)), { signal: senal });
  const marcas = el("div", { class: "replay-marcas", "aria-hidden": "true" });
  const pista = el("div", { class: "replay-pista" }, marcas, barra);

  const reloj = el("span", { class: "replay-reloj num" });
  const botonVelocidad = el("button", {
    type: "button",
    class: "boton boton-fantasma replay-velocidad num",
    "data-foco": "replay:velocidad",
    "aria-keyshortcuts": ", .",
  });
  botonVelocidad.addEventListener("click", (evento) => velocidad(evento.shiftKey ? -1 : 1), { signal: senal });
  conGlobo(
    botonVelocidad,
    () => el("span", { class: "globo-con-tecla" }, el("span", { texto: t("replay.linea.velocidad") }), kbd(","), kbd(".")),
    { senal },
  );

  const botonSoloPasos = el("button", {
    type: "button",
    class: "chip replay-solo-pasos",
    "aria-pressed": "false",
    "aria-keyshortcuts": "s",
    "data-foco": "replay:solo-pasos",
    hidden: true,
    texto: t("replay.linea.soloPasos"),
  });
  botonSoloPasos.addEventListener("click", () => soloPasos(), { signal: senal });
  conGlobo(botonSoloPasos, globoConTecla(t("replay.linea.soloPasosAyuda"), "s"), { senal });

  const controles = el("div", { class: "replay-controles" }, botonReproducir, pista, reloj, botonVelocidad, botonSoloPasos);
  const nodo = el("section", { class: "replay-linea", "aria-label": t("replay.linea.etiqueta") }, tira, controles);

  function cuadro(intento, paso, indice) {
    const tono = tonoDelPaso(paso);
    return el(
      "li",
      {},
      el(
        "button",
        { type: "button", tabindex: "-1", class: `replay-cuadro${tono ? ` tono-${tono}` : ""}`, "data-indice": String(indice) },
        paso.captura
          ? el("img", { src: urlDeArchivo(intento.id, paso.captura), alt: "", loading: "lazy", decoding: "async" })
          : el("span", { class: "replay-cuadro-vacio" }),
        el("span", { class: "replay-cuadro-numero num", texto: String(paso.numero) }),
      ),
      paso.carril === "sin-ruta" ? null : el("span", { class: `replay-carril-ruta carril-${paso.carril}` }),
    );
  }

  /** Arma la tira y las marcas de un intento. */
  function pintar(intento, { duracion }) {
    pasos = intento.pasos ?? [];
    total = duracion;
    nodo.hidden = !pasos.length;
    const viewport = intento.viewport ?? { ancho: 1024, alto: 768 };
    tira.style.setProperty("--proporcion", String(viewport.ancho / viewport.alto));
    reemplazar(tira, pasos.map((paso, indice) => cuadro(intento, paso, indice)));
    barra.max = String(Math.max(0.1, Math.round(total * 10) / 10));
    const ventanas = ventanasDePasos(pasos);
    reemplazar(
      marcas,
      ventanas.map((ventana, indice) => {
        const tono = tonoDelPaso(pasos[indice]);
        const marca = el("span", { class: `replay-marca${tono ? ` tono-${tono}` : ""}` });
        marca.style.setProperty("--pos", `${total ? (ventana.desde / total) * 100 : 0}%`);
        return marca;
      }),
    );
    indiceActual = -1;
  }

  function marcar(indice) {
    if (indice === indiceActual) return;
    tira.querySelector('[aria-current="step"]')?.removeAttribute("aria-current");
    marcas.querySelector(".actual")?.classList.remove("actual");
    indiceActual = indice;
    const boton = tira.querySelector(`button[data-indice="${indice}"]`);
    if (boton) {
      boton.setAttribute("aria-current", "step");
      // Desplaza solo la tira, nunca la página.
      const caja = tira.getBoundingClientRect();
      const cuadroActual = boton.getBoundingClientRect();
      if (cuadroActual.left < caja.left) tira.scrollLeft -= caja.left - cuadroActual.left + 16;
      else if (cuadroActual.right > caja.right) tira.scrollLeft += cuadroActual.right - caja.right + 16;
    }
    marcas.children[indice]?.classList.add("actual");
  }

  function ponerTiempo(segundos, indice) {
    const valor = Math.min(total, Math.max(0, segundos));
    if (!barra.matches(":active")) barra.value = String(Math.round(valor * 10) / 10);
    const actual = formatoReloj(valor);
    const fin = formatoReloj(total);
    reloj.textContent = t("replay.linea.reloj", { actual, total: fin });
    barra.setAttribute("aria-valuetext", t("replay.linea.valor", { actual, total: fin, n: pasos[indice]?.numero ?? "" }));
  }

  function ponerReproduciendo(activo) {
    const etiqueta = t(activo ? "replay.linea.pausar" : "replay.linea.reproducir");
    botonReproducir.setAttribute("aria-label", etiqueta);
    botonReproducir.replaceChildren(icono(activo ? "pausar" : "reproducir"));
    botonReproducir.classList.toggle("activo", activo);
  }

  function ponerVelocidad(valor) {
    botonVelocidad.textContent = t("replay.linea.velocidadValor", { v: fmt.numero(valor) });
    botonVelocidad.setAttribute("aria-label", `${t("replay.linea.velocidad")}: ${t("replay.linea.velocidadValor", { v: fmt.numero(valor) })}`);
  }

  function ponerSoloPasos(activo, visible) {
    botonSoloPasos.hidden = !visible;
    botonSoloPasos.setAttribute("aria-pressed", activo ? "true" : "false");
  }

  return { nodo, pintar, marcar, ponerTiempo, ponerReproduciendo, ponerVelocidad, ponerSoloPasos };
}
