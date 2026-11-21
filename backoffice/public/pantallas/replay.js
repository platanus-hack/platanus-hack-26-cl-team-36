// Replay (diseño §8 WP4, §10.6): un intento paso a paso en tres vistas sincronizadas (riel de pasos, visor y línea
// de tiempo), con el veredicto y el criterio fijos arriba.
//
// Estado en la URL: ?intento= &paso= &modo=despues|antes|deslizar|superponer &ver=video &senales=1. Los cambios de
// paso se aplican primero en la pantalla (en el lugar, sin reconstruir: el foco nunca se cae) y después se escriben
// en el hash con replaceState; actualizar(ctx) compara la URL con el estado y solo aplica lo distinto (atrás,
// adelante, enlaces). Velocidad y "solo pasos" son locales.

import { el, reemplazar, conservarFoco } from "../nucleo/dom.js";
import { kbd } from "../nucleo/atajos.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { conGlobo } from "../nucleo/globo.js";
import { icono } from "../nucleo/iconos.js";
import { normalizarPaso } from "../nucleo/rutas.js";
import { crearCabecera } from "../replay/cabecera.js";
import { crearLineaDeTiempo } from "../replay/linea-de-tiempo.js";
import { crearRail } from "../replay/rail.js";
import { crearRelojVirtual, crearReproductorDeVideo } from "../replay/reproductor.js";
import { cambiarVelocidad, duracionTotal, pasoEnSegundo, segmentosSoloPasos, siguienteConProblema, ventanasDePasos } from "../replay/sincronia.js";
import { contenidoDeTarjeta } from "../replay/tarjeta.js";
import { MODOS, crearVisor } from "../replay/visor.js";

let ctx = null;
let partes = null;
let estado = null;
let reproductor = null;

const globoConTecla = (texto, ...teclas) => () => el("span", { class: "globo-con-tecla" }, el("span", { texto }), teclas.map((tecla) => kbd(tecla)));

// ── Leer la URL ───────────────────────────────────────────────────────────

/** Parámetros → estado pedido, con los arreglos que hay que escribir de vuelta en la URL y el aviso, si hay. */
function leerParametros(parametros, tanda) {
  const intentos = tanda.intentos ?? [];
  const cambios = {};
  const avisos = [];
  let intento = intentos.find((cada) => cada.id === parametros.intento) ?? null;
  if (!intento) {
    intento = intentos[0] ?? null;
    if (parametros.intento !== undefined) {
      cambios.intento = null;
      avisos.push(ctx.t("comun.estado.intentoNoExiste", { intento: parametros.intento, nombre: intento?.nombrePerfil ?? intento?.id ?? "" }));
    }
  }
  const total = intento?.pasos?.length ?? 0;
  let indice = total ? 0 : -1;
  if (parametros.paso !== undefined) {
    if (!total) cambios.paso = null;
    else if (parametros.paso === "0") {
      // paso=0 es la pantalla inicial (los hitos lo usan): se muestra el paso 1, cuya captura "Antes" es esa pantalla.
      cambios.paso = "1";
    } else {
      const { paso, aviso: problema } = normalizarPaso(parametros.paso, total);
      indice = paso - 1;
      if (problema) {
        cambios.paso = String(paso);
        avisos.push(ctx.t(problema.clave, problema.vars));
      }
    }
  }
  let modo = parametros.modo ?? "despues";
  if (!MODOS.includes(modo)) {
    modo = "despues";
    cambios.modo = null;
  }
  let video = parametros.ver === "video";
  if (parametros.ver !== undefined && !(video && intento?.video)) {
    video = false;
    cambios.ver = null;
  }
  const soloSenales = parametros.senales === "1";
  if (parametros.senales !== undefined && !soloSenales) cambios.senales = null;
  return { intento, indice, modo, video, soloSenales, cambios, aviso: avisos.join(" ") || null };
}

// ── Pintar ────────────────────────────────────────────────────────────────

function ponerAviso(texto) {
  estado.aviso = texto;
  reemplazar(partes.aviso, texto ? avisoEnLinea(texto, "atencion") : null);
}

