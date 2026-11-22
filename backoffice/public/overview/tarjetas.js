// Revisiones del Overview (spec §3.4, §3.5; contrato §7): pestañas, tarjetas, medidores por goal, etapas, el
// paginado (páginas de 6) y la pista de arranque vacío. Puro: no toca document ni window. Trabaja sobre
// /api/overview (contrato §2 y §7); los textos los pone overview/textos.js y el DOM, overview/dom-*.js.

import { partesDeTanda } from "../nucleo/almacen.js";
import { ordenarEstados } from "./agentes.js";
import { esHex } from "./marca.js";
import { sinAvance, tiempoDeTarjeta } from "./tiempo.js";

// Los filtros de Reviews: All (id `recent`: todas, por fecha), Live y Failed. La API también trae Delivered, que ya no
// se muestra (es el grueso de All); un enlace viejo con ?pestana=delivered cae en All.
export const PESTANAS = Object.freeze(["recent", "live", "failed"]);
export const leerPestana = (valor) => (PESTANAS.includes(valor) ? valor : "recent");

export const ESTADOS_DE_TARJETA = Object.freeze(["running", "stalled", "queued", "delivered", "failed"]);
export const ETAPAS = Object.freeze(["catalog", "guide", "visitor", "improver"]);
export const ESTADOS_DE_ETAPA = Object.freeze(["hecho", "en_curso", "pendiente", "detenido", "fallido"]);
export const MOTIVOS = Object.freeze(["sin_avance", "limite", "catalogador", "guia", "disenador", "error"]);
/** Goals con medidor visible por tarjeta; el resto va como "+N". */
export const MAX_GOALS = 3;
/** Tarjetas por página: el servidor trae una página de 6 por pestaña (contrato §7.4). */
export const TARJETAS_POR_PAGINA = 6;
/** Números de página visibles en el paginador, contando los "…" (primera, última y las vecinas de la actual). */
export const HUECOS_DEL_PAGINADOR = 7;
/** Con menos tarjetas que esto en Recent aparece la pista de cómo empieza una revisión (artboard 5). */
export const TARJETAS_SIN_PISTA = 3;

export const estadoDeTarjeta = (valor) => (ESTADOS_DE_TARJETA.includes(valor) ? valor : "queued");

/**
 * Cifra de un filtro, o null (sin cifra): All con `cuentas.total`; Live con `cuentas.live` (corriendo, detenidas y
 * en cola: el total del filtro); Failed con su cuenta. Con 0 no hay cifra.
 */
export function insigniaDePestana(pestana, cuentas) {
  const n = Math.floor(Number(cuentas?.[pestana === "recent" ? "total" : pestana]) || 0);
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

/** Un id de tanda (`<host>/visitor/<goal>/<corrida>`) si sigue el layout; si no, null (no se arma un enlace roto). */
const tandaValida = (tanda) => (typeof tanda === "string" && partesDeTanda(tanda) ? tanda : null);

/** La tanda de un goal (su fila enlaza a la telaraña) o null. */
export const tandaDeGoal = (goal) => tandaValida(goal?.tanda);

/**
 * ¿La tarjeta abre la hoja de la falla (#/f/<revision>)? Sí si la revisión falló antes de que algún goal tuviera su
 * tanda: no hay telaraña propia que mostrar (la de la captura es de otra revisión del mismo sitio).
 */
export const abreLaFalla = (tarjeta) => estadoDeTarjeta(tarjeta?.estado) === "failed" && !(tarjeta?.goals ?? []).some(tandaDeGoal);

/** La tanda del primer goal que la tiene (una tanda de esta revisión) o null. */
export function tandaPropiaDeTarjeta(tarjeta) {
  for (const goal of tarjeta?.goals ?? []) {
    const tanda = tandaDeGoal(goal);
    if (tanda) return tanda;
  }
  return null;
}

/**
 * Adónde lleva la tarjeta (contrato §6.5 y §7.1): la telaraña del primer goal, en el orden de la tarjeta, que tenga
 * tanda; si ninguno tiene, la tanda de su captura (la de escritorio, si no la móvil: la más nueva del mismo host y
 * ruta); si tampoco hay, null: al avance de la revisión. Una fallida sin tanda propia abre la falla (abreLaFalla).
 */
export function tandaDeTarjeta(tarjeta) {
  return tandaPropiaDeTarjeta(tarjeta) ?? tandaValida(tarjeta?.capturas?.desktop?.tanda) ?? tandaValida(tarjeta?.capturas?.mobile?.tanda);
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

const DESPUES = /^[^/]+\/improver\/[^/]+\/vistas\/[a-z0-9][a-z0-9-]{0,80}\.png$/;

/**
 * Captura válida o null: la del Visitante { tanda, carpeta, archivo } y, si el Diseñador dejó la suya, `despues` (la
 * clave para urlDePropuesta, que se muestra en vez de la del Visitante). Con solo `despues`, los otros tres en null.
 */
const captura = (valor) => {
  if (!valor) return null;
  const visitante = typeof valor.tanda === "string" && typeof valor.carpeta === "string" && typeof valor.archivo === "string";
  const despues = typeof valor.despues === "string" && DESPUES.test(valor.despues) ? valor.despues : null;
  if (!despues) return visitante ? { tanda: valor.tanda, carpeta: valor.carpeta, archivo: valor.archivo } : null;
  return visitante ? { tanda: valor.tanda, carpeta: valor.carpeta, archivo: valor.archivo, despues } : { tanda: null, carpeta: null, archivo: null, despues };
};

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
    // ¿La tanda es de un goal de esta revisión? Entonces el enlace lleva ?revision= (la hoja muestra la franja de goals).
    tandaPropia: tandaPropiaDeTarjeta(tarjeta) !== null,
    falla: abreLaFalla(tarjeta),
    capturas: { desktop: captura(tarjeta?.capturas?.desktop), mobile: captura(tarjeta?.capturas?.mobile) },
    cuadritos: cuadritosDeTarjeta(tarjeta, dispositivo),
    etapas: etapasDeTarjeta(tarjeta),
    medidores: medidoresDeTarjeta(tarjeta, dispositivo),
    aviso: avisoDeTarjeta({ ...tarjeta, estado }, ahora),
    tiempo: tiempoDeTarjeta({ ...tarjeta, estado }, ahora),
    acento: estado === "delivered" && esHex(tarjeta?.acento) ? tarjeta.acento.toLowerCase() : null,
    anteriores: Number.isInteger(tarjeta?.anteriores) && tarjeta.anteriores > 0 ? tarjeta.anteriores : 0,
  };
}

