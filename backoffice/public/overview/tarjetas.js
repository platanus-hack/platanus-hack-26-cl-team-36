// Revisiones del Overview (spec §3.4, §3.5): pestañas, tarjetas, medidores por goal, etapas, "Up next" y la pista
// de arranque vacío. Puro: no toca document ni window. Trabaja sobre /api/overview (contrato §2); los textos los
// pone overview/textos.js y el DOM, overview/piezas.js.

import { partesDeTanda } from "../nucleo/almacen.js";
import { ordenarEstados } from "./agentes.js";
import { esHex } from "./marca.js";
import { sinAvance, tiempoDeTarjeta } from "./tiempo.js";

export const PESTANAS = Object.freeze(["recent", "live", "delivered", "failed"]);
export const leerPestana = (valor) => (PESTANAS.includes(valor) ? valor : "recent");

/** Filtro de #/revisiones equivalente a cada pestaña (enlaceARevisiones): recent → sin filtro. */
export const ESTADO_EN_REVISIONES = Object.freeze({ recent: null, live: "live", delivered: "done", failed: "failed" });

export const ESTADOS_DE_TARJETA = Object.freeze(["running", "stalled", "queued", "delivered", "failed"]);
export const ETAPAS = Object.freeze(["catalog", "guide", "visitor", "improver"]);
export const ESTADOS_DE_ETAPA = Object.freeze(["hecho", "en_curso", "pendiente", "detenido", "fallido"]);
export const MOTIVOS = Object.freeze(["sin_avance", "limite", "catalogador", "guia", "disenador", "error"]);
/** Goals con medidor visible por tarjeta; el resto va como "+N". */
export const MAX_GOALS = 3;
/** Cada pestaña trae hasta 6 tarjetas (contrato §2). */
export const MAX_TARJETAS = 6;
/** Con menos tarjetas que esto en Recent aparece la pista de cómo empieza una revisión (artboard 5). */
export const TARJETAS_SIN_PISTA = 3;

const estadoDeTarjeta = (valor) => (ESTADOS_DE_TARJETA.includes(valor) ? valor : "queued");

/**
 * Insignia de una pestaña: la cifra o null (sin insignia). Recent nunca; Live con `cuentas.live` (corriendo + en
 * cola); Delivered y Failed con su cuenta. Con 0 no hay insignia.
 */
export function insigniaDePestana(pestana, cuentas) {
  if (pestana === "recent") return null;
  const n = Math.floor(Number(cuentas?.[pestana]) || 0);
  return n > 0 ? n : null;
}

/** Tono de la insignia: Live siempre turquesa; Failed roja solo si está elegida; el resto neutra. */
export function tonoDeInsignia(pestana, elegida) {
  if (pestana === "live") return "acento";
  if (pestana === "failed" && elegida) return "fallido";
  return "neutro";
}

/** ¿Se ve este agente o intento con el filtro? Lo que no tiene dispositivo (null) se ve en todos. */
export const seVeEn = (dispositivo, item) =>
  item?.dispositivo === null || item?.dispositivo === undefined || dispositivo === "all" || item.dispositivo === dispositivo;

/** Cuadritos de una tarjeta: los agentes visibles con el filtro, ordenados. La cifra no cuenta los en cola. */
export function cuadritosDeTarjeta(tarjeta, dispositivo = "all") {
  const estados = ordenarEstados((tarjeta?.agentes ?? []).filter((agente) => seVeEn(dispositivo, agente)).map((agente) => agente.estado));
  return { estados, n: estados.filter((estado) => estado !== "en_cola").length };
}

/** Orden de los tramos de un medidor: los resultados, en curso y al final "espera" (el goal todavía sin intentos). */
export const ORDEN_DE_TRAMOS = Object.freeze(["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso", "espera"]);

/** Copia ordenada de los tramos; "en_cola" se dibuja como "espera" y un estado desconocido va justo antes de ella. */
export function ordenarTramos(tramos) {
  const posicion = (tramo) => {
    const i = ORDEN_DE_TRAMOS.indexOf(tramo);
    return i === -1 ? ORDEN_DE_TRAMOS.length - 1.5 : i;
  };
  return [...(tramos ?? [])].map((tramo) => (tramo === "en_cola" ? "espera" : tramo)).sort((a, b) => posicion(a) - posicion(b));
}

