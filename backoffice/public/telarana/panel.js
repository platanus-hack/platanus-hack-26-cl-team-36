// Panel lateral de la telaraña viva: «dónde se va la gente». Nunca repite lo que ya dice el lienzo; el hover solo
// resalta filas y un clic fija una página, un tramo o un agente.
//
// Con datos en vivo el panel no se mueve: la estructura de cada modo se arma una vez y las cifras cambian en su
// lugar; las listas no se reordenan más de una vez cada ORDEN_MS ni con el puntero encima, y las filas nuevas
// entran al final con un fundido.

import { el, reemplazar } from "../nucleo/dom.js";
import { icono } from "../nucleo/iconos.js";
import { RESULTADO_DE_FINAL, cifras, detalleDePagina, detalleDeTramo, dondeSeVan, enCurso } from "./modelo.js";

const ORDEN_MS = 5000;
const DONDE = 3;
const MAX_INTENTOS = 12;
const ACCIONES = { go_back: "atras", end: "fin", scroll: "desplazar", type: "escribir", key: "tecla", navigate: "navegar", volver_a_nodo: "salto" };

const ponerTexto = (nodo, valor) => {
  const texto = String(valor);
  if (nodo.textContent !== texto) nodo.textContent = texto;
};

/**
 * @param {HTMLElement} raiz
 * @param {{ t: Function, nombre: (clave: string) => string, nombreDeAgente: (a: object) => string,
 *           enlaceAReplay: (run: string, paso: number) => string | null,
 *           alFijar: (foco: { t: string, k: string }) => void, alSoltar: () => void,
 *           alApuntar: (foco: { t: string, k: string } | null) => void }} opciones
 */