function ventanas() {
  return estado.ventanas;
}

function pintarIntento() {
  const { intento } = estado;
  estado.ventanas = ventanasDePasos(intento.pasos ?? []);
  estado.duracion = duracionTotal(intento);
  partes.cabecera.pintar(intento);
  partes.linea.pintar(intento, { duracion: estado.duracion });
  partes.raiz.classList.toggle("intento-error", intento.resultado === "error");
  partes.raiz.classList.toggle("sin-pasos", !(intento.pasos?.length));
  partes.botonVideo.hidden = !intento.video;
  partes.barraVideo.hidden = !intento.video;
  crearReproductor();
}

function crearReproductor() {
  reproductor?.destruir();
  const { intento } = estado;
  const comunes = {
    alAvanzar: (t) => alAvanzar(t),
    alCambiarEstado: (activo) => partes.linea.ponerReproduciendo(activo),
  };
  if (estado.video && intento.video) {
    partes.visor.ponerVideo(true, {
      src: ctx.urlDeArchivo(intento.id, "video.webm"),
      etiqueta: ctx.t("replay.visor.videoEtiqueta", { nombre: intento.nombrePerfil ?? intento.id }),
    });
    // desfase = video_offset_s del evaluador: lo que grabó el video antes de que empezara el intento.
    reproductor = crearReproductorDeVideo(partes.visor.video, { desfase: Number(intento.videoDesfase) || 0, senal: ctx.senal, ...comunes });
  } else {
    partes.visor.ponerVideo(false);
    reproductor = crearRelojVirtual({ fin: estado.duracion, ...comunes });
  }
  reproductor.ponerVelocidad(estado.velocidad);
  reproductor.ponerSoloPasos(estado.video && estado.soloPasos ? segmentosSoloPasos(ventanas()) : null);
  partes.linea.ponerReproduciendo(false);
  partes.linea.ponerSoloPasos(estado.soloPasos, estado.video);
  const desde = ventanas()[estado.indice]?.desde ?? 0;
  reproductor.ir(desde);
  partes.linea.ponerTiempo(desde, estado.indice);
}

/** Muestra el paso `estado.indice` en el riel, el visor, la tarjeta y la línea de tiempo (en el lugar). */
function pintarPaso() {
  const { intento, indice } = estado;
  partes.rail.pintar({ intento, indice, soloSenales: estado.soloSenales });
  partes.visor.mostrar({ intento, indice, tanda: ctx.tanda });
  // Una señal por tarjeta (atada a la de la vista): al cambiar de paso se sueltan los oyentes del globo anterior.
  partes.senalDeTarjeta?.abort();
  partes.senalDeTarjeta = new AbortController();
  const senal = AbortSignal.any([ctx.senal, partes.senalDeTarjeta.signal]);
  conservarFoco(partes.tarjeta, () =>
    reemplazar(partes.contenidoTarjeta, contenidoDeTarjeta({ intento, indice, tanda: ctx.tanda, t: ctx.t, senal })),
  );
  partes.linea.marcar(indice);
  const total = intento.pasos?.length ?? 0;
  partes.anterior.setAttribute("aria-disabled", indice <= 0 ? "true" : "false");
  partes.siguiente.setAttribute("aria-disabled", indice < 0 || indice >= total - 1 ? "true" : "false");
  refrescarEnlaces();
}

function refrescarEnlaces() {
  const { intento, indice } = estado;
  const paso = intento.pasos?.[indice];
  partes.telarana.setAttribute("href", ctx.enlace("telarana", { historia: intento.id, paso: paso ? paso.numero : null }));
  const base = { modo: estado.modo === "despues" ? null : estado.modo, senales: estado.soloSenales ? "1" : null };
  partes.cabecera.enlazar((id) => ctx.enlace("replay", { intento: id, ...base }));
}

function pintarModo() {
  partes.visor.ponerModo(estado.modo);
  for (const [modo, boton] of partes.botonesDeModo) boton.setAttribute("aria-pressed", modo === estado.modo ? "true" : "false");
  partes.modos.hidden = estado.video;
  partes.mantenB.hidden = estado.video;
  partes.botonCapturas.setAttribute("aria-pressed", estado.video ? "false" : "true");
  partes.botonVideo.setAttribute("aria-pressed", estado.video ? "true" : "false");
  partes.filtro.setAttribute("aria-pressed", estado.soloSenales ? "true" : "false");
}

