// La tarjeta de una revisión en el Overview (contrato del Overview v3, §2.1–§2.3). Lógica pura: lib/panel.js lee la
// tabla y el almacén y le pasa lo leído; aquí solo se decide.
//
// - estado: tabla done → delivered, failed → failed, queued → queued, running → running, o stalled si está detenida
//   (UMBRAL_DETENIDA_MS sin cambios en `actualizada`, contra el `ahora` del reloj del servidor); otro → queued.
// - actualizada: el updated_at más nuevo entre META y los ítems.
// - etapas (catalog, guide, visitor, improver): hecho | en_curso | pendiente | detenido | fallido, ver etapasDe().
// - agentes: un cuadrito por agente (cataloger, guides por goal, un visitante por intento, improver), ver agentesDe().
// - goals: los goals con ítem, en el orden del goals.json del catalogador, con sus intentos, si están en espera y la
//   tanda de su Visitante en esta revisión si /archivos/ la sirve (la tarjeta lleva a su telaraña).
// - motivo: por qué está detenida o falló, ver motivoDe(). El texto lo pone la página (i18n); aquí va el tipo y el
//   error crudo.
// - capturas: la de inicio de un intento desktop y de uno mobile, ver elegirCapturas().
// - anteriores: cuántas revisiones de la misma página reemplazó esta, la vigente (quedan en #/revisiones?estado=historial).

import { hostDeRevision, rutaDeUrl } from "./sitio.js";

/**
 * Una revisión `running` cuya `actualizada` es más vieja que esto (respecto de `ahora`) está detenida: el flujo no
 * avanzó en media hora (una etapa normal escribe en la tabla cada pocos segundos o minutos).
 */
export const UMBRAL_DETENIDA_MS = 30 * 60 * 1000;

export const FASES = ["catalog", "guide", "visitor", "improver"];
const CERRADO = new Set(["succeeded", "failed", "skipped"]);
const ESTADO_DE_TABLA = { done: "delivered", failed: "failed", queued: "queued" };
const AGENTE_DEL_ITEM = { succeeded: "logrado", failed: "fallido", running: "en_curso" };
const LIMITE = /ThrottlingException|429/;

const tiempo = (valor) => (typeof valor === "string" ? Date.parse(valor) : Number.NaN);
const textoONulo = (valor) => (typeof valor === "string" && valor.trim() ? valor : null);
const numero = (valor) => (valor === undefined || valor === null || valor === "" || !Number.isFinite(Number(valor)) ? null : Number(valor));
const compararTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Un estado que la tabla no conoce cuenta como pending (como calcularResumen en lib/revisiones.js).
const estadoDelItem = (item) => (["pending", "running", "succeeded", "failed", "skipped"].includes(item?.status) ? item.status : "pending");

/**
 * Los ítems de una revisión ordenados para la tarjeta: catálogo, improver y, por goal, guide y visitor.
 * @param {object[]} items  los de la Query por PK (puede venir el META: se ignora)
 */
export function itemsPorEtapa(items) {
  const goals = new Map();
  let catalogo = null;
  let improver = null;
  for (const item of items) {
    const sk = String(item?.SK ?? "");
    if (sk === "STAGE#cataloger") catalogo = item;
    else if (sk === "STAGE#improver") improver = item;
    else {
      const partes = /^GOAL#(.+)#(guide|visitor)$/.exec(sk);
      if (!partes) continue;
      if (!goals.has(partes[1])) goals.set(partes[1], { guide: null, visitor: null });
      goals.get(partes[1])[partes[2]] = item;
    }
  }
  return { catalogo, improver, goals };
}

/** El updated_at más nuevo entre META y los ítems (tal cual viene), o null. */
export function actualizadaDe(meta, items = []) {
  let mejor = null;
  for (const item of [meta, ...items]) {
    const valor = item?.updated_at;
    if (Number.isFinite(tiempo(valor)) && (mejor === null || tiempo(valor) > tiempo(mejor))) mejor = valor;
  }
  return mejor ?? textoONulo(meta?.updated_at);
}

/**
 * true si la revisión corre (tabla `running`) y no cambia hace más de UMBRAL_DETENIDA_MS.
 * @param {string | undefined} status   META.status
 * @param {string | null} actualizada
 * @param {Date} ahora
 */
export function estaDetenida(status, actualizada, ahora) {
  const desde = tiempo(actualizada);
  return status === "running" && Number.isFinite(desde) && ahora.getTime() - desde > UMBRAL_DETENIDA_MS;
}

