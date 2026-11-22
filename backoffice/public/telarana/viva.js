// La telaraña viva: monta el lienzo three.js, las etiquetas, el panel y la barra, y la alimenta con una fuente de
// eventos v1 (una tanda terminada con fuenteDeTanda, o un flujo en vivo).
//
//   montarTelaranaViva(contenedor, { ruta, titulo, fuente, i18n, ... }) → { desmontar(), fijar(), ... }
//
// Lo que la fuente entrega durante suscribir() (el estado ya conocido) se dibuja de una vez, sin animar; lo que llega
// después se anima. Los eventos se aplican una vez por cuadro.

import { el, reemplazar } from "../nucleo/dom.js";
import { icono } from "../nucleo/iconos.js";
import { t as tDelBackoffice } from "../nucleo/i18n.js";
import { aplicar, crearModelo, enCurso, finDeTramos, resaltado, revisarAtascos } from "./modelo.js";
import { avanzarAgentes, crearEscena, introducir, leerColores, sincronizar } from "./escena.js";
import { crearEtiquetas } from "./etiquetas.js";
import { crearPanel } from "./panel.js";
import { conectarInteraccion } from "./interaccion.js";

const REFRESCO_MS = 250;
const VELOCIDADES = [1, 4];

const nombrePorDefecto = (n) => {
  if (n.titulo) return n.titulo;
  try {
    const url = new URL(n.url);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
  } catch {
    return n.url || n.clave;
  }
};

/**
 * @param {HTMLElement} contenedor
 * @param {{
 *   ruta?: { url: string, title?: string }[],
 *   titulo?: string | null,
 *   fuente: { suscribir(cb: (evento: object) => void): { cerrar(): void, velocidad?(v: number): void } },
 *   i18n?: { t: Function },
 *   nombre?: (pagina: { clave: string, url: string, titulo: string }) => string,
 *   nombreDeIntento?: (run: string, perfil: string) => string,
 *   enlaceAReplay?: (run: string, paso: number) => string | null,
 *   repetir?: () => object,
 *   alFijar?: (clave: string | null) => void,
 * }} opciones
 */
