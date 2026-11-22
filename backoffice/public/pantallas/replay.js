// Replay: un intento paso a paso, solo con lo esencial. A la izquierda el riel de trazas (el mismo del Mapa), al
// centro la captura del paso actual con la línea de tiempo que se puede reproducir y a la derecha la lista de pasos,
// con el paso donde deja la ruta marcado y, plegado, por qué terminó así.
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
import { porQueTermino } from "../replay/analisis.js";
import { crearEscena } from "../replay/escena.js";
import { crearLineaDeTiempo } from "../replay/linea-de-tiempo.js";
import { crearListaDePasos } from "../replay/pasos.js";
import { crearRiel } from "../tanda/riel.js";
import { seleccion, vecina } from "../tanda/riel-estado.js";
import { filasDeTrazas, resumenDeOtra, salidaDeLaRuta, trazasDeLaTanda } from "../tanda/trazas.js";

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
let trazas = null;

// ── Leer la URL ───────────────────────────────────────────────────────────

/**
 * Parámetros → intento e índice pedidos, con los arreglos que hay que escribir de vuelta en la URL y el aviso. Sin
 * intento, la traza más interesante (la primera del riel).
 */
function leerParametros(parametros) {
  const cambios = {};
  const avisos = [];
  const elegida = seleccion(trazas.grupos, parametros.intento ?? null, { porDefecto: true });
  const intento = elegida?.intento ?? null;
  if (!elegida?.valido) {
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
  partes.riel.marcar(seleccion(trazas.grupos, intento.id)?.grupo.representante ?? null);
  const viewport = intento.viewport ?? {};
  partes.captura.style.setProperty("--proporcion", String((viewport.ancho || 1024) / (viewport.alto || 768)));
  partes.lista.pintar(intento, { sale: salidaDeLaRuta(intento)?.paso ?? null });
  partes.linea.pintar(intento);
  reemplazar(partes.fin, porQueTermino({ intento, tanda: ctx.tanda, t: ctx.t }));
  // El panel cambia de contenido con un fundido corto.
  partes.lado.classList.remove("tanda-lado-fundido");
  void partes.lado.offsetWidth;
  partes.lado.classList.add("tanda-lado-fundido");
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
  return animacion;
}

function precargar(intento, indice) {
  const archivo = intento.pasos?.[indice]?.captura;
  if (!archivo) return;
  const imagen = new Image();
  imagen.decoding = "async";
  imagen.src = ctx.urlDeArchivo(intento.id, archivo);
}

/** Tras un cambio de tamaño: el paso actual sigue a la vista y la captura se reubica. */
function ajustarAlto() {
  if (!partes) return;
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
  if (!id || seleccion(trazas.grupos, id)?.grupo === seleccion(trazas.grupos, estado.intento?.id)?.grupo) return;
  ctx.actualizarParametros({ intento: id, paso: null }, { historial: "agregar" });
}

// ── Aplicar la URL ────────────────────────────────────────────────────────

function aplicar(parametros) {
  const pedido = leerParametros(parametros);
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

  const riel = crearRiel({
    titulo: t("comun.traza.titulo"),
    orden: t("comun.traza.orden"),
    etiqueta: t("comun.traza.etiqueta"),
    filas: filasDeTrazas(trazas, t),
    senal,
    alElegir: cambiarIntento,
    otras: { titulo: t("comun.traza.otrasTandas"), tanda: ctx.tanda, pestana: "replay", resumen: resumenDeOtra(ctx.tandas), fecha: (iso) => ctx.fmt.fechaCorta(iso) },
  });

  const escena = crearEscena({ t, senal });
  const imagen = escena.imagen;
  const captura = el("figure", { class: "replay-captura" }, escena.nodo, el("p", { class: "replay-sin-imagen texto-3", texto: t("replay.captura.sinCaptura") }));
  imagen.addEventListener("error", () => imagen.getAttribute("src") && captura.classList.add("sin-captura"), { signal: senal });
  imagen.addEventListener("load", () => captura.classList.remove("sin-captura"), { signal: senal });

  const aviso = el("div", { class: "replay-aviso" });
  const fin = el("div", { class: "replay-fin-contenido" });
  const lado = el(
    "aside",
    { class: "tanda-lado replay-lado", "aria-label": t("replay.pasos.titulo") },
    el("h3", { class: "tanda-etiqueta", texto: t("replay.pasos.titulo") }),
    lista.nodo,
    el("details", { class: "replay-fin" }, el("summary", { texto: t("replay.fin.titulo") }), fin),
  );
  const raiz = el("div", { class: "tanda-columnas replay" }, riel.nodo, el("section", { class: "tanda-centro replay-centro", "aria-label": t("replay.captura.etiqueta") }, captura, linea.nodo), lado);
  contenedor.append(aviso, raiz);
  partes = { raiz, aviso, riel, lista, linea, captura, imagen, lado, fin, escena };
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
    ArrowDown: { descripcion: () => ctx.t("comun.atajos.desc.trazas"), accion: () => cambiarIntento(vecina(trazas.grupos, estado.intento?.id ?? null, 1)) },
    ArrowUp: { descripcion: () => ctx.t("comun.atajos.desc.trazas"), accion: () => cambiarIntento(vecina(trazas.grupos, estado.intento?.id ?? null, -1)) },
    ",": { descripcion: d("velocidad"), accion: () => ponerVelocidad(cambiarVelocidad(estado.velocidad, -1)) },
    ".": { descripcion: d("velocidad"), accion: () => ponerVelocidad(cambiarVelocidad(estado.velocidad, 1)) },
  });
}

export default {
  titulo(contexto) {
    const intentos = contexto.tanda?.intentos ?? [];
    const intento = intentos.find((cada) => cada.id === contexto.parametros.intento) ?? (trazas ? seleccion(trazas.grupos, null, { porDefecto: true })?.intento : intentos[0]);
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
    trazas = trazasDeLaTanda(ctx.tanda, ctx.t);
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
    trazas = null;
  },
};