/** @returns {"running" | "stalled" | "queued" | "delivered" | "failed"} */
export function estadoDeTarjeta(status, detenida) {
  if (status === "running") return detenida ? "stalled" : "running";
  return typeof status === "string" && Object.hasOwn(ESTADO_DE_TABLA, status) ? ESTADO_DE_TABLA[status] : "queued";
}

/** Cuántos goals espera la revisión: META.goals_total, o los que tienen ítem si son más. */
export const goalsEsperados = (meta, goals) => Math.max(numero(meta?.goals_total) ?? 0, goals.size);

/**
 * Los agentes que todavía no parten en una revisión `running` no detenida (contrato §1, `en_cola`): el catalogador
 * si su ítem falta o está pending; por goal, la Guía y el Visitante pending (y uno de cada por goal anunciado en
 * goals_total que todavía no tiene ítem); el diseñador si su ítem falta o está pending.
 * @returns {{ cataloger: number, guide: number, visitor: number, improver: number }}
 */
export function enColaDeRevision(meta, items, detenida) {
  const enCola = { cataloger: 0, guide: 0, visitor: 0, improver: 0 };
  if (meta?.status !== "running" || detenida) return enCola;
  const { catalogo, improver, goals } = itemsPorEtapa(items);
  const pendiente = (item) => estadoDelItem(item) === "pending";
  enCola.cataloger = pendiente(catalogo) ? 1 : 0;
  enCola.improver = pendiente(improver) ? 1 : 0;
  const esperados = goalsEsperados(meta, goals);
  for (const rol of ["guide", "visitor"]) {
    const conItem = [...goals.values()].map((goal) => goal[rol]).filter(Boolean);
    enCola[rol] = conItem.filter(pendiente).length + Math.max(0, esperados - conItem.length);
  }
  return enCola;
}

/**
 * El estado de una fase a partir de los estados de sus ítems (los de guide y visitor son los de todos los goals).
 * @param {string[]} estados  pending | running | succeeded | failed | skipped
 * @returns {"hecho" | "en_curso" | "pendiente" | "fallido"}
 */
export function estadoDeFase(estados) {
  if (!estados.length) return "pendiente";
  if (estados.includes("running")) return "en_curso";
  if (estados.every((estado) => estado === "pending") || estados.every((estado) => estado === "skipped")) return "pendiente";
  if (estados.includes("pending")) return "en_curso";
  return estados.every((estado) => estado === "failed") ? "fallido" : "hecho";
}

/**
 * Las cuatro etapas de la tarjeta.
 * 1. Por fase, estadoDeFase(). En una revisión que corre, los goals anunciados sin ítem cuentan como pending.
 * 2. stalled: lo en_curso pasa a detenido. queued: todo pendiente.
 * 3. failed: si ninguna quedó fallido, la primera que no esté hecho pasa a fallido; las que siguen a una fallido
 *    quedan pendiente.
 * @param {"running" | "stalled" | "queued" | "delivered" | "failed"} estado
 * @returns {{ catalog: string, guide: string, visitor: string, improver: string }}
 */
export function etapasDe(estado, meta, items) {
  if (estado === "queued") return Object.fromEntries(FASES.map((fase) => [fase, "pendiente"]));
  const { catalogo, improver, goals } = itemsPorEtapa(items);
  const faltantes = estado === "running" || estado === "stalled" ? Math.max(0, goalsEsperados(meta, goals) - goals.size) : 0;
  const deGoals = (rol) => [
    ...[...goals.values()].filter((goal) => goal[rol]).map((goal) => estadoDelItem(goal[rol])),
    ...Array(faltantes).fill("pending"),
  ];
  const etapas = {
    catalog: estadoDeFase(catalogo ? [estadoDelItem(catalogo)] : []),
    guide: estadoDeFase(deGoals("guide")),
    visitor: estadoDeFase(deGoals("visitor")),
    improver: estadoDeFase(improver ? [estadoDelItem(improver)] : []),
  };
  if (estado === "stalled") {
    for (const fase of FASES) if (etapas[fase] === "en_curso") etapas[fase] = "detenido";
  }
  if (estado === "failed") {
    if (!FASES.some((fase) => etapas[fase] === "fallido")) {
      const primera = FASES.find((fase) => etapas[fase] !== "hecho");
      if (primera) etapas[primera] = "fallido";
    }
    const desde = FASES.findIndex((fase) => etapas[fase] === "fallido");
    if (desde >= 0) for (const fase of FASES.slice(desde + 1)) etapas[fase] = "pendiente";
  }
  return etapas;
}