/** El id de tanda de un goal (`<host>/visitor/<goal>/<corrida>`) si sigue el layout; si no, null (sin enlace). */
export const tandaDeGoal = (goal) => (typeof goal?.tanda === "string" && partesDeTanda(goal.tanda) ? goal.tanda : null);

/**
 * Adónde lleva la tarjeta (contrato §6.5): la telaraña del primer goal, en el orden de la tarjeta, que tenga tanda; si
 * ninguno tiene (en curso sin Visitante terminado, en cola, fallida antes de las visitas), null: al avance de la revisión.
 */
export function tandaDeTarjeta(tarjeta) {
  for (const goal of tarjeta?.goals ?? []) {
    const tanda = tandaDeGoal(goal);
    if (tanda) return tanda;
  }
  return null;
}

/**
 * Medidor de un goal con el filtro: { goal, instruccion, tanda, tramos, texto, tono, logrados, medidos }.
 *  - tramos: un tramo por intento visible, ordenados; "espera" si el goal todavía no tiene intentos.
 *  - texto: "x/y" logrados sobre medidos (logrado + fallido + abandonó); "…" si no hay medidos pero hay alguno en
 *    curso; "—" si no hay ninguno (sin tramos: barra vacía).
 *  - tono: logrado si todos llegan, fallido si ninguno, aviso si es mixto; acento con "…"; neutro con "—".
 *  - tanda: la tanda del Visitante de ese goal (la fila enlaza a su telaraña) o null.
 */
export function medidorDeGoal(goal, dispositivo = "all") {
  const intentos = (goal?.intentos ?? []).filter((intento) => seVeEn(dispositivo, intento)).map((intento) => intento.estado);
  const tramos = ordenarTramos([...intentos, ...(goal?.espera ? ["espera"] : [])]);
  const cuenta = (estado) => tramos.filter((tramo) => tramo === estado).length;
  const logrados = cuenta("logrado");
  const medidos = logrados + cuenta("fallido") + cuenta("abandonado");
  const base = { goal: goal?.goal ?? "", instruccion: goal?.instruccion || goal?.goal || "", tanda: tandaDeGoal(goal), tramos, logrados, medidos };
  if (!medidos) {
    const enCurso = tramos.includes("en_curso");
    return { ...base, texto: enCurso ? "…" : "—", tono: enCurso ? "acento" : "neutro" };
  }
  return { ...base, texto: `${logrados}/${medidos}`, tono: logrados === medidos ? "logrado" : logrados === 0 ? "fallido" : "aviso" };
}

/** Hasta MAX_GOALS medidores y cuántos goals quedan fuera ("+N"). */
export function medidoresDeTarjeta(tarjeta, dispositivo = "all", maximo = MAX_GOALS) {
  const goals = tarjeta?.goals ?? [];
  return { visibles: goals.slice(0, maximo).map((goal) => medidorDeGoal(goal, dispositivo)), mas: Math.max(0, goals.length - maximo) };
}

/**
 * Las 4 etapas (Catalog, Routes, Visits, Theme) con su estado y la línea que las une a la anterior: "fuerte" si la
 * etapa está hecha, en curso o fallida; "tenue" si está pendiente o detenida; null en la primera.
 */
export function etapasDeTarjeta(tarjeta) {
  return ETAPAS.map((fase, indice) => {
    const valor = tarjeta?.etapas?.[fase];
    const estado = ESTADOS_DE_ETAPA.includes(valor) ? valor : "pendiente";
    const linea = indice === 0 ? null : ["hecho", "en_curso", "fallido"].includes(estado) ? "fuerte" : "tenue";
    return { fase, estado, linea };
  });
}

/**
 * Línea de motivo que reemplaza a los medidores cuando la tarjeta no tiene goals (detenida o fallida antes de
 * catalogar): { tipo, tono, detalle, duracion }. Detenida → sin_avance (con cuánto lleva); fallida → el motivo de la
 * API. null si la tarjeta tiene goals o no corresponde.
 */
export function avisoDeTarjeta(tarjeta, ahora) {
  if ((tarjeta?.goals ?? []).length) return null;
  const estado = tarjeta?.estado;
  if (estado === "stalled") {
    return { tipo: "sin_avance", tono: "aviso", detalle: tarjeta?.motivo?.detalle ?? null, duracion: sinAvance(tarjeta, ahora) };
  }
  if (estado === "failed") {
    const tipo = MOTIVOS.includes(tarjeta?.motivo?.tipo) && tarjeta.motivo.tipo !== "sin_avance" ? tarjeta.motivo.tipo : "error";
    return { tipo, tono: "fallido", detalle: tarjeta?.motivo?.detalle ?? null, duracion: null };
  }
  return null;
}