export function montarTelaranaViva(contenedor, opciones) {
  const { titulo = null, i18n = null, enlaceAReplay = () => null, repetir = null, alFijar = () => {} } = opciones;
  const t = i18n?.t ?? tDelBackoffice;
  const nombreDePagina = opciones.nombre ?? nombrePorDefecto;
  const nombreDeIntento = opciones.nombreDeIntento ?? ((run, perfil) => perfil || run.split("|").pop());
  let ruta = opciones.ruta ?? [];
  const controlador = new AbortController();
  const senal = controlador.signal;

  // ── Esqueleto ───────────────────────────────────────────────────────
  const canvas = el("canvas", { class: "tv-gl" });
  const capa = el("div", { class: "tv-capa", "aria-hidden": "true" });
  const globo = el("div", { class: "tv-globo", hidden: true });
  const botonDeZoom = (accion, nombreDeIcono) =>
    el("button", { type: "button", class: "boton boton-icono", "data-z": accion, "aria-label": t(`telarana.camara.${accion}`), title: t(`telarana.camara.${accion}`) }, icono(nombreDeIcono));
  const zoom = el("div", { class: "tv-zoom", role: "group", "aria-label": t("telarana.camara.controles") }, botonDeZoom("alejar", "alejar"), botonDeZoom("acercar", "acercar"), botonDeZoom("ajustar", "ajustar"));
  const lienzo = el("div", { class: "tv-lienzo", tabindex: "0", role: "group", "aria-label": t("telarana.lienzo.etiqueta"), title: t("telarana.lienzo.instrucciones") }, canvas, capa, globo, zoom);

  const reproducir = repetir ? el("button", { type: "button", class: "boton boton-secundario tv-reproducir" }, icono("reproducir"), el("span", { texto: t("telarana.barra.reproducir") })) : null;
  const pausa = el("button", { type: "button", class: "boton boton-secundario", "aria-pressed": "false", hidden: true }, icono("pausar"), el("span", { texto: t("telarana.barra.pausa") }));
  const velocidad = el(
    "div",
    { class: "segmentado", role: "group", "aria-label": t("telarana.barra.velocidad"), hidden: true },
    VELOCIDADES.map((v) => el("button", { type: "button", class: "num", "data-v": String(v), "aria-pressed": String(v === 1), texto: `×${v}` })),
  );
  const activos = el("b", { class: "num", texto: "0" });
  const barra = el("div", { class: "tv-barra" }, reproducir, pausa, velocidad, el("span", { class: "tv-activos" }, el("span", { texto: t("telarana.barra.activos") }), " ", activos));

  const linea = (clase, texto) => el("li", { class: `tv-ley-linea ${clase}` }, el("span", { class: "tv-ley-muestra", "aria-hidden": "true" }), el("span", { texto }));
  const leyenda = el(
    "ul",
    { class: "tv-leyenda", "aria-label": t("telarana.leyenda.titulo") },
    linea("tv-ley-ruta", t("telarana.leyenda.ruta")),
    linea("tv-ley-ok", t("telarana.leyenda.todos")),
    linea("tv-ley-mixto", t("telarana.leyenda.algunos")),
    linea("tv-ley-mal", t("telarana.leyenda.nadie")),
    linea("tv-ley-vuelta", t("telarana.leyenda.abandono")),
    el("li", { texto: t("telarana.leyenda.anillo") }),
    el("li", { class: "tv-ley-atasco" }, icono("atasco"), el("span", { texto: t("telarana.leyenda.atasco") })),
    el("li", { texto: t("telarana.leyenda.grosor") }),
  );
  const panel = el("aside", { class: "tv-panel tarjeta", "aria-label": t("telarana.panel.etiqueta") });
  const titular = titulo ? el("h2", { class: "tv-titular" }) : null;
  const raiz = el("div", { class: "telarana-viva" }, titular, el("div", { class: "tv-cuerpo" }, el("div", { class: "tv-columna" }, lienzo, barra, leyenda), panel));
  reemplazar(contenedor, raiz);

  // ── Estado de la vista ──────────────────────────────────────────────
  const K = leerColores(raiz);
  // El backoffice hoy es solo oscuro; si cambia el esquema, los colores de WebGL se releen de los tokens.
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.(
    "change",
    () => {
      Object.assign(K, leerColores(raiz));
      escena.actualizarColores();
    },
    { signal: senal },
  );
  const E = {
    m: crearModelo({ ruta }),
    vis: { nodos: new Map(), tramos: new Map(), agentes: new Map() },
    K,
    V: { cx: 0, cy: 0, z: 1, auto: true, init: false },
    W: 1,
    H: 1,
    anim: 0,
    sim: 0,
    vel: 1,
    pausado: false,
    tAbrir: 0,
    hover: null,
    elegido: null,
    fijado: null,
    hl: resaltado(null, null),
    finTramos: new Map(),
    // Reloj de los datos: el ts del último evento más lo que corrió la simulación desde entonces.
    ultimoTs: null,
    simDelUltimo: 0,
    aPantalla: (x, y) => [(x - E.V.cx) * E.V.z + E.W / 2, (y - E.V.cy) * E.V.z + E.H / 2],
    marcado: (k) => (E.fijado?.t === "n" && E.fijado.k === k) || (E.hover?.t === "n" && E.hover.k === k),
  };
  const nombre = (clave) => {
    const n = E.m.nodos.get(clave);
    return n ? nombreDePagina(n) : clave;
  };
  const nombreDeAgente = (a) => (a ? `${t(`telarana.agente.${a.agente}`)} · ${nombreDeIntento(a.run, a.perfil)}` : "");

  const escena = crearEscena(canvas, K);
  const etiquetas = crearEtiquetas(capa, { t, nombre: nombreDePagina });
  const vistaPanel = crearPanel(panel, {
    t,
    nombre,
    nombreDeAgente,
    enlaceAReplay,
    alFijar: (foco) => fijar(foco, true),
    alSoltar: () => soltar(true),
    alApuntar: (foco) => {
      E.hover = foco ? { ...foco, panel: true } : E.hover?.panel ? null : E.hover;
    },
  });

  function medir() {
    const r = lienzo.getBoundingClientRect();
    E.W = Math.max(1, r.width);
    E.H = Math.max(1, r.height);
    escena.medir(E.W, E.H);
  }
  const observador = new ResizeObserver(medir);
  observador.observe(lienzo);
  medir();

  // ── Selección ───────────────────────────────────────────────────────
  function repintar() {
    E.hover = null;
    vistaPanel.pintar(E, performance.now());
  }
  function fijar(foco, avisar) {
    const igual = E.fijado && E.fijado.t === foco.t && E.fijado.k === foco.k;
    E.elegido = null;
    E.fijado = igual ? null : { t: foco.t, k: foco.k };
    repintar();
    if (avisar && (foco.t === "n" || igual)) alFijar(E.fijado?.t === "n" ? E.fijado.k : null);
  }
  function soltar(avisar) {
    const habia = E.fijado?.t === "n";
    E.elegido = null;
    E.fijado = null;
    repintar();
    if (avisar && habia) alFijar(null);
  }
  const camara = conectarInteraccion(E, {
    lienzo,
    globo,
    zoom,
    etiquetas,
    senal,
    t,
    nombre,
    nombreDeAgente,
    alElegir: (run) => {
      const habia = E.fijado?.t === "n";
      E.fijado = null;
      E.elegido = run;
      repintar();
      if (habia) alFijar(null);
    },
    alFijar: (foco) => fijar(foco, true),
    alSoltar: () => soltar(true),
  });

  // ── Fuente ──────────────────────────────────────────────────────────
  let suscripcion = null;
  let cola = [];
  // Todo lo recibido, para rehacer el estado al cambiar la ruta sin volver a pedirlo.
  let registro = [];

  function procesar(eventos, instantaneo) {
    const tocados = new Set();
    for (const ev of eventos) {
      registro.push(ev);
      const cambio = aplicar(E.m, ev);
      if (cambio) tocados.add(cambio.agente);
      const ts = Date.parse(ev?.ts ?? "");
      if (Number.isFinite(ts) && (E.ultimoTs === null || ts >= E.ultimoTs)) {
        E.ultimoTs = ts;
        E.simDelUltimo = E.sim;
      }
    }
    sincronizar(E, { instantaneo, agentes: tocados });
  }

  function conectar(fuente) {
    suscripcion?.cerrar();
    cola = [];
    const lote = [];
    let durante = true;
    suscripcion = fuente.suscribir((ev) => (durante ? lote : cola).push(ev));
    durante = false;
    procesar(lote, true);
    E.finTramos = finDeTramos(E.m);
    introducir(E);
    const conVelocidad = typeof suscripcion?.velocidad === "function";
    pausa.hidden = !conVelocidad;
    velocidad.hidden = !conVelocidad;
    ponerPausa(false);
    if (conVelocidad) suscripcion.velocidad(E.vel);
  }

  function reiniciar() {
    registro = [];
    E.m = crearModelo({ ruta });
    for (const mapa of Object.values(E.vis)) mapa.clear();
    E.elegido = null;
    E.hover = null;
    E.ultimoTs = null;
    E.V.auto = true;
    E.V.init = false;
    etiquetas.reiniciar();
    vistaPanel.reiniciar();
  }

  function ponerPausa(pausado) {
    E.pausado = pausado;
    pausa.setAttribute("aria-pressed", String(pausado));
    reemplazar(pausa, icono(pausado ? "reproducir" : "pausar"), el("span", { texto: t(pausado ? "telarana.barra.seguir" : "telarana.barra.pausa") }));
    raiz.classList.toggle("tv-pausada", pausado);
    suscripcion?.velocidad?.(pausado ? 0 : E.vel);
  }

  reproducir?.addEventListener("click", () => {
    reiniciar();
    conectar(repetir());
  }, { signal: senal });
  pausa.addEventListener("click", () => ponerPausa(!E.pausado), { signal: senal });
  velocidad.addEventListener("click", (ev) => {
    const boton = ev.target.closest("button[data-v]");
    if (!boton) return;
    E.vel = Number(boton.dataset.v);
    for (const b of velocidad.children) b.setAttribute("aria-pressed", String(b === boton));
    if (!E.pausado) suscripcion?.velocidad?.(E.vel);
  }, { signal: senal });

  // ── Bucle ───────────────────────────────────────────────────────────
  let hlClave = "";
  let tPanel = -Infinity;
  let previo = performance.now();
  let cuadroPedido = 0;

  function refrescar(ahora) {
    if (!E.pausado && E.ultimoTs !== null && enCurso(E.m) > 0) revisarAtascos(E.m, E.ultimoTs + (E.sim - E.simDelUltimo) * 1000);
    E.finTramos = finDeTramos(E.m);
    vistaPanel.pintar(E, ahora);
    activos.textContent = String(enCurso(E.m));
    if (titular) {
      const ok = E.m.fin.success;
      const total = E.m.iniciados - enCurso(E.m);
      titular.textContent = t("telarana.titular", { titulo, pasos: Math.max(0, E.m.ruta.length - 1), ok, total });
    }
  }

  function cuadro(ahora) {
    const dt = Math.min(0.1, (ahora - previo) / 1000);
    previo = ahora;
    if (!E.pausado) {
      E.anim += dt;
      E.sim += dt * E.vel;
      if (cola.length) procesar(cola.splice(0), false);
      for (const clave of avanzarAgentes(E)) etiquetas.tic(clave);
    }
    const foco = E.elegido ? { t: "a", k: E.elegido } : E.hover || E.fijado;
    const clave = `${E.m.version}|${foco?.t}|${foco?.k}`;
    if (clave !== hlClave) {
      hlClave = clave;
      E.hl = resaltado(E.m, foco);
    }
    escena.dibujar(E, dt);
    lienzo.style.backgroundPosition = `${E.W / 2 - E.V.cx * E.V.z}px ${E.H / 2 - E.V.cy * E.V.z}px`;
    etiquetas.dibujar(E);
    if (ahora - tPanel > REFRESCO_MS) {
      tPanel = ahora;
      refrescar(ahora);
    }
    vistaPanel.resaltar(E, E.hover);
    cuadroPedido = requestAnimationFrame(cuadro);
  }

  conectar(opciones.fuente);
  cuadroPedido = requestAnimationFrame(cuadro);

  return {
    desmontar() {
      cancelAnimationFrame(cuadroPedido);
      suscripcion?.cerrar();
      controlador.abort();
      observador.disconnect();
      escena.destruir();
      raiz.remove();
    },
    /** Fija una página por su clave (claveDePagina), o suelta con null. No avisa a alFijar. */
    fijar(clave) {
      if (clave === (E.fijado?.t === "n" ? E.fijado.k : null)) return;
      if (clave) fijar({ t: "n", k: clave }, false);
      else soltar(false);
    },
    soltar: () => soltar(true),
    /** Cambia la ruta recomendada: se rehace el estado con lo ya recibido. */
    ponerRuta(nueva) {
      ruta = nueva ?? [];
      const recibido = registro;
      reiniciar();
      procesar(recibido, true);
      introducir(E);
    },
    cambiarFuente(fuente) {
      reiniciar();
      conectar(fuente);
    },
    acercar: () => camara.acercar(),
    alejar: () => camara.alejar(),
    ajustar: () => camara.ajustar(),
  };
}
