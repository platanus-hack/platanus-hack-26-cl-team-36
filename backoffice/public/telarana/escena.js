// Dibujo de la telaraña (diseño §10.5.2): un <svg> para los tramos en el mismo espacio de coordenadas que las
// estaciones (botones HTML posicionados con CSSOM). No decide qué se muestra: recibe la distribución, la geometría y
// funciones de texto, y devuelve los elementos para aislar y marcar.
//
// Cada tramo es de uno de dos caminos: el camino feliz (la ruta recomendada, que llega a la meta directo) o el camino
// ineficiente (desvíos, vueltas atrás, pasos laterales y los caminos que dan vueltas o no llegan).

import { el, recortarAlMedio, svg } from "../nucleo/dom.js";

export const CAMINOS = ["feliz", "ineficiente"];
// El camino feliz va encima de todo; las curvas (vueltas y laterales), debajo de los avances.
const ORDEN_DE_CAPA = { retroceso: 0, lateral: 0, avance: 1, tronco: 2 };

/** Camino de un tramo: "feliz" si es un tramo de la ruta recomendada; si no (o si no hay ruta), "ineficiente". */
export function caminoDeTramo(tramo, troncoEsRuta) {
  return troncoEsRuta && tramo.tipo === "tronco" ? "feliz" : "ineficiente";
}

/** Ancho del trazo: el camino feliz, 4 px; el ineficiente, 1 + 0.4 px por intento distinto que lo recorrió, hasta 4. */
export function anchoDeTramo(tramo, camino) {
  if (camino === "feliz") return 4;
  return Math.round(Math.min(4, 1 + 0.4 * Math.max(0, tramo.intentos ?? 0)) * 100) / 100;
}

/**
 * @param {{ escena: HTMLElement, distribucion, geo, paginas: Map<string, object>,
 *   textos: { nombre(pagina), etiqueta?(pagina) (lo que se ve: lo que distingue a la página, adelante),
 *             ariaDeEstacion(pagina, estacion), detalleDeVariantes(n), visitas(n) },
 *   urlDeCaptura: (captura) => string | null }} opciones
 */
export function dibujarEscena({ escena, distribucion, geo, paginas, textos, urlDeCaptura }) {
  const elementos = new Map(); // id → elemento (estaciones y grupos de tramo)
  const estaciones = new Map();
  const tramos = new Map();
  const { caja } = geo;

  // ── Tramos ────────────────────────────────────────────────────────────
  const lienzoSvg = svg("svg", {
    class: "telarana-tramos",
    viewBox: `${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`,
    width: caja.ancho,
    height: caja.alto,
    "aria-hidden": "true",
    focusable: "false",
    estilo: { "--x": `${caja.x}px`, "--y": `${caja.y}px` },
  });
  const ordenados = [...distribucion.tramos].sort((a, b) => ORDEN_DE_CAPA[a.tipo] - ORDEN_DE_CAPA[b.tipo]);
  for (const tramo of ordenados) {
    const d = geo.caminos.get(tramo.id);
    if (!d) continue;
    const camino = caminoDeTramo(tramo, distribucion.troncoEsRuta);
    const grupo = svg(
      "g",
      { class: `tramo tramo-${camino}`, "data-tramo": tramo.id, "data-camino": camino },
      svg("path", { class: "tramo-trazo", d, "stroke-width": anchoDeTramo(tramo, camino) }),
      // tabindex −1: Chromium vuelve enfocable con Tab a un elemento SVG que escucha focus (el globo lo hace).
      svg("path", { class: "tramo-golpe", d, tabindex: "-1", focusable: "false" }),
    );
    lienzoSvg.append(grupo);
    tramos.set(tramo.id, grupo);
    elementos.set(tramo.id, grupo);
  }

  // ── Estaciones ────────────────────────────────────────────────────────
  const nodos = [];
  for (const estacion of distribucion.estaciones) {
    const pagina = paginas.get(estacion.id);
    const posicion = geo.posiciones.get(estacion.id);
    if (!pagina || !posicion) continue;
    const variantes = pagina.variantes?.length ?? 0;
    const enTronco = estacion.tipo === "hito" || (estacion.tipo === "inicio" && distribucion.troncoEsRuta);
    const captura = urlDeCaptura(pagina.captura);
    const boton = el(
      "button",
      {
        type: "button",
        class: `estacion estacion-${estacion.tipo}${enTronco ? " estacion-tronco" : ""}`,
        "data-pagina": estacion.id,
        "data-foco": `telarana:pagina:${estacion.id}`,
        "aria-pressed": "false",
        "aria-label": textos.ariaDeEstacion(pagina, estacion),
        estilo: { "--x": `${posicion.x}px`, "--y": `${posicion.y}px` },
      },
      el(
        "span",
        { class: "estacion-punto", "aria-hidden": "true" },
        enTronco && estacion.hito !== null ? el("span", { class: "estacion-numero", texto: String(estacion.hito + 1) }) : null,
      ),
      el(
        "span",
        { class: "estacion-etiqueta", "aria-hidden": "true" },
        captura ? el("img", { class: "estacion-miniatura", src: captura, alt: "", loading: "lazy", decoding: "async", width: 120, height: 75 }) : null,
        el("span", { class: "estacion-nombre", texto: textos.etiqueta?.(pagina) ?? textos.nombre(pagina) }),
        variantes > 1 ? el("span", { class: "estacion-detalle", texto: textos.detalleDeVariantes(variantes) }) : null,
        pagina.url ? el("span", { class: "estacion-url mono", texto: recortarAlMedio(pagina.url.replace(/^https?:\/\//, ""), 36) }) : null,
        el("span", { class: "estacion-visitas", texto: textos.visitas(pagina.visitas ?? 0) }),
      ),
    );
    estaciones.set(estacion.id, boton);
    elementos.set(estacion.id, boton);
    nodos.push(boton);
  }

  escena.replaceChildren(lienzoSvg, ...nodos);

  return {
    svg: lienzoSvg,
    estaciones,
    tramos,
    /** Aísla `ids` (Set) atenuando el resto; null quita el aislamiento. Nunca saca nada del mapa. */
    aislar(ids) {
      escena.classList.toggle("aislando", !!ids);
      for (const [id, elemento] of elementos) elemento.classList.toggle("activo", !!ids && ids.has(id));
    },
    /** Marca la estación elegida (aria-pressed) y desmarca el resto. */
    marcarEleccion(id) {
      for (const [clave, boton] of estaciones) {
        const elegida = clave === id;
        if ((boton.getAttribute("aria-pressed") === "true") !== elegida) boton.setAttribute("aria-pressed", String(elegida));
      }
    },
  };
}
