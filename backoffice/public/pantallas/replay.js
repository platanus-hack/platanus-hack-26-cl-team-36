// Replay: un intento paso a paso, solo con lo esencial. A la izquierda la lista de pasos, al centro la captura del
// paso actual, a la derecha su análisis (dónde va en la ruta de la Guía: replay/analisis.js) y abajo la línea de
// tiempo que se puede reproducir.
//
// Estado en la URL: ?intento= &paso=. Los cambios de paso se aplican primero en la pantalla (en el lugar, sin
// reconstruir: el foco nunca se cae) y después se escriben en el hash; actualizar(ctx) compara la URL con el estado
// y solo aplica lo distinto (atrás, adelante, enlaces).
//
// Teclas de la pantalla: ← → paso anterior/siguiente, Inicio/Fin primer/último paso, Espacio reproducir/pausar.
//
// La captura anima lo que hizo el usuario en cada paso (replay/escena.js): completo al reproducir, corto al elegir
// un paso a mano.

import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { normalizarPaso } from "../nucleo/rutas.js";
import { cambiarVelocidad, factorDeTiempo, planDelPaso, velocidadValida } from "../replay/animacion.js";
import { cabeceraDeAnalisis, contenidoDeAnalisis } from "../replay/analisis.js";
import { crearEscena } from "../replay/escena.js";
import { crearLineaDeTiempo } from "../replay/linea-de-tiempo.js";
import { crearListaDePasos } from "../replay/pasos.js";

/** Cuánto se queda cada paso quieto en pantalla al reproducir, después de su animación (a 1×, antes de RITMO_BASE). */
const MS_DE_PAUSA = 700;

/** La velocidad elegida queda guardada en este navegador. */
const CLAVE_VELOCIDAD = "backoffice:replay-velocidad";

function leerVelocidadGuardada() {
  try {
    return velocidadValida(globalThis.localStorage?.getItem(CLAVE_VELOCIDAD));
  } catch {
    return velocidadValida(null);
  }
}

function guardarVelocidad(valor) {
  try {
    globalThis.localStorage?.setItem(CLAVE_VELOCIDAD, String(valor));
  } catch {
    // Sin almacenamiento (modo privado, sitio bloqueado): la velocidad vale solo para esta visita.
  }
}

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

let ctx = null;
let partes = null;
let estado = null;

// ── Leer la URL ───────────────────────────────────────────────────────────

/** Parámetros → intento e índice pedidos, con los arreglos que hay que escribir de vuelta en la URL y el aviso. */
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
      // paso=0 es la pantalla inicial (los hitos lo usan): se muestra el paso 1.
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
  return { intento, indice, cambios, aviso: avisos.join(" ") || null };
}

// ── Pintar ────────────────────────────────────────────────────────────────

function ponerAviso(texto) {
  estado.aviso = texto;
  reemplazar(partes.aviso, texto ? avisoEnLinea(texto, "atencion") : null);
}

function pintarIntento() {
  const { intento } = estado;
  partes.selector.value = intento.id;
  const viewport = intento.viewport ?? {};
  partes.captura.style.setProperty("--proporcion", String((viewport.ancho || 1024) / (viewport.alto || 768)));
  partes.lista.pintar(intento);
  partes.linea.pintar(intento);
}

/**
 * Muestra el paso `estado.indice` en la lista, la captura, el análisis y la línea de tiempo. `modo`: cómo se anima
 * la captura ("completo", "corto" o null). Devuelve la promesa de la animación.
 */
function pintarPaso(modo = "corto") {
  const { intento, indice } = estado;
  const paso = intento.pasos?.[indice] ?? null;
  const archivo = paso ? paso.captura : (intento.inicio?.captura ?? null);
  const src = archivo ? ctx.urlDeArchivo(intento.id, archivo) : "";
  const srcAntes = paso?.capturaAntes ? ctx.urlDeArchivo(intento.id, paso.capturaAntes) : "";
  if (partes.imagen.getAttribute("src") !== src) partes.captura.classList.toggle("sin-captura", !src);
  const animacion = partes.escena.mostrar({
    plan: paso ? planDelPaso(intento.pasos, indice, { viewport: intento.viewport }) : null,
    srcAntes,
    srcDespues: src,
    viewport: intento.viewport,
    modo,
    velocidad: estado.velocidad,
  });
  partes.imagen.alt = paso ? ctx.t("replay.captura.alt", { n: paso.numero }) : ctx.t("replay.captura.altInicio");
  precargar(intento, indice + 1);

  partes.lista.marcar(indice);
  partes.linea.marcar(Math.max(0, indice));
  reemplazar(partes.cabeceraAnalisis, cabeceraDeAnalisis({ intento, indice, t: ctx.t, fmt: ctx.fmt }));
  reemplazar(partes.analisis, contenidoDeAnalisis({ intento, indice, tanda: ctx.tanda, t: ctx.t }));
  partes.analisis.scrollTop = 0;
  return animacion;
}