/** Ids de una pestaña, en el orden de la API. */
export const idsDePestana = (overview, pestana) => overview?.pestanas?.[leerPestana(pestana)]?.ids ?? [];

/** Tarjetas de una pestaña, en el orden de la API: las que traen datos (un id sin tarjeta se salta). */
export function tarjetasDePestana(overview, pestana) {
  return idsDePestana(overview, pestana)
    .map((id) => overview?.tarjetas?.[id])
    .filter(Boolean);
}

/** La página pedida en el hash (`?pagina=`): un entero desde 1; otro valor vale 1. */
export function leerPagina(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** La página que trajo la API para una pestaña (1 si no lo dice: un servidor anterior al paginado). */
export const paginaDePestana = (overview, pestana) => leerPagina(overview?.pestanas?.[leerPestana(pestana)]?.pagina);

/**
 * El paginador de una pestaña: { pagina, paginas, total, desde, hasta } (desde–hasta: las tarjetas que se ven, desde
 * 1); null si cabe en una página (sin paginador).
 */
export function paginacionDePestana(overview, pestana) {
  const datos = overview?.pestanas?.[leerPestana(pestana)];
  const total = Math.max(0, Math.floor(Number(datos?.total) || 0));
  const paginas = Math.max(1, Math.floor(Number(datos?.paginas) || Math.ceil(total / TARJETAS_POR_PAGINA)));
  if (paginas <= 1) return null;
  const pagina = Math.min(paginas, paginaDePestana(overview, pestana));
  const desde = (pagina - 1) * TARJETAS_POR_PAGINA + 1;
  return { pagina, paginas, total, desde, hasta: Math.min(total, desde + idsDePestana(overview, pestana).length - 1) };
}

/**
 * Los números del paginador: todos si caben en HUECOS_DEL_PAGINADOR; si no, la primera, la última, la actual con sus
 * vecinas y "…" donde se saltan páginas (un salto de una sola página muestra esa página, no "…"). Con 9 páginas:
 * en la 1 → 1 2 3 4 5 … 9; en la 5 → 1 … 4 5 6 … 9; en la 9 → 1 … 5 6 7 8 9. → (number | "…")[]
 */
export function numerosDePaginas(pagina, paginas, huecos = HUECOS_DEL_PAGINADOR) {
  const total = Math.max(1, Math.floor(paginas) || 1);
  const actual = Math.min(total, Math.max(1, Math.floor(pagina) || 1));
  if (total <= huecos) return Array.from({ length: total }, (_, i) => i + 1);
  // Los extremos fijos y un bloque contiguo alrededor de la actual que llena los huecos que quedan.
  const bloque = huecos - 4;
  let desde = Math.max(2, actual - Math.floor((bloque - 1) / 2));
  let hasta = desde + bloque - 1;
  if (actual <= 1 + Math.ceil(bloque / 2) + 1) {
    desde = 2;
    hasta = huecos - 2;
  } else if (actual >= total - Math.ceil(bloque / 2) - 1) {
    hasta = total - 1;
    desde = total - (huecos - 3);
  }
  hasta = Math.min(hasta, total - 1);
  const numeros = [1];
  if (desde > 2) numeros.push(desde === 3 ? 2 : "…");
  for (let n = desde; n <= hasta; n++) numeros.push(n);
  if (hasta < total - 1) numeros.push(hasta === total - 2 ? total - 1 : "…");
  numeros.push(total);
  return numeros;
}

/** La búsqueda por link con la que vino la respuesta ("" si no hubo). */
export const busquedaDe = (overview) => (typeof overview?.busqueda === "string" ? overview.busqueda : "");

/** ¿Va la pista de arranque vacío? Solo en Recent, sin búsqueda y con menos de 3 revisiones. */
export function hayPista(overview, pestana) {
  if (leerPestana(pestana) !== "recent" || busquedaDe(overview)) return false;
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
