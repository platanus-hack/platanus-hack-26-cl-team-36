// Visor del Replay (diseño §10.6.1): la captura del paso en cuatro modos (Después, Antes, Deslizar, Superponer),
// el anillo del clic tomado de "Antes", "mantén B" para mirar "Antes" y, si el intento tiene video.webm, el video
// en el mismo lugar. Las dos capturas están siempre apiladas; el modo solo cambia qué se ve (CSS), así cambiar de
// modo no recarga nada. Los valores dinámicos van por CSSOM (--corte, --opacidad, --clic-x, --proporcion…).

import { nombreDePagina } from "../datos/textos.js";
import { el, recortarAlMedio, reemplazar } from "../nucleo/dom.js";
import { posicionDelClic } from "./sincronia.js";

export const MODOS = ["despues", "antes", "deslizar", "superponer"];

/**
 * @param {{ t: Function, fmt: object, urlDeArchivo: (intentoId: string, archivo: string) => string, senal: AbortSignal }} opciones
 */
export function crearVisor({ t, fmt, urlDeArchivo, senal }) {
  const valores = { deslizar: 50, superponer: 50 };
  let modo = "despues";
  let mirando = false;
  let intentoActual = null;
  const precargas = [];

  const antes = el("img", { class: "replay-captura replay-captura-antes", alt: "", decoding: "async" });
  const despues = el("img", { class: "replay-captura replay-captura-despues", alt: "", decoding: "async" });
  const numeroDelClic = el("span", { class: "replay-clic-numero num" });
  const clic = el("div", { class: "replay-clic", hidden: true }, numeroDelClic);
  const sinCaptura = el("p", { class: "replay-sin-captura texto-3", texto: t("replay.visor.sinCaptura") });
  const lienzo = el("div", { class: "replay-lienzo", "data-modo": modo }, antes, despues, clic, sinCaptura);

  for (const [imagen, clase] of [[antes, "falta-antes"], [despues, "falta-despues"]]) {
    imagen.addEventListener("error", () => imagen.getAttribute("src") && lienzo.classList.add(clase), { signal: senal });
    imagen.addEventListener("load", () => lienzo.classList.remove(clase), { signal: senal });
  }

  const rango = el("input", {
    type: "range",
    class: "replay-rango",
    min: "0",
    max: "100",
    step: "1",
    value: "50",
    "data-foco": "replay:rango",
  });
  const control = el("div", { class: "replay-control-comparar", hidden: true }, rango);
  rango.addEventListener(
    "input",
    () => {
      if (modo !== "deslizar" && modo !== "superponer") return;
      valores[modo] = Number(rango.value);
      aplicarValor();
    },
    { signal: senal },
  );

  const video = el("video", { class: "replay-video", preload: "metadata", playsinline: "", muted: "", hidden: true });
  video.muted = true;

  const leyenda = el("p", { class: "replay-leyenda" });
  const marco = el("figure", { class: "replay-marco" }, el("div", { class: "replay-medida" }, lienzo, video), control, leyenda);

  function aplicarValor() {
    lienzo.style.setProperty("--corte", `${valores.deslizar}%`);
    lienzo.style.setProperty("--opacidad", String(valores.superponer / 100));
    rango.setAttribute("aria-valuetext", `${valores[modo] ?? 50}%`);
  }
  aplicarValor();

  function ponerModo(nuevo) {
    modo = MODOS.includes(nuevo) ? nuevo : "despues";
    lienzo.dataset.modo = mirando ? "antes" : modo;
    const conRango = modo === "deslizar" || modo === "superponer";
    control.hidden = !conRango;
    if (conRango) {
      rango.value = String(valores[modo]);
      rango.setAttribute("aria-label", t(modo === "deslizar" ? "replay.visor.deslizarEtiqueta" : "replay.visor.superponerEtiqueta"));
      aplicarValor();
    }
  }

  function mirarAntes(activo) {
    mirando = !!activo;
    lienzo.classList.toggle("mirando-antes", mirando);
    lienzo.dataset.modo = mirando ? "antes" : modo;
  }

  function ponerFuente(imagen, archivo, alt) {
    const src = archivo ? urlDeArchivo(intentoActual.id, archivo) : "";
    if (imagen.getAttribute("src") !== src) {
      if (src) imagen.setAttribute("src", src);
      else imagen.removeAttribute("src");
    }
    imagen.alt = alt;
  }

  function precargar(intento, indices) {
    precargas.length = 0;
    for (const i of indices) {
      const archivo = intento.pasos[i]?.captura;
      if (!archivo) continue;
      const imagen = new Image();
      imagen.decoding = "async";
      imagen.src = urlDeArchivo(intento.id, archivo);
      precargas.push(imagen);
    }
  }

  /** Muestra el paso `indice` del intento (o la pantalla inicial si el intento no tiene pasos). */
  function mostrar({ intento, indice, tanda }) {
    intentoActual = intento;
    const viewport = intento.viewport ?? { ancho: 1024, alto: 768 };
    marco.style.setProperty("--proporcion", String(viewport.ancho / viewport.alto));
    marco.style.setProperty("--ancho-captura", String(viewport.ancho));
    const paso = intento.pasos?.[indice] ?? null;

    if (!paso) {
      const inicio = intento.inicio?.captura ?? null;
      lienzo.classList.toggle("falta-despues", !inicio);
      lienzo.classList.remove("falta-antes");
      ponerFuente(despues, inicio, t("replay.visor.altInicio"));
      ponerFuente(antes, inicio, t("replay.visor.altInicio"));
      clic.hidden = true;
      leyenda.replaceChildren(intento.inicio?.url ? el("span", { class: "mono replay-url", title: intento.inicio.url, texto: recortarAlMedio(intento.inicio.url, 60) }) : "");
      return;
    }

    if (!paso.capturaAntes) lienzo.classList.add("falta-antes");
    if (!paso.captura) lienzo.classList.add("falta-despues");
    ponerFuente(antes, paso.capturaAntes, t("replay.visor.altAntes", { n: paso.numero }));
    ponerFuente(despues, paso.captura, t("replay.visor.altDespues", { n: paso.numero }));

    const posicion = posicionDelClic(paso, viewport);
    clic.hidden = !posicion;
    if (posicion) {
      clic.style.setProperty("--clic-x", `${posicion.x}%`);
      clic.style.setProperty("--clic-y", `${posicion.y}%`);
      numeroDelClic.textContent = String(paso.numero);
      clic.setAttribute("role", "img");
      clic.setAttribute("aria-label", t("replay.visor.clic", { n: paso.numero }));
      // El pulso se repite en cada paso: se reinicia la animación quitando y poniendo la clase.
      clic.classList.remove("pulso");
      void clic.offsetWidth;
      clic.classList.add("pulso");
    }

    const pagina = (tanda?.telarana?.paginas ?? []).find((cada) => cada.id === paso.pagina) ?? null;
    const crudo = paso.coordenadas ? `${paso.accion} (${paso.coordenadas.join(", ")})` : paso.accion;
    // reemplazar() omite lo que falta (replaceChildren(null) escribiría "null").
    reemplazar(
      leyenda,
      pagina ? el("span", { class: "replay-pagina", texto: nombreDePagina(pagina, t) }) : null,
      paso.url ? el("span", { class: "mono replay-url", title: paso.url, texto: recortarAlMedio(paso.url, 60) }) : null,
      typeof paso.segundos === "number"
        ? el("span", { class: "replay-momento", title: t("replay.visor.accionCruda", { accion: crudo ?? "" }), texto: t("replay.visor.aLos", { tiempo: fmt.duracion(paso.segundos) }) })
        : null,
    );
    precargar(intento, [indice + 1, indice + 2]);
  }

  /** Cambia entre capturas y video. Con video, `src` se pone una sola vez por intento. */
  function ponerVideo(activo, { src = null, etiqueta = "" } = {}) {
    marco.classList.toggle("con-video", activo);
    video.hidden = !activo;
    lienzo.hidden = activo;
    control.hidden = activo || !(modo === "deslizar" || modo === "superponer");
    if (activo && src && video.getAttribute("src") !== src) {
      video.setAttribute("src", src);
      video.setAttribute("aria-label", etiqueta);
    }
    if (!activo) video.pause();
  }

  return { nodo: marco, video, ponerModo, mirarAntes, mostrar, ponerVideo, modo: () => modo };
}