function precargar(intento, indice) {
  const archivo = intento.pasos?.[indice]?.captura;
  if (!archivo) return;
  const imagen = new Image();
  imagen.decoding = "async";
  imagen.src = ctx.urlDeArchivo(intento.id, archivo);
}

/** La vista ocupa el alto que queda en la ventana bajo el encabezado de la tanda (con un mínimo). */
function ajustarAlto() {
  if (!partes) return;
  const arriba = partes.raiz.getBoundingClientRect().top + globalThis.scrollY;
  partes.raiz.style.setProperty("--alto-replay", `${Math.max(460, globalThis.innerHeight - arriba - 24)}px`);
  partes.lista.revelar();
  partes.escena.ajustar(partes.captura);
}

// ── Moverse ───────────────────────────────────────────────────────────────

/**
 * Va al paso `indice` y devuelve la promesa de su animación. `desdeUrl`: el cambio vino de la URL, así que no se
 * vuelve a escribir. `modo`: cómo se anima la captura.
 */
function irA(indice, { desdeUrl = false, modo = "corto" } = {}) {
  const total = estado.intento.pasos?.length ?? 0;
  if (!total) return Promise.resolve();
  const nuevo = Math.min(total - 1, Math.max(0, indice));
  if (!desdeUrl && estado.aviso) ponerAviso(null);
  if (nuevo === estado.indice) return Promise.resolve();
  estado.indice = nuevo;
  const animacion = pintarPaso(modo);
  if (!desdeUrl) ctx.actualizarParametros({ paso: String(estado.intento.pasos[nuevo].numero) });
  return animacion;
}

function elegir(indice) {
  pausar();
  irA(indice);
}

function pausar() {
  if (!estado?.reproduccion) return;
  estado.reproduccion = 0;
  clearTimeout(estado.reloj);
  partes?.linea.ponerReproduciendo(false);
}

const esperar = (ms) => new Promise((listo) => (estado.reloj = setTimeout(listo, ms * factorDeTiempo(estado.velocidad))));

/** Aplica una velocidad (desde el selector o las teclas , y .), la guarda y la anuncia; vale desde el paso siguiente. */
function ponerVelocidad(valor) {
  estado.velocidad = velocidadValida(valor);
  guardarVelocidad(estado.velocidad);
  partes.linea.ponerVelocidad(estado.velocidad);
  ctx.anunciar?.(ctx.t("replay.linea.velocidadValor", { v: ctx.fmt.numero(estado.velocidad) }));
}

/** Reproduce desde el paso actual: anima cada paso entero, lo deja quieto un momento y pasa al siguiente. */
async function alternarReproduccion() {
  if (estado.reproduccion) {
    pausar();
    return;
  }
  const total = estado.intento.pasos?.length ?? 0;
  if (total < 2) return;
  const mia = Date.now();
  estado.reproduccion = mia;
  partes.linea.ponerReproduciendo(true);
  const sigue = () => estado?.reproduccion === mia;
  // Desde el último paso, reproducir vuelve a empezar (y el primer paso también se anima).
  if (estado.indice >= total - 1) {
    estado.indice = -1;
    await irA(0, { modo: "completo" });
    if (sigue()) await esperar(MS_DE_PAUSA);
  }
  while (sigue() && estado.indice < total - 1) {
    await irA(estado.indice + 1, { modo: "completo" });
    if (sigue()) await esperar(MS_DE_PAUSA);
  }
  if (sigue()) pausar();
}

function cambiarIntento(id) {
  ctx.actualizarParametros({ intento: id, paso: null }, { historial: "agregar" });
}

// ── Aplicar la URL ────────────────────────────────────────────────────────

function aplicar(parametros) {
  const pedido = leerParametros(parametros, ctx.tanda);
  const cambioDeIntento = pedido.intento.id !== estado.intento?.id;
  if (pedido.aviso) ponerAviso(pedido.aviso);
  else if (cambioDeIntento && estado.aviso) ponerAviso(null);
  if (cambioDeIntento) {
    pausar();
    estado.intento = pedido.intento;
    estado.indice = pedido.indice;
    pintarIntento();
    pintarPaso();
    // El Replay parte reproduciendo (al abrirlo y al cambiar de intento), salvo con movimiento reducido.
    if (!movimientoReducido()) alternarReproduccion();
  } else if (pedido.indice !== estado.indice) irA(pedido.indice, { desdeUrl: true });
  if (Object.keys(pedido.cambios).length) ctx.actualizarParametros(pedido.cambios);
}