// ── Moverse ───────────────────────────────────────────────────────────────

/**
 * Va al paso `indice`. `origen`: "usuario" (escribe la URL y mueve la reproducción), "reproduccion" (escribe la URL,
 * no mueve la reproducción), "url" (no escribe la URL).
 */
function irA(indice, origen = "usuario") {
  const total = estado.intento.pasos?.length ?? 0;
  if (!total) return;
  const nuevo = Math.min(total - 1, Math.max(0, indice));
  if (origen === "usuario" && estado.aviso) ponerAviso(null);
  const cambio = nuevo !== estado.indice;
  estado.indice = nuevo;
  if (cambio) pintarPaso();
  if (origen !== "reproduccion") {
    const desde = ventanas()[nuevo]?.desde ?? 0;
    reproductor.ir(desde);
    partes.linea.ponerTiempo(desde, nuevo);
  }
  if (origen !== "url" && cambio) ctx.actualizarParametros({ paso: String(estado.intento.pasos[nuevo].numero) });
}

function alAvanzar(t) {
  const indice = pasoEnSegundo(ventanas(), t);
  partes.linea.ponerTiempo(t, indice >= 0 ? indice : estado.indice);
  if (indice >= 0 && indice !== estado.indice) irA(indice, "reproduccion");
}

function buscarSegundo(t) {
  reproductor.ir(t);
  alAvanzar(t);
}

function irAProblema(direccion) {
  const indice = siguienteConProblema(estado.intento.pasos ?? [], estado.indice, direccion);
  if (indice !== null) irA(indice);
}

function cambiarModo(modo) {
  if (estado.video) return;
  if (estado.aviso) ponerAviso(null);
  estado.modo = modo;
  pintarModo();
  refrescarEnlaces();
  ctx.actualizarParametros({ modo: modo === "despues" ? null : modo });
}

function alternarVideo(forzar) {
  if (!estado.intento.video) return;
  const video = typeof forzar === "boolean" ? forzar : !estado.video;
  if (video === estado.video) return;
  estado.video = video;
  crearReproductor();
  pintarModo();
  ctx.actualizarParametros({ ver: video ? "video" : null });
}

function alternarSoloSenales() {
  estado.soloSenales = !estado.soloSenales;
  pintarModo();
  partes.rail.pintar({ intento: estado.intento, indice: estado.indice, soloSenales: estado.soloSenales });
  refrescarEnlaces();
  ctx.actualizarParametros({ senales: estado.soloSenales ? "1" : null });
}

function alternarSoloPasos() {
  if (!estado.video) return;
  estado.soloPasos = !estado.soloPasos;
  reproductor.ponerSoloPasos(estado.soloPasos ? segmentosSoloPasos(ventanas()) : null);
  partes.linea.ponerSoloPasos(estado.soloPasos, true);
}

function cambiarVelocidadEn(direccion) {
  estado.velocidad = cambiarVelocidad(estado.velocidad, direccion);
  reproductor.ponerVelocidad(estado.velocidad);
  partes.linea.ponerVelocidad(estado.velocidad);
  ctx.anunciar(ctx.t("replay.linea.velocidadValor", { v: ctx.fmt.numero(estado.velocidad) }));
}

function cambiarIntento(direccion) {
  const intentos = ctx.tanda.intentos ?? [];
  if (intentos.length < 2) return;
  const actual = intentos.findIndex((intento) => intento.id === estado.intento.id);
  const siguiente = intentos[(actual + direccion + intentos.length) % intentos.length];
  ctx.actualizarParametros({ intento: siguiente.id, paso: null }, { historial: "agregar" });
}

function verEnTelarana() {
  ctx.navegar(partes.telarana.getAttribute("href"));
}

// ── Aplicar la URL ────────────────────────────────────────────────────────

