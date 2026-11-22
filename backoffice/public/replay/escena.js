// La captura del Replay con lo que hizo el usuario encima: el cursor que viaja al punto del clic y deja una onda,
// la página que se desliza al desplazarse, el texto que aparece al escribir, la tecla pulsada y el paso de una
// página a otra (o el salto «volver a»). El plan de cada paso sale de animacion.js; aquí solo se dibuja.
//
// Todo va en un «escenario» del tamaño exacto de la imagen mostrada: el SVG usa las coordenadas del viewport de la
// página (viewBox = viewport), así el cursor y la onda se escalan solos con la captura. Animaciones con la Web
// Animations API (la CSP no admite estilos en línea, pero sí CSSOM y element.animate). Con
// prefers-reduced-motion: nada se mueve, se muestra el estado final con una marca fija.

import { el, svg } from "../nucleo/dom.js";
import { aPorcentaje, curvaDelCursor, DURACIONES, rectanguloDeImagen, textoDeTecla, vectorDeDesplazamiento } from "./animacion.js";

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const SUAVE = "cubic-bezier(.45,0,.2,1)";
const ESPERA_DE_IMAGEN = 1500;

/** Espera a que la imagen esté lista para pintarse (o falle, o pase el tiempo). */
function lista(imagen) {
  if (!imagen.getAttribute("src")) return Promise.resolve();
  const decodificar = imagen.decode ? imagen.decode().catch(() => {}) : Promise.resolve();
  return Promise.race([decodificar, new Promise((listo) => setTimeout(listo, ESPERA_DE_IMAGEN))]);
}

function ponerSrc(imagen, src) {
  if (!src) imagen.removeAttribute("src");
  else if (imagen.getAttribute("src") !== src) imagen.setAttribute("src", src);
}

/**
 * @param {{ t: Function, senal: AbortSignal }} opciones
 * @returns {{ nodo: HTMLElement, imagen: HTMLImageElement, mostrar: Function, detener: Function, ajustar: Function }}
 */