// ── Armar ─────────────────────────────────────────────────────────────────

function armar(contenedor) {
  const { t, senal } = ctx;
  const lista = crearListaDePasos({ t, elegir, mover: (delta) => elegir(estado.indice + delta), senal });
  const linea = crearLineaDeTiempo({ t, fmt: ctx.fmt, senal, elegir, alternar: () => alternarReproduccion(), velocidad: (valor) => ponerVelocidad(valor) });

  const selector = el(
    "select",
    { class: "replay-intento", "aria-label": t("replay.pasos.intento"), "data-foco": "replay:intento" },
    (ctx.tanda.intentos ?? []).map((intento) => el("option", { value: intento.id, texto: intento.nombrePerfil ?? intento.id })),
  );
  selector.addEventListener("change", () => cambiarIntento(selector.value), { signal: senal });

  const escena = crearEscena({ t, senal });
  const imagen = escena.imagen;
  const captura = el("figure", { class: "replay-captura" }, escena.nodo, el("p", { class: "replay-sin-imagen texto-3", texto: t("replay.captura.sinCaptura") }));
  imagen.addEventListener("error", () => imagen.getAttribute("src") && captura.classList.add("sin-captura"), { signal: senal });
  imagen.addEventListener("load", () => captura.classList.remove("sin-captura"), { signal: senal });

  const analisis = el("div", { class: "replay-analisis-contenido" });
  const cabeceraAnalisis = el("div", { class: "replay-columna-cabecera" }, el("h3", { class: "etiqueta-micro", texto: t("replay.analisis.titulo") }));
  const aviso = el("div", { class: "replay-aviso" });
  const raiz = el(
    "div",
    { class: "replay" },
    aviso,
    el(
      "div",
      { class: "replay-columnas" },
      el(
        "aside",
        { class: "replay-columna replay-pasos", "aria-label": t("replay.pasos.titulo") },
        el("div", { class: "replay-columna-cabecera" }, el("h3", { class: "etiqueta-micro", texto: t("replay.pasos.titulo") }), selector),
        lista.nodo,
      ),
      captura,
      el(
        "aside",
        { class: "replay-columna replay-analisis", "aria-label": t("replay.analisis.titulo") },
        cabeceraAnalisis,
        analisis,
      ),
    ),
    linea.nodo,
  );
  contenedor.append(raiz);
  partes = { raiz, aviso, selector, lista, linea, captura, imagen, analisis, cabeceraAnalisis, escena };
  globalThis.addEventListener("resize", ajustarAlto, { signal: senal });
  const observador = new ResizeObserver(() => escena.ajustar(captura));
  observador.observe(captura);
  senal.addEventListener("abort", () => observador.disconnect(), { once: true });
  requestAnimationFrame(ajustarAlto);
}

function registrarAtajos() {
  const d = (clave) => ctx.t(`comun.atajos.desc.${clave}`);
  ctx.atajos.registrar({
    ArrowRight: { descripcion: d("pasos"), accion: () => elegir(estado.indice + 1) },
    ArrowLeft: { descripcion: d("pasos"), accion: () => elegir(estado.indice - 1) },
    Home: { descripcion: d("extremos"), accion: () => elegir(0) },
    End: { descripcion: d("extremos"), accion: () => elegir((estado.intento.pasos?.length ?? 1) - 1) },
    Space: { descripcion: d("reproducir"), accion: () => alternarReproduccion() },
    ",": { descripcion: d("velocidad"), accion: () => ponerVelocidad(cambiarVelocidad(estado.velocidad, -1)) },
    ".": { descripcion: d("velocidad"), accion: () => ponerVelocidad(cambiarVelocidad(estado.velocidad, 1)) },
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
      contenedor.append(vacio({ titulo: ctx.t("replay.analisis.sinPasos") }));
      partes = null;
      return;
    }
    estado = { intento: null, indice: -1, aviso: null, reproduccion: 0, reloj: 0, velocidad: leerVelocidadGuardada() };
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
    if (estado) clearTimeout(estado.reloj);
    partes?.escena.detener();
    partes = null;
    estado = null;
  },
};