function aplicar(parametros) {
  const pedido = leerParametros(parametros, ctx.tanda);
  const cambioDeIntento = pedido.intento.id !== estado.intento?.id;
  // Un aviso viejo (de otro intento) no sigue al cambiar de intento.
  if (pedido.aviso) ponerAviso(pedido.aviso);
  else if (cambioDeIntento && estado.aviso) ponerAviso(null);
  const cambioDeVideo = pedido.video !== estado.video;
  const cambioDeFiltro = pedido.soloSenales !== estado.soloSenales;
  estado.modo = pedido.modo;
  estado.soloSenales = pedido.soloSenales;
  estado.video = pedido.video;
  if (cambioDeIntento) {
    estado.intento = pedido.intento;
    estado.indice = pedido.indice;
    pintarIntento();
    pintarPaso();
  } else {
    if (cambioDeVideo) crearReproductor();
    if (pedido.indice !== estado.indice) irA(pedido.indice, "url");
    else if (cambioDeFiltro) partes.rail.pintar({ intento: estado.intento, indice: estado.indice, soloSenales: estado.soloSenales });
    refrescarEnlaces();
  }
  pintarModo();
  if (Object.keys(pedido.cambios).length) ctx.actualizarParametros(pedido.cambios);
}

// ── Armar ─────────────────────────────────────────────────────────────────