export function crearPanel(raiz, { t, nombre, nombreDeAgente, enlaceAReplay, alFijar, alSoltar, alApuntar, detalleDeAgente = null, pista = null }) {
  let modo = null;
  let partes = null;
  let encima = false;
  const ordenadas = new WeakMap();

  // ¿Puede reordenarse esta lista ahora? Solo sin el puntero encima y si pasó ORDEN_MS desde su último reorden.
  const puedeOrdenar = (lista, ahora) => !encima && ahora - (ordenadas.get(lista) ?? -Infinity) >= ORDEN_MS;

  /** Pone `items` en `lista` sin mover lo que ya está, salvo que se pueda reordenar. */
  function listaEstable(lista, items, { clave, crear, actualizar }, ahora) {
    const actuales = new Map([...lista.children].map((li) => [li.dataset.clave, li]));
    const reordenar = puedeOrdenar(lista, ahora);
    if (reordenar) {
      const quedan = new Set(items.map(clave));
      for (const [k, li] of actuales) {
        if (quedan.has(k)) continue;
        li.remove();
        actuales.delete(k);
      }
    }
    for (const item of items) {
      const k = clave(item);
      let li = actuales.get(k);
      if (!li) {
        li = crear(item);
        li.dataset.clave = k;
        // La primera vez la lista se arma de golpe; después, lo nuevo entra con un fundido.
        if (ordenadas.has(lista)) li.classList.add("tv-entra");
        lista.append(li);
        actuales.set(k, li);
      }
      actualizar(li, item);
    }
    if (!reordenar) return;
    const orden = items.map(clave);
    if (orden.join("\n") !== [...lista.children].map((li) => li.dataset.clave).join("\n")) {
      for (const k of orden) lista.append(actuales.get(k));
      ordenadas.set(lista, ahora);
    } else if (!ordenadas.has(lista)) ordenadas.set(lista, -Infinity);
  }

  const seccion = (titulo, ...hijos) => el("section", { class: "tv-seccion" }, el("h3", { class: "tv-h", texto: titulo }), ...hijos);
  const vacio = (texto) => el("p", { class: "tv-vacio", texto });
  const cuenta = (texto = "") => el("span", { class: "tv-x num", texto });
  const cabecera = (titulo, insignia) => {
    const cerrar = el("button", { type: "button", class: "boton boton-icono tv-cerrar", "data-cerrar": "", "aria-label": t("telarana.panel.quitar"), title: t("telarana.panel.quitar") }, icono("cerrar"));
    const b = el("b", { class: "tv-cab-titulo", texto: titulo });
    const ins = el("span", { class: "tv-ins", texto: insignia });
    return { nodo: el("div", { class: "tv-cab" }, el("div", { class: "tv-cab-texto" }, b, ins), cerrar), b, ins };
  };
  // Las acciones del evaluador con su texto; una desconocida se muestra con un texto genérico, nunca su valor interno.
  const nombreDeAccion = (accion, destino) =>
    /click$/.test(accion) ? t("telarana.accion.clic", { destino }) : t(`telarana.accion.${ACCIONES[accion] ?? "otra"}`);
  const accionMasComun = (e) => {
    const [accion, n] = Object.entries(e.acciones).sort((a, b) => b[1] - a[1])[0] ?? [];
    return accion ? t("telarana.panel.accion", { accion: nombreDeAccion(accion, nombre(e.b)), n }) : "";
  };

  // ── Estado general ──────────────────────────────────────────────────
  function armarGeneral(m) {
    const hitos = m.ruta.map((k, i) => {
      const v = el("span", { class: "tv-v num" });
      const fuga = i < m.ruta.length - 1 ? el("span", { class: "tv-fuga" }) : null;
      const fila = el("button", { type: "button", class: "tv-fila tv-fila-hito", "data-k": k }, el("span", { class: "tv-n", "aria-hidden": "true", texto: String(i + 1) }), el("span", { class: "tv-t" }), v, fuga);
      return { k, fila, t: fila.children[1], v, fuga, firma: "" };
    });
    const de = el("span", { class: "num" });
    const ruta = el("section", { class: "tv-seccion" }, el("h3", { class: "tv-h" }, el("span", { texto: t("telarana.panel.ruta") }), " · ", de), el("ol", { class: "tv-ruta" }, hitos.map((h) => el("li", {}, h.fila))));
    const huecos = Array.from({ length: DONDE }, () => {
      const nombreDeHueco = el("span", { class: "tv-t" });
      const sub = el("small", { class: "tv-sub" });
      const fila = el("button", { type: "button", class: "tv-fila tv-fila-donde", tabindex: "-1" }, nombreDeHueco, sub);
      return { fila, nombre: nombreDeHueco, sub, k: null };
    });
    const nadie = vacio(t("telarana.panel.nadieSalio"));
    const donde = seccion(t("telarana.panel.dondeSeVan"), el("div", { class: "tv-donde" }, el("ol", {}, huecos.map((h) => el("li", {}, h.fila))), nadie));
    const curso = el("b", { class: "num" });
    const linea = el("p", { class: "tv-linea" }, el("span", { texto: t("telarana.panel.enCurso") }), " ", curso);
    reemplazar(raiz, ruta, donde, pista ? el("p", { class: "tv-pista", texto: pista }) : null, linea);
    return { hitos, de, huecos, nadie, curso, orden: [], lista: huecos[0].fila.closest("ol") };
  }

  function fugaDe(c, i) {
    const fugas = [...c.fugas[i]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = fugas.reduce((s, [, n]) => s + n, 0);
    const hijos = [];
    if (total) hijos.push(el("b", { texto: t("telarana.panel.seFueron", { n: total }) }), `: ${fugas.map(([k, n]) => `${nombre(k)} (${n})`).join(", ")}`);
    if (c.term[i]) hijos.push(hijos.length ? " · " : "", t("telarana.panel.terminaronAqui", { n: c.term[i] }));
    if (c.aqui[i]) hijos.push(el("span", { class: "tv-tenue", texto: `${hijos.length ? " · " : ""}${t("telarana.panel.enCursoAqui", { n: c.aqui[i] })}` }));
    return hijos;
  }

  function pintarGeneral(m, p, ahora) {
    const c = cifras(m);
    ponerTexto(p.de, t("telarana.panel.de", { n: c.y }));
    p.hitos.forEach((h, i) => {
      ponerTexto(h.t, nombre(h.k));
      ponerTexto(h.v, c.x[i] ?? 0);
      if (!h.fuga) return;
      const hijos = fugaDe(c, i);
      const firma = hijos.map((x) => (typeof x === "string" ? x : x.textContent)).join("");
      if (firma === h.firma) return;
      h.firma = firma;
      // La línea se reserva aunque esté vacía, así una fuga nueva no empuja lo de abajo.
      reemplazar(h.fuga, hijos.length ? ["↳ ", hijos] : "");
      h.fuga.title = firma;
      h.fuga.classList.toggle("tv-oculta", !hijos.length);
    });

    const lista = dondeSeVan(c);
    const porClave = new Map(lista.map((d) => [d.clave, d]));
    if (puedeOrdenar(p.lista, ahora)) {
      const nuevo = lista.slice(0, DONDE).map((d) => d.clave);
      if (nuevo.join("\n") !== p.orden.join("\n")) {
        if (p.orden.length) ordenadas.set(p.lista, ahora);
        p.orden = nuevo;
      }
    } else for (const d of lista) if (p.orden.length < DONDE && !p.orden.includes(d.clave)) p.orden.push(d.clave);
    p.huecos.forEach((h, i) => {
      const k = p.orden[i] ?? null;
      const d = k ? porClave.get(k) : null;
      h.fila.classList.toggle("tv-libre", !k);
      h.fila.tabIndex = k ? 0 : -1;
      if (h.k !== k) {
        h.k = k;
        if (k) h.fila.dataset.k = k;
        else delete h.fila.dataset.k;
      }
      if (!k) return;
      ponerTexto(h.nombre, nombre(k));
      ponerTexto(h.sub, t("telarana.panel.dondeDetalle", { n: d?.n ?? 0, desde: d ? nombre(m.ruta[d.desde]) : "" }));
    });
    p.nadie.classList.toggle("tv-oculta", p.orden.length > 0);
    ponerTexto(p.curso, enCurso(m));
    p.curso.parentElement.hidden = enCurso(m) === 0;
  }

  // ── Página fijada ───────────────────────────────────────────────────
  function armarPagina(m, k) {
    const n = m.nodos.get(k);
    const cab = cabecera(nombre(k), n.ruta >= 0 ? t("telarana.panel.hito", { n: n.ruta + 1 }) : t("telarana.panel.fuera"));
    cab.ins.classList.add(n.ruta >= 0 ? "tv-ins-hito" : "tv-ins-fuera");
    const entran = el("ul", { class: "tv-lst" });
    const salen = el("ul", { class: "tv-lst" });
    const porque = el("ul", { class: "tv-lst" });
    const atascos = el("li", {}, el("span", { texto: t("telarana.panel.seTrabaron") }), cuenta());
    const terminan = el("li", {}, el("span"));
    porque.append(atascos, terminan);
    const chips = el("div", { class: "tv-chips" });
    const vacios = {
      entran: vacio(t("telarana.panel.nadieTodavia")),
      salen: vacio(t("telarana.panel.nadieTodavia")),
      porque: vacio(t("telarana.panel.nadieSeTrabo")),
      chips: vacio(t("telarana.panel.sinIntentos")),
    };
    reemplazar(
      raiz,
      cab.nodo,
      seccion(t("telarana.panel.llegaronDesde"), entran, vacios.entran),
      seccion(t("telarana.panel.fueronA"), salen, vacios.salen),
      seccion(t("telarana.panel.porQue"), porque, vacios.porque),
      seccion(t("telarana.panel.verEnReplay"), chips, vacios.chips),
    );
    return { k, entran, salen, atascos, terminan, chips, vacios };
  }

  const filaDeTramo = (lado) => ({
    clave: (e) => e.clave,
    crear: (e) =>
      el(
        "li",
        { "data-e": e.clave },
        el("span", {}, el("span", { class: "tv-lst-nombre" }), e.ruta && lado === "b" ? el("span", { class: "tv-r", texto: t("telarana.panel.sigueLaRuta") }) : null),
        cuenta(),
        lado === "b" ? el("span", { class: "tv-sub" }) : null,
      ),
    actualizar: (li, e) => {
      ponerTexto(li.querySelector(".tv-lst-nombre"), `${nombre(e[lado])}${e.tipo === "b" ? " ↩" : ""}`);
      ponerTexto(li.querySelector(".tv-x"), `×${e.n}`);
      if (lado === "b") ponerTexto(li.querySelector(".tv-sub"), accionMasComun(e));
    },
  });

  function filaDeIntento(m) {
    return {
      clave: (i) => i.run,
      crear: () => el("a", { class: "tv-chip mono" }),
      actualizar: (a, i) => {
        const agente = m.agentes.get(i.run);
        const href = enlaceAReplay(i.run, i.paso ?? 0);
        ponerTexto(a, nombreDeAgente(agente));
        if (href && a.getAttribute("href") !== href) a.setAttribute("href", href);
        a.setAttribute("aria-label", t("telarana.panel.abrirEnReplay", { nombre: nombreDeAgente(agente), n: Math.max(1, i.paso ?? 1) }));
      },
    };
  }

  function pintarPagina(m, p, ahora) {
    const d = detalleDePagina(m, p.k);
    listaEstable(p.entran, d.entran, filaDeTramo("a"), ahora);
    listaEstable(p.salen, d.salen, filaDeTramo("b"), ahora);
    p.vacios.entran.hidden = d.entran.length > 0;
    p.vacios.salen.hidden = d.salen.length > 0;
    p.atascos.hidden = !d.nodo.atascos;
    ponerTexto(p.atascos.lastChild, d.nodo.atascos);
    p.terminan.hidden = !d.finales.length;
    ponerTexto(p.terminan.firstChild, t("telarana.panel.terminanAqui", { lista: d.finales.map((e) => `${t(`comun.resultado.${RESULTADO_DE_FINAL[e.term]}`)} ${e.n}`).join(", ") }));
    p.vacios.porque.hidden = !!(d.nodo.atascos || d.finales.length);
    // Los primeros en llegar, en orden de llegada: la lista solo crece hasta el tope y nunca se reordena.
    const intentos = d.intentos.filter((i) => enlaceAReplay(i.run, i.paso ?? 0)).slice(0, MAX_INTENTOS);
    listaEstable(p.chips, intentos, filaDeIntento(m), ahora);
    p.vacios.chips.hidden = intentos.length > 0;
  }

  // ── Tramo fijado ────────────────────────────────────────────────────
  function armarTramo(m, k) {
    const e = m.tramos.get(k);
    const cab = cabecera("", e.ruta ? t("telarana.panel.tramoRuta") : e.tipo === "b" ? t("telarana.panel.tramoVuelta") : t("telarana.panel.tramo"));
    cab.ins.classList.add(e.ruta ? "tv-ins-hito" : "tv-ins-fuera");
    const acciones = el("ul", { class: "tv-lst" });
    const resultados = el("ul", { class: "tv-lst" });
    const replay = el("a", { class: "tv-replay", texto: t("telarana.panel.verEnReplay"), hidden: true });
    reemplazar(raiz, cab.nodo, seccion(t("telarana.panel.acciones"), acciones), seccion(t("telarana.panel.comoTerminaron"), resultados), replay);
    return { k, cab, acciones, resultados, replay };
  }

  const filaSimple = {
    clave: ([k]) => k,
    crear: () => el("li", {}, el("span"), cuenta()),
    actualizar: (li, [, texto, n]) => {
      ponerTexto(li.firstChild, texto);
      ponerTexto(li.lastChild, n);
    },
  };

  function pintarTramo(m, p, ahora) {
    const { tramo: e, pasaron, resultados } = detalleDeTramo(m, p.k);
    ponerTexto(p.cab.b, t("telarana.panel.tramoTitulo", { desde: nombre(e.a), hasta: nombre(e.b), flecha: e.tipo === "b" ? "↩" : "→", n: e.n }));
    const acciones = Object.entries(e.acciones).sort((a, b) => b[1] - a[1]).map(([accion, n]) => [accion, nombreDeAccion(accion, nombre(e.b)), `×${n}`]);
    listaEstable(p.acciones, acciones, filaSimple, ahora);
    const filas = resultados.map(([final, n]) => [final || "-", final ? t(`comun.resultado.${RESULTADO_DE_FINAL[final]}`) : t("telarana.estado.enCurso"), n]);
    listaEstable(p.resultados, filas, filaSimple, ahora);
    const primero = pasaron[0];
    const href = primero ? enlaceAReplay(primero.run, primero.paso.get(e.b) ?? 0) : null;
    p.replay.hidden = !href;
    if (href && p.replay.getAttribute("href") !== href) p.replay.setAttribute("href", href);
  }

  // ── Agente elegido ──────────────────────────────────────────────────
  function armarAgente(m, run) {
    const propio = detalleDeAgente?.(run);
    if (propio) {
      reemplazar(raiz, propio);
      return { run, propio: true };
    }
    const cab = cabecera("", "");
    const donde = el("li", {});
    const salida = el("li", {});
    const replay = el("a", { class: "tv-replay", texto: t("telarana.panel.verPasos"), hidden: true });
    reemplazar(raiz, cab.nodo, el("ul", { class: "tv-lst" }, donde, salida), replay);
    return { run, cab, donde, salida, replay, firma: "" };
  }

  function pintarAgente(m, p) {
    const a = m.agentes.get(p.run);
    if (!a || p.propio) return;
    const [estado, clase] = a.final
      ? [t(`comun.resultado.${RESULTADO_DE_FINAL[a.final]}`), { success: "ok", failed: "mal" }[a.final] ?? "neutro"]
      : a.atascado
        ? [t("telarana.estado.atascado"), "fuera"]
        : [t("telarana.estado.enCurso"), "curso"];
    ponerTexto(p.cab.b, nombreDeAgente(a));
    ponerTexto(p.cab.ins, estado);
    p.cab.ins.className = `tv-ins tv-ins-${clase}`;
    const hito = t("telarana.panel.llegoAlHito", { hito: a.maxHito + 1, total: m.ruta.length });
    const pagina = a.final ? `${nombre(a.ultima)} · ${estado}` : nombre(a.nodo);
    const firma = `${a.final}|${pagina}|${hito}|${a.primera?.de}|${a.primera?.pagina}`;
    if (firma !== p.firma) {
      p.firma = firma;
      reemplazar(p.donde, el("span", {}, `${t(a.final ? "telarana.panel.terminoEn" : "telarana.panel.vaEn")} `, el("b", { texto: pagina }), ` · ${hito}`));
      reemplazar(p.salida, el("span", {}, a.primera ? [`${t("telarana.panel.salioEn")} `, el("b", { texto: `${nombre(a.primera.de)} → ${nombre(a.primera.pagina)}` })] : t("telarana.panel.siguioLaRuta")));
    }
    const href = enlaceAReplay(a.run, 0);
    p.replay.hidden = !href;
    if (href && p.replay.getAttribute("href") !== href) p.replay.setAttribute("href", href);
  }

  // ── Eventos del panel ───────────────────────────────────────────────
  raiz.addEventListener("pointerover", (ev) => {
    encima = true;
    const fila = ev.target.closest?.(".tv-fila[data-k]");
    alApuntar(fila ? { t: "n", k: fila.dataset.k } : null);
  });
  raiz.addEventListener("pointerleave", () => {
    encima = false;
    alApuntar(null);
  });
  raiz.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-cerrar]")) return alSoltar();
    const fila = ev.target.closest(".tv-fila[data-k]");
    if (fila) alFijar({ t: "n", k: fila.dataset.k });
  });

  return {
    /** Arma el modo si cambió y pone las cifras. */
    pintar(E, ahora) {
      const m = E.m;
      const pagina = E.fijado?.t === "n" && m.nodos.has(E.fijado.k) && !m.nodos.get(E.fijado.k).term ? E.fijado.k : null;
      const tramo = E.fijado?.t === "e" && m.tramos.has(E.fijado.k) ? E.fijado.k : null;
      const agente = E.elegido && m.agentes.has(E.elegido) ? E.elegido : null;
      const nuevo = agente ? `a:${agente}` : pagina ? `n:${pagina}` : tramo ? `e:${tramo}` : `g:${m.ruta.join("\n")}`;
      if (nuevo !== modo) {
        modo = nuevo;
        raiz.scrollTop = 0;
        partes = agente ? armarAgente(m, agente) : pagina ? armarPagina(m, pagina) : tramo ? armarTramo(m, tramo) : armarGeneral(m);
        partes.tipo = nuevo[0];
        raiz.dataset.modo = partes.tipo;
        // El panel cambia de contenido con un fundido corto (120 ms).
        if (!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) raiz.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "linear" });
      }
      if (partes.tipo === "a") pintarAgente(m, partes);
      else if (partes.tipo === "n") pintarPagina(m, partes, ahora);
      else if (partes.tipo === "e") pintarTramo(m, partes, ahora);
      else pintarGeneral(m, partes, ahora);
    },
    /** El hover del lienzo resalta las filas de esa página o ese tramo; el panel no cambia. */
    resaltar(E, hover) {
      const tramo = hover?.t === "e" ? E.m.tramos.get(hover.k) : null;
      const claves = hover?.t === "n" ? [hover.k] : tramo ? [tramo.a, tramo.b] : [];
      for (const fila of raiz.querySelectorAll("[data-k],[data-e]")) {
        const si = hover?.t === "e" ? fila.dataset.e === hover.k || (!fila.dataset.e && fila.classList.contains("tv-fila-hito") && claves.includes(fila.dataset.k)) : claves.includes(fila.dataset.k);
        fila.classList.toggle("tv-hl", !!si);
      }
    },
    reiniciar() {
      modo = null;
    },
  };
}