export function crearEscena({ t, senal }) {
  const antes = el("img", { class: "replay-imagen replay-imagen-antes", alt: "", "aria-hidden": "true", decoding: "async" });
  const imagen = el("img", { class: "replay-imagen", alt: "", decoding: "async" });

  const trazo = svg("path", { class: "replay-trazo", d: "" });
  const ondas = svg("g", { class: "replay-ondas" });
  const marca = svg("g", { class: "replay-marca-clic" }, svg("circle", { r: "15", class: "replay-marca-anillo" }), svg("circle", { r: "4", class: "replay-marca-punto" }));
  const cursor = svg(
    "g",
    { class: "replay-cursor" },
    svg("path", { class: "replay-cursor-flecha", transform: "scale(1.55)", d: "M0 0 L0 22 L6 16.5 L10.5 26 L14 24.4 L9.6 15.2 L17 15.2 Z" }),
  );
  const capa = svg("svg", { class: "replay-capa", "aria-hidden": "true", preserveAspectRatio: "none" }, trazo, ondas, marca, cursor);

  const desplazar = el("span", { class: "replay-desplazar", "aria-hidden": "true" });
  const tecleo = el("span", { class: "replay-tecleo", "aria-hidden": "true" }, el("span", { class: "replay-tecleo-texto" }), el("span", { class: "replay-tecleo-cursor" }));
  const tecla = el("kbd", { class: "replay-tecla", "aria-hidden": "true" });
  const rotulo = el("span", { class: "replay-rotulo", "aria-hidden": "true" });

  const escenario = el("div", { class: "replay-escenario" }, antes, imagen, capa, desplazar, tecleo, tecla, rotulo);

  let viewport = { ancho: 1024, alto: 768 };
  let animaciones = [];
  let relojes = []; // [id, resolver]: al limpiar se resuelven, así ninguna espera queda colgada
  let turno = 0;

  // ── Tamaño ──────────────────────────────────────────────────────────────

  /** Ajusta el escenario al rectángulo donde cabe la captura dentro de `caja` (el figure). */
  function ajustar(caja) {
    const rect = rectanguloDeImagen(viewport, { ancho: caja.clientWidth, alto: caja.clientHeight });
    if (!rect) return;
    escenario.style.setProperty("--x", `${rect.x}px`);
    escenario.style.setProperty("--y", `${rect.y}px`);
    escenario.style.setProperty("--ancho", `${rect.ancho}px`);
    escenario.style.setProperty("--alto", `${rect.alto}px`);
  }

  function ponerViewport(nuevo) {
    viewport = { ancho: nuevo?.ancho || 1024, alto: nuevo?.alto || 768 };
    capa.setAttribute("viewBox", `0 0 ${viewport.ancho} ${viewport.alto}`);
  }

  // ── Piezas ──────────────────────────────────────────────────────────────

  const animar = (nodo, cuadros, opciones) => {
    const animacion = nodo.animate(cuadros, { fill: "forwards", easing: SUAVE, ...opciones });
    animaciones.push(animacion);
    return animacion.finished.catch(() => {});
  };
  const esperar = (ms) => new Promise((listo) => relojes.push([setTimeout(listo, ms), listo]));
  const mover = (nodo, [x, y]) => nodo.setAttribute("transform", `translate(${x} ${y})`);
  const ubicar = (nodo, punto) => {
    const p = aPorcentaje(punto, viewport);
    nodo.style.setProperty("--px", `${p?.x ?? 50}%`);
    nodo.style.setProperty("--py", `${p?.y ?? 50}%`);
    nodo.classList.toggle("sin-punto", !p);
    // Cerca de un borde, la pieza se alinea hacia adentro para no salirse de la captura.
    nodo.dataset.lado = !p ? "centro" : p.x > 70 ? "derecha" : p.x < 30 ? "izquierda" : "centro";
  };

  /** Deja todo sin animación ni piezas a la vista. */
  function limpiar() {
    turno += 1;
    for (const animacion of animaciones) animacion.cancel();
    for (const [reloj, listo] of relojes) {
      clearTimeout(reloj);
      listo();
    }
    animaciones = [];
    relojes = [];
    for (const pieza of [cursor, marca, trazo, desplazar, tecleo, tecla, rotulo]) pieza.classList.remove("visible");
    antes.classList.remove("visible");
    tecleo.classList.remove("escribiendo");
    ondas.replaceChildren();
    trazo.setAttribute("d", "");
  }

  function ponerMarca(punto) {
    mover(marca, punto);
    marca.classList.add("visible");
  }

  function ponerTecleo(plan, texto) {
    ubicar(tecleo, plan.hasta);
    tecleo.firstChild.textContent = texto;
    tecleo.classList.add("visible");
  }

  /** Estado final del paso, sin movimiento: marca fija en el punto, el texto escrito o la tecla. */
  function estadoFinal(plan) {
    if (!plan) return;
    if ((plan.tipo === "clic" || plan.tipo === "doble_clic") && plan.hasta) {
      ponerMarca(plan.hasta);
      mover(cursor, plan.hasta);
      cursor.classList.add("visible");
    } else if (plan.tipo === "escribir") ponerTecleo(plan, plan.texto);
    else if (plan.tipo === "tecla") {
      tecla.textContent = textoDeTecla(plan.tecla);
      tecla.classList.add("visible");
    } else if (plan.tipo === "desplazar") {
      ubicar(desplazar, plan.hasta);
      desplazar.dataset.direccion = plan.direccion;
      desplazar.classList.add("visible", "quieto");
    }
    if (plan.tipo === "volver" && plan.destino) ponerRotulo("volver", t("replay.animacion.volver", { pagina: plan.destino }));
    else if (plan.cambio === "pagina" && plan.destino) ponerRotulo("pagina", plan.destino);
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  async function clic(plan, d, sigue) {
    const { puntos } = curvaDelCursor(plan.desde, plan.hasta);
    mover(cursor, [0, 0]);
    cursor.classList.add("visible");
    trazo.setAttribute("d", `M${puntos.map((p) => p.join(" ")).join(" L")}`);
    const largo = trazo.getTotalLength?.() || 1;
    trazo.style.setProperty("stroke-dasharray", `${largo}`);
    trazo.classList.add("visible");
    // La estela se dibuja con el cursor y se apaga después; la pulsación empieza apenas llega el cursor.
    animar(trazo, [{ strokeDashoffset: largo, opacity: 0.9 }, { strokeDashoffset: 0, opacity: 0.9, offset: 0.7 }, { strokeDashoffset: 0, opacity: 0 }], {
      duration: d.viaje + 350,
    });
    await animar(cursor, puntos.map(([x, y]) => ({ transform: `translate(${x}px, ${y}px)` })), { duration: d.viaje });
    if (!sigue()) return;
    mover(cursor, plan.hasta);
    cursor.getAnimations().forEach((a) => a.cancel());
    animar(cursor, [{ transform: `translate(${plan.hasta[0]}px, ${plan.hasta[1]}px) scale(1)` }, { transform: `translate(${plan.hasta[0]}px, ${plan.hasta[1]}px) scale(.82)` }, { transform: `translate(${plan.hasta[0]}px, ${plan.hasta[1]}px) scale(1)` }], {
      duration: 220,
      fill: "none",
    });
    const veces = plan.tipo === "doble_clic" ? 2 : 1;
    for (let i = 0; i < veces; i += 1) {
      const onda = svg("circle", { r: "40", class: "replay-onda" });
      const grupo = svg("g", { transform: `translate(${plan.hasta[0]} ${plan.hasta[1]})` }, onda);
      ondas.append(grupo);
      animar(onda, [{ transform: "scale(.15)", opacity: 1 }, { transform: "scale(1.35)", opacity: 0 }], { duration: d.pulso + 260, delay: i * 140, easing: "cubic-bezier(.2,.7,.3,1)" });
    }
    ponerMarca(plan.hasta);
    animar(marca, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    await esperar(d.pulso);
  }

  async function escribir(plan, d, sigue) {
    if (plan.hasta) {
      mover(cursor, plan.hasta);
      cursor.classList.add("visible");
    }
    ponerTecleo(plan, "");
    tecleo.classList.add("escribiendo");
    animar(tecleo, [{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 160 });
    const letras = [...plan.texto];
    const total = Math.min(d.escribirMax, Math.max(1, letras.length) * d.escribirPorLetra);
    const inicio = performance.now();
    await new Promise((listo) => {
      const cuadro = () => {
        if (!sigue()) return listo();
        const hechas = Math.min(letras.length, Math.ceil(((performance.now() - inicio) / total) * letras.length));
        tecleo.firstChild.textContent = letras.slice(0, hechas).join("");
        if (hechas >= letras.length) return listo();
        requestAnimationFrame(cuadro);
      };
      requestAnimationFrame(cuadro);
    });
    await esperar(d.fundido);
    tecleo.classList.remove("escribiendo");
  }

  async function pulsarTecla(plan, d) {
    tecla.textContent = textoDeTecla(plan.tecla);
    tecla.classList.add("visible");
    await animar(
      tecla,
      [
        { opacity: 0, translate: "0 10px", scale: "0.7" },
        { opacity: 1, translate: "0 0", scale: "1.06", offset: 0.45 },
        { opacity: 1, translate: "0 3px", scale: "0.96", offset: 0.7 },
        { opacity: 1, translate: "0 0", scale: "1" },
      ],
      { duration: d.tecla },
    );
  }

  // ── De la captura de antes a la de después ──────────────────────────────

  /** Muestra el rótulo de arriba («→ sitio/ruta» o «↩ Volver a «…»»). */
  function ponerRotulo(tipo, texto, d) {
    rotulo.textContent = texto;
    rotulo.dataset.tipo = tipo;
    rotulo.classList.add("visible");
    if (d) animar(rotulo, [{ opacity: 0, translate: "0 -8px" }, { opacity: 1, translate: "0 0" }], { duration: Math.min(260, d.cambio) });
  }

  // Las capturas no se funden entre sí al moverse (se vería doble): la de después entra opaca, encima, y la de
  // antes se oscurece debajo. Solo el cambio dentro de la misma página es un fundido corto.
  async function cambiar(plan, d) {
    const cambio = plan.tipo === "desplazar" ? "desplazar" : plan.cambio;
    if (!cambio) return;
    antes.classList.add("visible");
    if (cambio === "desplazar") {
      // La página como una tira: la captura de después está justo a continuación y las dos corren juntas.
      const [dx, dy] = vectorDeDesplazamiento(plan.direccion);
      ubicar(desplazar, plan.hasta);
      desplazar.dataset.direccion = plan.direccion;
      desplazar.classList.remove("quieto");
      desplazar.classList.add("visible");
      animar(desplazar, [{ opacity: 0, scale: "0.6" }, { opacity: 1, scale: "1", offset: 0.25 }, { opacity: 1, scale: "1" }], { duration: d.desplazar });
      await Promise.all([
        animar(antes, [{ transform: "translate(0, 0)" }, { transform: `translate(${dx * 100}%, ${dy * 100}%)` }], { duration: d.desplazar }),
        animar(imagen, [{ transform: `translate(${-dx * 100}%, ${-dy * 100}%)` }, { transform: "translate(0, 0)" }], { duration: d.desplazar }),
      ]);
      desplazar.classList.add("quieto");
    } else if (cambio === "pagina" || cambio === "volver") {
      // Otra página entra desde la derecha (avanzar); «volver a» entra desde la izquierda, con su rótulo ámbar.
      const lado = cambio === "volver" ? -1 : 1;
      if (cambio === "volver" && plan.destino) ponerRotulo("volver", t("replay.animacion.volver", { pagina: plan.destino }), d);
      else if (plan.destino) ponerRotulo("pagina", plan.destino, d);
      await Promise.all([
        animar(
          antes,
          [
            { transform: "translateX(0) scale(1)", filter: "brightness(1)" },
            { transform: `translateX(${-lado * 12}%) scale(.94)`, filter: "brightness(.35)" },
          ],
          { duration: d.cambio },
        ),
        animar(imagen, [{ transform: `translateX(${lado * 100}%)` }, { transform: "translateX(0)" }], { duration: d.cambio, easing: "cubic-bezier(.3,0,.1,1)" }),
      ]);
    } else {
      await animar(imagen, [{ opacity: 0 }, { opacity: 1 }], { duration: d.fundido, easing: "linear" });
    }
    antes.classList.remove("visible");
  }

  /**
   * Muestra un paso. `modo`: "completo" (al reproducir), "corto" (al elegirlo) o null (sin animar).
   * Resuelve cuando termina la animación, o antes si otra llamada la reemplazó.
   * @param {{ plan: object|null, srcAntes: string, srcDespues: string, viewport: object, modo: "completo"|"corto"|null }} datos
   */
  async function mostrar({ plan, srcAntes, srcDespues, viewport: nuevo, modo }) {
    limpiar();
    const mio = turno;
    const sigue = () => mio === turno && !senal.aborted;
    ponerViewport(nuevo);
    ponerSrc(imagen, srcDespues);
    const animado = Boolean(modo && plan && srcAntes && !movimientoReducido());
    if (!animado) {
      estadoFinal(plan);
      return;
    }
    ponerSrc(antes, srcAntes);
    antes.classList.add("visible");
    // La captura de después queda oculta (opacidad 0) hasta su turno.
    const ocultar = imagen.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: "forwards" });
    animaciones.push(ocultar);
    await Promise.all([lista(antes), lista(imagen)]);
    if (!sigue()) return;

    const d = DURACIONES[modo] ?? DURACIONES.corto;
    if (plan.tipo === "clic" || plan.tipo === "doble_clic") await clic(plan, d, sigue);
    else if (plan.tipo === "escribir") await escribir(plan, d, sigue);
    else if (plan.tipo === "tecla") await pulsarTecla(plan, d);
    if (!sigue()) return;
    ocultar.cancel();
    await cambiar(plan, d);
  }

  return { nodo: escenario, imagen, mostrar, detener: limpiar, ajustar };
}