function armar(contenedor) {
  const { t, fmt, senal } = ctx;
  const cabecera = crearCabecera({ t, fmt, tanda: ctx.tanda, senal });
  const rail = crearRail({ t, elegir: (indice) => irA(indice), mover: (delta) => irA(estado.indice + delta), senal });
  const visor = crearVisor({ t, fmt, urlDeArchivo: ctx.urlDeArchivo, senal });
  const linea = crearLineaDeTiempo({
    t,
    fmt,
    urlDeArchivo: ctx.urlDeArchivo,
    senal,
    elegir: (indice) => irA(indice),
    buscar: (segundo) => buscarSegundo(segundo),
    alternar: () => reproductor.alternar(),
    velocidad: (direccion) => cambiarVelocidadEn(direccion),
    soloPasos: () => alternarSoloPasos(),
  });
  visor.video.addEventListener(
    "error",
    () => {
      if (!estado.video) return;
      ponerAviso(t("replay.visor.videoNoCarga"));
      alternarVideo(false);
    },
    { signal: senal },
  );

  const boton = (atributos, ...hijos) => el("button", { type: "button", ...atributos }, ...hijos);

  const botonesDeModo = new Map(
    MODOS.map((modo, indice) => {
      const tecla = ["d", "a", "l", "o"][indice];
      const b = boton({ "aria-pressed": "false", "aria-keyshortcuts": tecla, "data-foco": `replay:modo:${modo}`, texto: t(`replay.visor.${modo}`) });
      b.addEventListener("click", () => cambiarModo(modo), { signal: senal });
      conGlobo(b, globoConTecla(t(`replay.visor.${modo}`), tecla), { senal });
      return [modo, b];
    }),
  );
  const modos = el("div", { class: "segmentado replay-modos", role: "group", "aria-label": t("replay.visor.modos") }, [...botonesDeModo.values()]);

  const botonCapturas = boton({ "aria-pressed": "true", "data-foco": "replay:ver:capturas", texto: t("replay.visor.capturas") });
  const botonVideo = boton({ "aria-pressed": "false", "aria-keyshortcuts": "v", "data-foco": "replay:ver:video", texto: t("replay.visor.video") });
  botonCapturas.addEventListener("click", () => alternarVideo(false), { signal: senal });
  botonVideo.addEventListener("click", () => alternarVideo(true), { signal: senal });
  conGlobo(botonVideo, globoConTecla(t("comun.atajos.desc.video"), "v"), { senal });
  const barraVideo = el("div", { class: "segmentado replay-fuente", role: "group", "aria-label": t("replay.visor.fuente") }, botonCapturas, botonVideo);

  const mantenB = boton({ class: "boton boton-secundario replay-manten-b", "aria-keyshortcuts": "b", "data-foco": "replay:manten-b" }, el("span", { texto: t("replay.visor.mantenB") }));
  const mirar = (activo) => () => partes?.visor.mirarAntes(activo);
  for (const tipo of ["pointerdown"]) mantenB.addEventListener(tipo, mirar(true), { signal: senal });
  for (const tipo of ["pointerup", "pointerleave", "pointercancel", "blur"]) mantenB.addEventListener(tipo, mirar(false), { signal: senal });
  mantenB.addEventListener("keydown", (evento) => (evento.key === " " || evento.key === "Enter") && (evento.preventDefault(), mirar(true)()), { signal: senal });
  mantenB.addEventListener("keyup", (evento) => (evento.key === " " || evento.key === "Enter") && mirar(false)(), { signal: senal });
  mantenB.addEventListener("contextmenu", (evento) => evento.preventDefault(), { signal: senal });
  conGlobo(mantenB, () => el("span", { class: "globo-con-tecla" }, el("span", { texto: t("replay.visor.mantenBAyuda") }), kbd("b", { mantener: true })), { senal });

  const telarana = el("a", { class: "boton boton-secundario replay-ver-telarana", href: "#", "aria-keyshortcuts": "t", "data-foco": "replay:telarana" }, icono("historia"), el("span", { texto: t("replay.visor.verEnTelarana") }));
  conGlobo(telarana, globoConTecla(t("comun.atajos.desc.verEnTelarana"), "t"), { senal });

  const filtro = el("button", { type: "button", class: "chip replay-filtro", "aria-pressed": "false", "data-foco": "replay:filtro", texto: t("replay.rail.soloSenales") });
  filtro.addEventListener("click", () => alternarSoloSenales(), { signal: senal });
  conGlobo(filtro, t("replay.rail.soloSenalesAyuda"), { senal });

  const anterior = el("button", { type: "button", class: "boton boton-secundario replay-anterior", "aria-keyshortcuts": "ArrowLeft k", "data-foco": "replay:anterior" }, icono("anterior"), el("span", { texto: t("replay.tarjeta.anterior") }), el("span", { class: "replay-tecla", "aria-hidden": "true" }, kbd("ArrowLeft")));
  const siguiente = el("button", { type: "button", class: "boton boton-secundario replay-siguiente", "aria-keyshortcuts": "ArrowRight j", "data-foco": "replay:siguiente" }, el("span", { texto: t("replay.tarjeta.siguiente") }), el("span", { class: "replay-tecla", "aria-hidden": "true" }, kbd("ArrowRight")), icono("siguiente"));
  anterior.addEventListener("click", () => anterior.getAttribute("aria-disabled") !== "true" && irA(estado.indice - 1), { signal: senal });
  siguiente.addEventListener("click", () => siguiente.getAttribute("aria-disabled") !== "true" && irA(estado.indice + 1), { signal: senal });

  const contenidoTarjeta = el("div", { class: "replay-tarjeta-contenido" });
  const tarjeta = el("article", { class: "tarjeta replay-tarjeta" }, contenidoTarjeta, el("nav", { class: "replay-navegacion", "aria-label": t("replay.rail.etiqueta") }, anterior, siguiente));

  const leyendaRail = el(
    "p",
    { class: "replay-rail-leyenda texto-3 t-pequeno" },
    el("span", {}, icono("en-ruta", { clase: "carril-en-ruta" }), el("span", { texto: t("comun.carril.en-ruta") })),
    el("span", {}, icono("fuera-de-ruta", { clase: "carril-fuera-de-ruta" }), el("span", { texto: t("comun.carril.fuera-de-ruta") })),
  );

  const aviso = el("div", { class: "replay-aviso" });
  const raiz = el(
    "div",
    { class: "replay" },
    aviso,
    cabecera.nodo,
    el(
      "div",
      { class: "replay-cuerpo" },
      el(
        "aside",
        { class: "replay-rail", "aria-label": t("replay.rail.titulo") },
        el("div", { class: "replay-rail-cabecera" }, el("h3", { class: "etiqueta-micro", texto: t("replay.rail.titulo") }), filtro),
        rail.nodo,
        leyendaRail,
      ),
      el(
        "div",
        { class: "replay-visor" },
        el("div", { class: "replay-barra-visor" }, barraVideo, modos, el("span", { class: "replay-separador" }), mantenB, telarana),
        el("div", { class: "replay-escenario" }, visor.nodo, tarjeta),
      ),
    ),
    linea.nodo,
  );
  contenedor.append(raiz);

  partes = { raiz, aviso, cabecera, rail, visor, linea, tarjeta, contenidoTarjeta, anterior, siguiente, telarana, filtro, botonesDeModo, modos, mantenB, botonCapturas, botonVideo, barraVideo };
}

