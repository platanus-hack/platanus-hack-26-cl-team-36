// Dibujo de la telaraña (diseño §10.5.2): un <svg> para los tramos en el mismo espacio de coordenadas que las
// estaciones (botones HTML posicionados con CSSOM) y las terminales. No decide qué se muestra: recibe la
// distribución, la geometría y funciones de texto, y devuelve los elementos para aislar, contar y animar.

import { el, recortarAlMedio, svg } from "../nucleo/dom.js";
import { icono } from "../nucleo/iconos.js";

const CLASE_DE_RAMA = { exito: "exito", mixto: "mixto", fallo: "fallo", abandono: "abandono", error: "error" };
const CLASE_DE_FINAL = { logrado: "exito", fallido: "fallo", abandonado: "abandono", error: "error" };
const ICONO_DE_RESULTADO = { logrado: "logrado", fallido: "fallido", abandonado: "abandonado", error: "error-herramienta" };
const ORDEN_DE_CAPA = { retroceso: 0, lateral: 0, avance: 1, final: 1, tronco: 2 };
/** Tramos secundarios (vueltas atrás y pasos laterales): finos, tenues y sin partículas, para no tapar el avance. */
const SECUNDARIOS = new Set(["retroceso", "lateral"]);

/** Id de DOM seguro para un tramo (para <mpath href="#…">). */
export const idDomDeTramo = (id) => `telarana-tramo-${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** Ancho del trazo: 1.5 + 1.25·intentos (el de error, fino; los secundarios, más finos para no tapar el avance). */
export function anchoDeTramo(tramo) {
  if (claseDeTramo(tramo) === "error") return 1.5;
  const intentos = Math.max(0, tramo.intentos ?? 0);
  return SECUNDARIOS.has(tramo.tipo) ? 1.25 + 0.5 * intentos : 1.5 + 1.25 * intentos;
}

export function claseDeTramo(tramo) {
  if (tramo.tipo === "final") return CLASE_DE_FINAL[tramo.resultado] ?? "exito";
  return CLASE_DE_RAMA[tramo.resultado] ?? "exito";
}

/**
 * @param {{ escena: HTMLElement, distribucion, geo, paginas: Map<string, object>, ramas: Map<string, object>,
 *   textos: { nombre(pagina), ariaDeEstacion(pagina, estacion, atascos), detalleDeVariantes(n), visitas(n),
 *             etiquetaDeResultado(r), ariaDeTerminal(r, n) },
 *   urlDeCaptura: (captura) => string | null, intentos: Map<string, object>, particulas: boolean }} opciones
 */
export function dibujarEscena({ escena, distribucion, geo, paginas, ramas, textos, urlDeCaptura, intentos, particulas }) {
  const elementos = new Map(); // id → elemento (estaciones, grupos de tramo, terminales)
  const estaciones = new Map();
  const marcasDeAtasco = new Map(); // id → { boton, marca, cuenta, pagina, estacion }
  const tramos = new Map();
  const terminales = new Map();
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
    const clase = claseDeTramo(tramo);
    const idDom = idDomDeTramo(tramo.id);
    const grupo = svg(
      "g",
      { class: `tramo tramo-${tramo.tipo} tramo-${clase}`, "data-tramo": tramo.id },
      svg("path", { class: "tramo-trazo", id: idDom, d, "stroke-width": anchoDeTramo(tramo) }),
      // tabindex −1: Chromium vuelve enfocable con Tab a un elemento SVG que escucha focus (el globo lo hace).
      svg("path", { class: "tramo-golpe", d, tabindex: "-1", focusable: "false" }),
    );
    // Partículas: una por intento que recorrió la rama, del color de cómo terminó ese intento.
    if (particulas && tramo.tipo !== "final" && !SECUNDARIOS.has(tramo.tipo)) {
      const ids = ramas.get(tramo.id)?.intentosIds ?? [];
      const duracion = 2.6;
      ids.forEach((intentoId, indice) => {
        const resultado = intentos.get(intentoId)?.resultado ?? "logrado";
        grupo.append(
          svg(
            "circle",
            { class: `particula particula-${resultado}`, r: 2.5, "data-intento": intentoId },
            svg(
              "animateMotion",
              { dur: `${duracion}s`, begin: `${((indice * duracion) / Math.max(1, ids.length)).toFixed(2)}s`, repeatCount: "indefinite", rotate: "auto" },
              svg("mpath", { href: `#${idDom}` }),
            ),
          ),
        );
      });
    }
    lienzoSvg.append(grupo);
    tramos.set(tramo.id, grupo);
    elementos.set(tramo.id, grupo);
  }
  // El cometa de la historia va en HTML, encima de las estaciones (en el SVG quedaría tapado por ellas).
  const cometa = el("div", { class: "cometa", "aria-hidden": "true" });

  // ── Estaciones ────────────────────────────────────────────────────────
  const nodos = [];
  for (const estacion of distribucion.estaciones) {
    const pagina = paginas.get(estacion.id);
    const posicion = geo.posiciones.get(estacion.id);
    if (!pagina || !posicion) continue;
    const variantes = pagina.variantes?.length ?? 0;
    const enTronco = estacion.tipo === "hito" || (estacion.tipo === "inicio" && distribucion.troncoEsRuta);
    const captura = urlDeCaptura(pagina.captura);
    // Marca de "se trabaron aquí" (oculta hasta marcarAtascos): un triángulo de aviso con cuántos intentos.
    const cuentaDeAtasco = el("span", { class: "estacion-atasco-cuenta" });
    const marcaDeAtasco = el("span", { class: "estacion-atasco", "aria-hidden": "true", hidden: true }, icono("atasco"), cuentaDeAtasco);
    const boton = el(
      "button",
      {
        type: "button",
        class: `estacion estacion-${estacion.tipo}${enTronco ? " estacion-tronco" : ""}`,
        "data-pagina": estacion.id,
        "data-foco": `telarana:pagina:${estacion.id}`,
        "aria-pressed": "false",
        "aria-label": textos.ariaDeEstacion(pagina, estacion, 0),
        estilo: { "--x": `${posicion.x}px`, "--y": `${posicion.y}px` },
      },
      el(
        "span",
        { class: "estacion-punto", "aria-hidden": "true" },
        enTronco && estacion.hito !== null ? el("span", { class: "estacion-numero", texto: String(estacion.hito + 1) }) : null,
        marcaDeAtasco,
      ),
      el(
        "span",
        { class: "estacion-etiqueta", "aria-hidden": "true" },
        captura ? el("img", { class: "estacion-miniatura", src: captura, alt: "", loading: "lazy", decoding: "async", width: 120, height: 75 }) : null,
        el("span", { class: "estacion-nombre", texto: textos.nombre(pagina) }),
        variantes > 1 ? el("span", { class: "estacion-detalle", texto: textos.detalleDeVariantes(variantes) }) : null,
        pagina.url ? el("span", { class: "estacion-url mono", texto: recortarAlMedio(pagina.url.replace(/^https?:\/\//, ""), 36) }) : null,
        el("span", { class: "estacion-visitas", texto: textos.visitas(pagina.visitas ?? 0) }),
      ),
    );
    estaciones.set(estacion.id, boton);
    marcasDeAtasco.set(estacion.id, { boton, marca: marcaDeAtasco, cuenta: cuentaDeAtasco, pagina, estacion });
    elementos.set(estacion.id, boton);
    nodos.push(boton);
  }

  // ── Terminales ────────────────────────────────────────────────────────
  for (const terminal of distribucion.terminales) {
    const posicion = geo.posiciones.get(terminal.id);
    if (!posicion) continue;
    const cuenta = el("span", { class: "terminal-cuenta", texto: String(terminal.total) });
    const nodo = el(
      "div",
      {
        class: `terminal terminal-${terminal.resultado}`,
        "data-terminal": terminal.id,
        role: "img",
        "aria-label": textos.ariaDeTerminal(terminal.resultado, terminal.total),
        estilo: { "--x": `${posicion.x}px`, "--y": `${posicion.y}px` },
      },
      el("span", { class: "terminal-punto", "aria-hidden": "true" }, icono(ICONO_DE_RESULTADO[terminal.resultado])),
      el("span", { class: "terminal-etiqueta", "aria-hidden": "true" }, el("span", { texto: textos.etiquetaDeResultado(terminal.resultado) }), cuenta),
    );
    terminales.set(terminal.id, { nodo, cuenta, resultado: terminal.resultado });
    elementos.set(terminal.id, nodo);
    nodos.push(nodo);
  }

  escena.replaceChildren(lienzoSvg, ...nodos, cometa);

  return {
    svg: lienzoSvg,
    cometa,
    estaciones,
    tramos,
    terminales,
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
    /** Marca las estaciones donde se trabaron intentos (página → cuántos; cambia con el filtro de perfil). */
    marcarAtascos(cuantos) {
      for (const [id, { boton, marca, cuenta, pagina, estacion }] of marcasDeAtasco) {
        const n = cuantos.get(id) ?? 0;
        marca.hidden = n === 0;
        cuenta.textContent = n > 1 ? String(n) : "";
        boton.classList.toggle("estacion-trabada", n > 0);
        boton.setAttribute("aria-label", textos.ariaDeEstacion(pagina, estacion, n));
      }
    },
    /** Pone las cuentas de las terminales (cambian con el filtro de perfil). */
    contarTerminales(totales) {
      for (const [, { nodo, cuenta, resultado }] of terminales) {
        const n = totales[resultado] ?? 0;
        cuenta.textContent = String(n);
        nodo.setAttribute("aria-label", textos.ariaDeTerminal(resultado, n));
        nodo.classList.toggle("terminal-vacia", n === 0);
      }
    },
  };
}