/** Captura { tanda, carpeta, archivo } válida o null. */
const captura = (valor) =>
  valor && typeof valor.tanda === "string" && typeof valor.carpeta === "string" && typeof valor.archivo === "string" ? valor : null;

/**
 * Modelo de una tarjeta para un filtro de dispositivo (sin textos ni DOM). `key` = revisión + dispositivo: es la
 * identidad con la que se reconcilia la grilla al refrescar.
 */
export function modeloDeTarjeta(tarjeta, { dispositivo = "all", ahora = null } = {}) {
  const estado = estadoDeTarjeta(tarjeta?.estado);
  return {
    key: `${tarjeta?.revision}:${dispositivo}`,
    revision: String(tarjeta?.revision ?? ""),
    dispositivo,
    url: tarjeta?.url ?? null,
    host: tarjeta?.host ?? "",
    ruta: tarjeta?.ruta ?? "/",
    sitio: tarjeta?.sitio || tarjeta?.host || "",
    estado,
    tanda: tandaDeTarjeta(tarjeta),
    capturas: { desktop: captura(tarjeta?.capturas?.desktop), mobile: captura(tarjeta?.capturas?.mobile) },
    cuadritos: cuadritosDeTarjeta(tarjeta, dispositivo),
    etapas: etapasDeTarjeta(tarjeta),
    medidores: medidoresDeTarjeta(tarjeta, dispositivo),
    aviso: avisoDeTarjeta({ ...tarjeta, estado }, ahora),
    tiempo: tiempoDeTarjeta({ ...tarjeta, estado }, ahora),
    acento: estado === "delivered" && esHex(tarjeta?.acento) ? tarjeta.acento.toLowerCase() : null,
  };
}

/** Tarjetas de una pestaña, en el orden de la API: las que traen datos (un id sin tarjeta se salta). */
export function tarjetasDePestana(overview, pestana) {
  const ids = overview?.pestanas?.[leerPestana(pestana)]?.ids ?? [];
  return ids.map((id) => overview?.tarjetas?.[id]).filter(Boolean).slice(0, MAX_TARJETAS);
}

/** Enlace "ver todas": { total, estado } si la pestaña tiene más de las que trae; si no, null. */
export function masDePestana(overview, pestana) {
  const datos = overview?.pestanas?.[leerPestana(pestana)];
  const total = Math.floor(Number(datos?.total) || 0);
  const traidas = datos?.ids?.length ?? 0;
  return total > traidas ? { total, estado: ESTADO_EN_REVISIONES[leerPestana(pestana)] } : null;
}

/** "Up next": las revisiones en cola (FIFO) que trae la API y cuántas quedan fuera. */
export function colaDeOverview(overview) {
  const ids = overview?.cola?.ids ?? [];
  const tarjetas = ids.map((id) => overview?.tarjetas?.[id]).filter(Boolean);
  const total = Math.max(Math.floor(Number(overview?.cola?.total) || 0), tarjetas.length);
  return { tarjetas, mas: Math.max(0, total - tarjetas.length) };
}

/** ¿Va la pista de arranque vacío? Solo en Recent y con menos de 3 revisiones (sin contar las en cola). */
export function hayPista(overview, pestana) {
  if (leerPestana(pestana) !== "recent") return false;
  const total = Math.floor(Number(overview?.pestanas?.recent?.total) || 0);
  return total < TARJETAS_SIN_PISTA;
}

/**
 * Columnas que ocupa la pista en una grilla de `columnas`: lo que sobra de la última fila, o la fila entera si no
 * sobra nada. Con 3 columnas: 0 tarjetas → 3, 1 → 2, 2 → 1. Con 2: 0 → 2, 1 → 1, 2 → 2. Con 1: siempre 1.
 */
export function columnasDePista(tarjetas, columnas) {
  const total = Math.max(1, Math.floor(columnas) || 1);
  const resto = Math.max(0, Math.floor(tarjetas) || 0) % total;
  return resto === 0 ? total : total - resto;
}