function registrarAtajos() {
  const { t } = ctx;
  const d = (clave) => t(`comun.atajos.desc.${clave}`);
  const siguiente = { descripcion: d("pasos"), accion: () => irA(estado.indice + 1) };
  const anterior = { descripcion: d("pasos"), accion: () => irA(estado.indice - 1) };
  const modo = (nombre) => ({ descripcion: d("modos"), accion: () => cambiarModo(nombre) });
  ctx.atajos.registrar({
    ArrowRight: siguiente,
    j: siguiente,
    ArrowLeft: anterior,
    k: anterior,
    n: { descripcion: d("problemas"), accion: () => irAProblema(1) },
    "Shift+N": { descripcion: d("problemas"), accion: () => irAProblema(-1) },
    Home: { descripcion: d("extremos"), accion: () => irA(0) },
    End: { descripcion: d("extremos"), accion: () => irA((estado.intento.pasos?.length ?? 1) - 1) },
    b: { descripcion: d("antes"), mantener: true, accion: () => partes.visor.mirarAntes(true), alSoltar: () => partes.visor.mirarAntes(false) },
    d: modo("despues"),
    a: modo("antes"),
    l: modo("deslizar"),
    o: modo("superponer"),
    Space: { descripcion: d("reproducir"), accion: () => reproductor.alternar() },
    ",": { descripcion: d("velocidad"), accion: () => cambiarVelocidadEn(-1) },
    ".": { descripcion: d("velocidad"), accion: () => cambiarVelocidadEn(1) },
    v: { descripcion: d("video"), accion: () => alternarVideo() },
    s: { descripcion: d("soloPasos"), accion: () => alternarSoloPasos() },
    i: { descripcion: d("intentos"), accion: () => cambiarIntento(1) },
    "Shift+I": { descripcion: d("intentos"), accion: () => cambiarIntento(-1) },
    e: { descripcion: d("veredicto"), accion: () => partes.cabecera.alternar() },
    t: { descripcion: d("verEnTelarana"), accion: () => verEnTelarana() },
  });
}

export default {
  titulo(contexto) {
    const intentos = contexto.tanda?.intentos ?? [];
    const intento = intentos.find((cada) => cada.id === contexto.parametros.intento) ?? intentos[0];
    return intento ? contexto.t("replay.tituloDocumento", { nombre: intento.nombrePerfil ?? intento.id }) : contexto.t("comun.pestana.replay");
  },

  async montar(contenedor, contexto) {
    ctx = contexto;
    contenedor.classList.add("p-replay");
    await contexto.cargarEstilos("estilos/replay.css");
    // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma ni se registra nada.
    if (contexto.senal.aborted || ctx !== contexto) return;
    if (!ctx.tanda?.intentos?.length) {
      contenedor.append(vacio({ titulo: ctx.t("replay.visor.sinPasos") }));
      partes = null;
      return;
    }
    estado = { intento: null, indice: -1, modo: "despues", video: false, soloSenales: false, soloPasos: false, velocidad: 1, aviso: null, ventanas: [], duracion: 0 };
    armar(contenedor);
    partes.linea.ponerVelocidad(estado.velocidad);
    registrarAtajos();
    aplicar(ctx.parametros);
  },

  actualizar(contexto) {
    ctx = contexto;
    if (!partes) return false;
    aplicar(contexto.parametros);
    return true;
  },

  desmontar() {
    reproductor?.destruir();
    reproductor = null;
    partes = null;
    estado = null;
  },
};
