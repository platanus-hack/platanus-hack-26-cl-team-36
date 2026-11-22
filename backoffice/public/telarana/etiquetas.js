// Etiquetas HTML sobre el lienzo: nombres de páginas (truncados para no pisarse), número de hito, marca de atasco,
// finales con su cuenta y «paso n» sobre cada anillo. Las posiciones van por CSSOM (la CSP no admite estilos en
// línea en el HTML).

import { el } from "../nucleo/dom.js";
import { icono } from "../nucleo/iconos.js";
import { RESULTADO_DE_FINAL, anilloFinal } from "./modelo.js";
import { ETIQUETA, acotar, radio } from "./layout.js";

const CLASE_DE_FINAL = { success: "ok", failed: "mal", abandoned: "neutro", unmeasured: "neutro", error: "neutro" };
const choca = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ponerOpacidad = (nodo, valor) => {
  const texto = String(valor);
  if (nodo.style.opacity !== texto) nodo.style.opacity = texto;
};
const ponerTexto = (nodo, valor) => {
  const texto = String(valor);
  if (nodo.textContent !== texto) nodo.textContent = texto;
};

/**
 * @param {HTMLElement} capa
 * @param {{ t: Function, nombre: (n: object) => string }} textos
 */
export function crearEtiquetas(capa, { t, nombre }) {
  const etiquetas = new Map();
  const anillos = [];
  const medidor = document.createElement("canvas").getContext("2d");
  const fuente = getComputedStyle(capa).fontFamily;
  document.fonts?.ready.then(() => {
    for (const e of etiquetas.values()) e.ancho = 0;
  });

  function ancho(e) {
    if (!e.ancho) {
      medidor.font = `${e.n.ruta >= 0 ? 500 : 400} 12px ${fuente}`;
      e.ancho = Math.ceil(medidor.measureText(e.nom.textContent).width) + 8;
    }
    return e.ancho;
  }

  function crear(n) {
    const e = { n, ancho: 0, sx: 0, sy: 0 };
    if (n.term) {
      e.cuenta = el("i", { texto: "0" });
      e.raiz = el("div", { class: `tv-etq tv-final tv-final-${CLASE_DE_FINAL[n.term]}` }, el("span", { texto: t(`comun.resultado.${RESULTADO_DE_FINAL[n.term]}`) }), e.cuenta);
    } else {
      e.nom = el("div", { class: `tv-etq tv-nombre${n.ruta >= 0 ? " tv-nombre-ruta" : ""}`, texto: nombre(n) });
      e.atasco = el("div", { class: "tv-etq tv-atasco", hidden: true }, icono("atasco"), el("span"));
      e.raiz = el("div", { class: "tv-etq" }, n.ruta >= 0 ? el("div", { class: "tv-etq tv-numero", texto: String(n.ruta + 1) }) : null, e.nom, e.atasco);
    }
    capa.append(e.raiz);
    etiquetas.set(n.clave, e);
    return e;
  }

  function dibujar(E) {
    const puestos = [];
    const lista = [];
    for (const n of E.m.nodos.values()) {
      const v = E.vis.nodos.get(n.clave);
      let e = etiquetas.get(n.clave);
      if (E.anim < v.nace) {
        if (e) ponerOpacidad(e.raiz, 0);
        continue;
      }
      e ??= crear(n);
      [e.sx, e.sy] = E.aPantalla(v.x, v.y);
      lista.push(e);
      puestos.push({ x: e.sx - 8, y: e.sy - 8, w: 16, h: 16, n });
    }
    for (const e of lista) {
      const v = E.vis.nodos.get(e.n.clave);
      ponerOpacidad(e.raiz, acotar((E.anim - v.nace) / 0.35, 0, 1) * (E.hl.on && !E.hl.nodos.has(e.n.clave) ? 0.35 : 1));
      e.raiz.style.transform = `translate(${e.sx}px,${e.sy}px)`;
      if (!e.n.term) continue;
      ponerTexto(e.cuenta, e.n.count);
      const w = e.raiz.offsetWidth || 120;
      const izquierda = v.x < -1;
      const x = izquierda ? e.sx - 13 - w : e.sx + 13;
      e.raiz.style.transform = `translate(${x}px,${e.sy}px)`;
      puestos.push({ x, y: e.sy - 9, w, h: 18, n: e.n });
    }
    // Primero la ruta y lo marcado; después las páginas por donde pasó más gente.
    const prioridad = lista
      .filter((e) => !e.n.term)
      .sort((a, b) => (b.n.ruta >= 0) - (a.n.ruta >= 0) || E.marcado(b.n.clave) - E.marcado(a.n.clave) || b.n.pasaron - a.n.pasaron);
    for (const e of prioridad) {
      const n = e.n;
      ponerTexto(e.nom, nombre(n));
      const max = n.ruta >= 0 ? ETIQUETA.ruta : ETIQUETA.pagina;
      const off = n.ruta >= 0 ? 13 : 10;
      let mejor = null;
      for (const dy of [off, -off - 15]) {
        let w = Math.min(ancho(e), max);
        const y = e.sy + dy;
        for (const p of puestos) {
          if (p.n === n || y >= p.y + p.h || p.y >= y + 15) continue;
          const cx = p.x + p.w / 2;
          if (Math.abs(cx - e.sx) * 2 >= w + p.w) continue;
          w = Math.min(w, 2 * (Math.abs(cx - e.sx) - p.w / 2) - 4);
        }
        if (w >= Math.min(ancho(e), 40)) {
          mejor = { y: dy, w };
          break;
        }
      }
      if (E.marcado(n.clave) && (!mejor || mejor.w < ancho(e))) mejor = { y: off, w: Math.min(ancho(e), 220) };
      e.dy = mejor ? mejor.y : null;
      e.w = mejor ? Math.round(mejor.w) : 0;
      if (!mejor) ponerOpacidad(e.nom, 0);
      else {
        ponerOpacidad(e.nom, 1);
        e.nom.style.width = `${e.w}px`;
        e.nom.style.transform = `translate(${-Math.round(mejor.w / 2)}px,${mejor.y}px)`;
        puestos.push({ x: e.sx - mejor.w / 2, y: e.sy + mejor.y, w: mejor.w, h: 15, n });
      }
      e.atasco.hidden = !n.atascos;
      if (n.atascos) {
        e.atasco.style.transform = `translate(${n.ruta >= 0 ? 8 : 6}px,${n.ruta >= 0 ? -21 : -19}px)`;
        ponerTexto(e.atasco.lastChild, n.atascos);
      }
    }
    // «paso n» sobre cada anillo, donde no pise páginas ni etiquetas.
    const T = anilloFinal(E.m);
    for (let c = 1; c <= T; c++) {
      let anillo = anillos[c];
      if (!anillo) {
        anillo = anillos[c] = el("div", { class: "tv-etq tv-anillo", texto: t("telarana.anillo.paso", { n: c }) });
        capa.prepend(anillo);
      }
      let pos = null;
      for (let g = -96; g <= -20 && !pos; g += 6) {
        const a = (g * Math.PI) / 180;
        const [sx, sy] = E.aPantalla(radio(c) * Math.cos(a), radio(c) * Math.sin(a));
        const caja = { x: sx + 4, y: sy - 18, w: 46, h: 14 };
        if (sx < 16 || sx > E.W - 70 || sy < 50 || sy > E.H - 20) continue;
        if (puestos.some((p) => choca(caja, { x: p.x - 10, y: p.y - 10, w: p.w + 20, h: p.h + 20 }))) continue;
        pos = caja;
      }
      ponerOpacidad(anillo, pos ? acotar((E.anim - E.tAbrir - c * 0.06) / 0.5, 0, 1) * (E.hl.on ? 0.4 : 1) : 0);
      if (pos) anillo.style.transform = `translate(${pos.x}px,${pos.y}px)`;
    }
    for (let c = T + 1; c < anillos.length; c++) if (anillos[c]) ponerOpacidad(anillos[c], 0);
  }

  return {
    dibujar,
    /** La cuenta de un final da un salto cuando llega alguien. */
    tic(clave) {
      const cuenta = etiquetas.get(clave)?.cuenta;
      if (!cuenta) return;
      cuenta.classList.remove("tv-tic");
      void cuenta.offsetWidth;
      cuenta.classList.add("tv-tic");
    },
    /** La página cuyo nombre está bajo el punto de pantalla (sx, sy), o null. */
    nombreEn(sx, sy) {
      for (const e of etiquetas.values()) {
        if (e.n.term || e.dy === null || e.dy === undefined || !e.w) continue;
        if (Math.abs(sx - e.sx) < e.w / 2 && sy > e.sy + e.dy && sy < e.sy + e.dy + 15) return e.n.clave;
      }
      return null;
    },
    reiniciar() {
      capa.replaceChildren();
      etiquetas.clear();
      anillos.length = 0;
    },
  };
}