/**
 * Por qué una revisión está detenida o falló, o null.
 * stalled → sin_avance. failed → el primero que aplique: un error (META o un ítem) con ThrottlingException o 429 →
 * limite; catalogador fallido → catalogador; diseñador fallido → disenador; alguna Guía fallida → guia; si no, error.
 * `detalle`: el error crudo (META.error o el `error` del ítem que decide), o null. La página lo muestra en el globo.
 * @returns {{ tipo: "sin_avance" | "limite" | "catalogador" | "disenador" | "guia" | "error", detalle: string | null } | null}
 */
export function motivoDe(estado, meta, items) {
  if (estado === "stalled") return { tipo: "sin_avance", detalle: null };
  if (estado !== "failed") return null;
  const { catalogo, improver, goals } = itemsPorEtapa(items);
  const errorDeMeta = textoONulo(meta?.error);
  const errores = [errorDeMeta, ...items.map((item) => textoONulo(item?.error))].filter(Boolean);
  const limite = errores.find((texto) => LIMITE.test(texto));
  if (limite) return { tipo: "limite", detalle: limite };
  const detalle = (item) => textoONulo(item?.error) ?? errorDeMeta;
  if (catalogo?.status === "failed") return { tipo: "catalogador", detalle: detalle(catalogo) };
  if (improver?.status === "failed") return { tipo: "disenador", detalle: detalle(improver) };
  const guia = [...goals.values()].map((goal) => goal.guide).find((item) => item?.status === "failed");
  if (guia) return { tipo: "guia", detalle: detalle(guia) };
  return { tipo: "error", detalle: errores[0] ?? null };
}

/**
 * Los goals con ítem en la tabla, en el orden del goals.json del catalogador de la revisión (los que no están ahí, al
 * final y por id).
 * @param {Map<string, object>} goals   de itemsPorEtapa()
 * @param {unknown} catalogo            goals.json del catalogador ({ goals: [{ id, instruction, description }] }) o null
 * @returns {{ goal: string, definicion: object | null }[]}
 */
export function goalsEnOrden(goals, catalogo) {
  const definiciones = Array.isArray(catalogo?.goals) ? catalogo.goals.filter((goal) => goal && typeof goal.id === "string") : [];
  const posicion = new Map(definiciones.map((goal, i) => [goal.id, i]).reverse());
  const lugar = (goal) => (posicion.has(goal) ? posicion.get(goal) : Number.POSITIVE_INFINITY);
  return [...goals.keys()]
    .sort((a, b) => lugar(a) - lugar(b) || compararTexto(a, b))
    .map((goal) => ({ goal, definicion: definiciones[posicion.get(goal)] ?? null }));
}

const conDetencion = (estadoDelAgente, estado) => (estado === "stalled" && estadoDelAgente === "en_curso" ? "detenido" : estadoDelAgente);

// Un ítem de la tabla como cuadrito: null si no se dibuja.
function agenteDelItem(item, estado) {
  const status = estadoDelItem(item);
  if (Object.hasOwn(AGENTE_DEL_ITEM, status)) return conDetencion(AGENTE_DEL_ITEM[status], estado);
  // pending (o sin ítem): en cola solo mientras la revisión corre; skipped no se dibuja.
  return status === "pending" && estado === "running" ? "en_cola" : null;
}

// El Visitante de un goal todavía puede tener intentos: su ítem no está cerrado.
const visitanteAbierto = (item) => !CERRADO.has(estadoDelItem(item));

/**
 * Los goals de la tarjeta y sus agentes.
 * - agentes (en el orden cataloger, guides por goal, visitantes por goal, improver; la página los reordena): ítem
 *   succeeded → logrado, failed → fallido, running → en_curso; pending o sin ítem → en_cola solo si la tarjeta es
 *   running (si no, no va); skipped no va. stalled: en_curso → detenido. Un visitante por intento (con su
 *   dispositivo); un goal cuyo Visitante todavía no tiene intentos, en una tarjeta running, aporta uno en_cola sin
 *   dispositivo. En una tarjeta running, cada goal anunciado en goals_total que todavía no tiene ítem aporta una Guía y
 *   un visitante en_cola (como en el resumen).
 * - goals: { goal, instruccion, intentos: [{ estado, dispositivo }], espera }. instruccion: instruction del
 *   goals.json → description → instruction de un run.json → el id. espera: tarjeta running y el goal sin intentos.
 *   tanda: la del Visitante de ese goal en esta revisión, solo si se lista (tandaDe; si no, null).
 * @param {{ estado: string, meta: object, items: object[], catalogo: unknown,
 *           intentosDe: (goal: string) => { estado: string, dispositivo: string, instruccion?: string | null }[],
 *           tandaDe?: (goal: string) => string | null }} entrada
 */
