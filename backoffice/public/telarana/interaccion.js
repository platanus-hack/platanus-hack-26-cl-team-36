// Interacción con el lienzo de la telaraña viva: apuntar (globo y resaltado), elegir un agente, fijar una página o
// un tramo, arrastrar para mover, zoom con botones o ⌘/Ctrl + rueda, y flechas con el foco en el lienzo.

import { el, reemplazar } from "../nucleo/dom.js";
import { RESULTADO_DE_FINAL } from "./modelo.js";
import { acotar } from "./layout.js";

const PASO_DE_PAN = 60;
const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * @param {object} E   el estado de la vista (viva.js)
 * @param {{ lienzo: HTMLElement, globo: HTMLElement, zoom: HTMLElement, etiquetas: object, senal: AbortSignal,
 *           t: Function, nombre: (clave: string) => string, nombreDeAgente: (a: object) => string,
 *           alElegir: (run: string | null) => void, alFijar: (foco: object) => void, alSoltar: () => void }} opciones
 */
export function conectarInteraccion(E, { lienzo, globo, zoom, etiquetas, senal, t, nombre, nombreDeAgente, alElegir, alFijar, alSoltar }) {
  let arrastre = null;
  const opciones = { signal: senal };

  function aMundo(ev) {
    const r = lienzo.getBoundingClientRect();
    const sx = ev.clientX - r.left;
    const sy = ev.clientY - r.top;
    return { x: (sx - E.W / 2) / E.V.z + E.V.cx, y: (sy - E.H / 2) / E.V.z + E.V.cy, sx, sy };
  }

  /** Lo que hay bajo el puntero: un agente, una página (o su nombre) o un tramo. */
  function buscar(p) {
    const u = 1 / E.V.z;
    let mejor = null;
    let dist = 9 * u;
    for (const [run, v] of E.vis.agentes) {
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < dist) {
        dist = d;
        mejor = { t: "a", k: run };
      }
    }
    if (mejor) return mejor;
    dist = 14 * u;
    for (const [clave, v] of E.vis.nodos) {
      if (E.anim < v.nace) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < dist) {
        dist = d;
        mejor = { t: "n", k: clave };
      }
    }
    if (mejor) return mejor;
    const porNombre = etiquetas.nombreEn(p.sx, p.sy);
    if (porNombre) return { t: "n", k: porNombre };
    dist = 7 * u;
    for (const [clave, v] of E.vis.tramos) {
      for (let i = 0; i < v.np - 1; i++) {
        const ax = v.pts[i * 2];
        const ay = v.pts[i * 2 + 1];
        const dx = v.pts[i * 2 + 2] - ax;
        const dy = v.pts[i * 2 + 3] - ay;
        const l2 = dx * dx + dy * dy || 1;
        const q = acotar(((p.x - ax) * dx + (p.y - ay) * dy) / l2, 0, 1);
        const d = Math.hypot(ax + dx * q - p.x, ay + dy * q - p.y) - (v.w / 2) * u;
        if (d < dist) {
          dist = d;
          mejor = { t: "e", k: clave };
        }
      }
    }
    return mejor;
  }

  function contenidoDelGlobo(h) {
    if (h.t === "a") {
      const a = E.m.agentes.get(h.k);
      const estado = a.final ? t(`comun.resultado.${RESULTADO_DE_FINAL[a.final]}`) : a.atascado ? t("telarana.estado.atascado") : t("telarana.estado.enCurso");
      return [el("b", { texto: nombreDeAgente(a) }), el("br"), t("telarana.globo.agente", { estado })];
    }
    if (h.t === "n") {
      const n = E.m.nodos.get(h.k);
      if (n.term) return [el("b", { texto: t(`comun.resultado.${RESULTADO_DE_FINAL[n.term]}`) }), el("br"), t("telarana.globo.final", { n: n.count })];
      const partes = [t("telarana.globo.pasaron", { n: n.pasaron }), n.ruta >= 0 ? t("telarana.globo.hito", { n: n.ruta + 1 }) : t("telarana.globo.fuera")];
      if (n.atascos) partes.push(t("telarana.globo.atascos", { n: n.atascos }));
      return [el("b", { texto: nombre(h.k) }), el("br"), partes.join(" · ")];
    }
    const e = E.m.tramos.get(h.k);
    const d = E.finTramos.get(e.clave);
    const partes = [t("telarana.globo.intentos", { n: e.n })];
    if (d && e.tipo !== "b" && !e.term) partes.push(t("telarana.globo.lograron", { ok: d.ok, de: d.hechos }));
    if (e.tipo === "b") partes.push(t("telarana.globo.volvieron"));
    return [el("b", { texto: `${nombre(e.a)} ${e.tipo === "b" ? "↩" : "→"} ${nombre(e.b)}` }), el("br"), partes.join(" · ")];
  }

  function mostrarGlobo(h, p) {
    if (!h) {
      globo.hidden = true;
      return;
    }
    reemplazar(globo, contenidoDelGlobo(h));
    globo.hidden = false;
    globo.style.left = `${Math.min(p.sx + 14, E.W - globo.offsetWidth - 8)}px`;
    globo.style.top = `${Math.min(p.sy + 14, E.H - globo.offsetHeight - 8)}px`;
  }

  const quitarApuntado = () => {
    if (E.hover && !E.hover.panel) E.hover = null;
    globo.hidden = true;
  };

  lienzo.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.button || ev.target.closest(".tv-zoom")) return;
      arrastre = { x: ev.clientX, y: ev.clientY, cx: E.V.cx, cy: E.V.cy, movio: false };
    },
    opciones,
  );
  addEventListener(
    "pointermove",
    (ev) => {
      if (arrastre) {
        const dx = ev.clientX - arrastre.x;
        const dy = ev.clientY - arrastre.y;
        if (!arrastre.movio && Math.hypot(dx, dy) > 5) {
          arrastre.movio = true;
          E.V.auto = false;
          lienzo.classList.add("tv-arrastrando");
          globo.hidden = true;
        }
        if (arrastre.movio) {
          E.V.cx = arrastre.cx - dx / E.V.z;
          E.V.cy = arrastre.cy - dy / E.V.z;
          return;
        }
      }
      if (!lienzo.contains(ev.target) || ev.target.closest(".tv-zoom")) {
        if (E.hover && !E.hover.panel) quitarApuntado();
        return;
      }
      const p = aMundo(ev);
      const h = buscar(p);
      lienzo.classList.toggle("tv-apunta", !!h);
      E.hover = h && h.t !== "a" ? h : null;
      mostrarGlobo(h, p);
    },
    opciones,
  );
  addEventListener(
    "pointerup",
    (ev) => {
      if (arrastre && !arrastre.movio && lienzo.contains(ev.target) && !ev.target.closest(".tv-zoom")) {
        const h = buscar(aMundo(ev));
        if (h?.t === "a") alElegir(E.elegido === h.k ? null : h.k);
        else if (h) alFijar(h);
        else alSoltar();
      }
      arrastre = null;
      lienzo.classList.remove("tv-arrastrando");
    },
    opciones,
  );
  lienzo.addEventListener("pointerleave", () => !arrastre && quitarApuntado(), opciones);
  lienzo.addEventListener(
    "wheel",
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const p = aMundo(ev);
      const z = acotar(E.V.z * Math.exp(-ev.deltaY * 0.01), 0.25, 3);
      E.V.auto = false;
      E.V.cx = p.x - (p.sx - E.W / 2) / z;
      E.V.cy = p.y - (p.sy - E.H / 2) / z;
      E.V.z = z;
    },
    { passive: false, signal: senal },
  );
  lienzo.addEventListener(
    "keydown",
    (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.target !== lienzo) return;
      const flechas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const mov = flechas[ev.key];
      if (!mov) return;
      ev.preventDefault();
      E.V.auto = false;
      E.V.cx += (mov[0] * PASO_DE_PAN) / E.V.z;
      E.V.cy += (mov[1] * PASO_DE_PAN) / E.V.z;
    },
    opciones,
  );
  zoom.addEventListener(
    "click",
    (ev) => {
      const boton = ev.target.closest("button[data-z]");
      if (boton) camara[boton.dataset.z]();
    },
    opciones,
  );

  const camara = {
    acercar: () => {
      E.V.auto = false;
      E.V.z = acotar(E.V.z * 1.25, 0.25, 3);
    },
    alejar: () => {
      E.V.auto = false;
      E.V.z = acotar(E.V.z * 0.8, 0.25, 3);
    },
    ajustar: () => {
      E.V.auto = true;
    },
    /**
     * La cámara se desliza (400 ms) al encuadre de esas páginas, o de toda la telaraña con null. Con movimiento
     * reducido, salta.
     */
    encuadrar: (claves) => {
      E.V.marco = claves?.length ? new Set(claves) : null;
      E.V.auto = true;
      E.V.viaje = movimientoReducido() ? null : { t0: performance.now(), z: E.V.z, cx: E.V.cx, cy: E.V.cy };
      if (!E.V.viaje) E.V.init = false;
    },
  };
  return camara;
}