export function agentesYGoals({ estado, meta, items, catalogo, intentosDe, tandaDe = () => null }) {
  const { catalogo: itemCatalogo, improver, goals } = itemsPorEtapa(items);
  const enOrden = goalsEnOrden(goals, catalogo);
  const faltantes = estado === "running" ? Math.max(0, goalsEsperados(meta, goals) - goals.size) : 0;
  const agentes = [];
  const agregar = (rol, estadoDelAgente, dispositivo = null) => {
    if (estadoDelAgente) agentes.push({ rol, estado: estadoDelAgente, dispositivo });
  };

  agregar("cataloger", agenteDelItem(itemCatalogo, estado));
  for (const { goal } of enOrden) agregar("guide", agenteDelItem(goals.get(goal).guide, estado));
  for (let i = 0; i < faltantes; i += 1) agregar("guide", "en_cola");

  const lista = enOrden.map(({ goal, definicion }) => {
    const crudos = intentosDe(goal) ?? [];
    const intentos = crudos.map((intento) => ({ estado: conDetencion(intento.estado, estado), dispositivo: intento.dispositivo }));
    const espera = estado === "running" && intentos.length === 0 && visitanteAbierto(goals.get(goal).visitor);
    for (const intento of intentos) agregar("visitor", intento.estado, intento.dispositivo);
    if (espera) agregar("visitor", "en_cola");
    const instruccion =
      textoONulo(definicion?.instruction) ?? textoONulo(definicion?.description) ?? crudos.map((intento) => textoONulo(intento.instruccion)).find(Boolean) ?? goal;
    return { goal, instruccion, intentos, espera, tanda: tandaDe(goal) ?? null };
  });
  for (let i = 0; i < faltantes; i += 1) agregar("visitor", "en_cola");
  agregar("improver", agenteDelItem(improver, estado));
  return { agentes, goals: lista };
}

/**
 * La captura de inicio de un intento desktop y de uno mobile para la tarjeta, o null por dispositivo.
 * `grupos` en orden de preferencia: las tandas del Visitante de la revisión y, si no hay intentos ahí, las del mismo
 * host y ruta; cada grupo con la tanda más nueva primero. Dentro de un grupo se prefiere un intento que no sea error.
 * Solo deben venir tandas que lista idsDeTandas (las sirve /archivos/).
 * @param {{ tanda: string, intentos: { carpeta: string, estado: string, dispositivo: string, captura: string | null }[] }[][]} grupos
 * @returns {{ desktop: { tanda: string, carpeta: string, archivo: string } | null, mobile: { tanda: string, carpeta: string, archivo: string } | null }}
 */
export function elegirCapturas(grupos) {
  const elegir = (dispositivo) => {
    for (const grupo of grupos) {
      const candidatos = grupo.flatMap(({ tanda, intentos }) =>
        intentos.filter((intento) => intento.dispositivo === dispositivo && intento.captura).map((intento) => ({ tanda, intento })),
      );
      if (!candidatos.length) continue;
      const { tanda, intento } = candidatos.find(({ intento }) => intento.estado !== "error") ?? candidatos[0];
      return { tanda, carpeta: intento.carpeta, archivo: intento.captura };
    }
    return null;
  };
  return { desktop: elegir("desktop"), mobile: elegir("mobile") };
}

/**
 * La tarjeta completa (forma del contrato §2.1).
 * @param {{ meta: object, items: object[], ahora: Date, catalogo?: unknown,
 *           intentosDe?: (goal: string) => object[], tandaDe?: (goal: string) => string | null, capturas?: object,
 *           acento?: string | null, sitio: string }} entrada
 */
export function armarTarjeta({ meta, items, ahora, catalogo = null, intentosDe = () => [], tandaDe = () => null, capturas = { desktop: null, mobile: null }, acento = null, sitio, anteriores = 0 }) {
  const propios = items.filter((item) => item?.SK !== "META");
  const actualizada = actualizadaDe(meta, propios);
  const estado = estadoDeTarjeta(meta?.status, estaDetenida(meta?.status, actualizada, ahora));
  const { agentes, goals } = agentesYGoals({ estado, meta, items: propios, catalogo, intentosDe, tandaDe });
  return {
    revision: String(meta?.PK ?? "").replace(/^REV#/, ""),
    url: textoONulo(meta?.url),
    host: hostDeRevision(meta),
    ruta: rutaDeUrl(meta?.url),
    sitio,
    estado,
    creada: textoONulo(meta?.created_at),
    actualizada,
    etapas: etapasDe(estado, meta, propios),
    agentes,
    goals,
    capturas,
    acento,
    motivo: motivoDe(estado, meta, propios),
    anteriores,
  };
}
