// Los pasos de los agentes de un goal como eventos v1 de la telaraña viva: start, step y end por intento (la Guía es
// un intento más), con ids estables "<run_key>|<intento>|<step>|<type>" para deduplicar y para Last-Event-ID.
// Lógica pura: parte de lo que lee crearRevisiones().leerGoal() (trace.json, route.json o run.json).

import { partesDeCorrida } from "../public/nucleo/almacen.js";
import { claveDeNodo, normalizarUrl } from "./url.js";
import { PERFIL_DE_LA_GUIA, recorridoDe } from "./vivo.js";

export const VERSION = 1;
const CERRADO = new Set(["succeeded", "failed", "skipped"]);
const ORDEN_DEL_TIPO = { start: 0, step: 1, end: 2 };
const ACCIONES_DE_LA_GUIA = { click: "left_click", fill: "type" };
const VOLVER_A_NODO = "volver_a_nodo";
// interrupted es un error técnico; unmeasured (sin ruta ni juez) no tiene un resultado mejor en el contrato.
const RESULTADOS = { success: "success", failed: "failed", abandoned: "abandoned", interrupted: "error", unmeasured: "abandoned" };

const texto = (valor) => (typeof valor === "string" ? valor : "");
const numero = (valor) => (Number.isFinite(valor) ? valor : 0);
const pagina = (url, titulo) => ({ url: normalizarUrl(url), title: texto(titulo).trim() });

function instante(valor) {
  const ms = Date.parse(texto(valor));
  return Number.isFinite(ms) ? ms : null;
}

// La hora de la clave de la corrida ("…/2026-11-22T10-00-00Z" → ms), el ts del start: run.json trae started_at y
// trace.json no, y el ts de un evento ya enviado no debe cambiar (ordena la reanudación con Last-Event-ID).
function inicioDeCorrida(runKey) {
  const partes = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(partesDeCorrida(runKey ?? "")?.corrida ?? "");
  return partes ? Date.parse(`${partes[1]}T${partes[2]}:${partes[3]}:${partes[4]}Z`) : 0;
}

function accion(paso, agente) {
  if (agente === "guide") return ACCIONES_DE_LA_GUIA[paso.action] ?? paso.action;
  if (paso.action === VOLVER_A_NODO || (paso.action === "key" && paso.signals?.includes("went_back"))) return "go_back";
  return paso.action;
}

/**
 * Los eventos de un recorrido (recorridoDe) en orden: start, un step por paso y, con `fin`, el end.
 * @param {object} recorrido
 * @param {{ revision: string, host: string | null, goal: string, agent: "guide" | "visitor", runKey: string,
 *           attempt: string, fin?: { outcome: string, end_reason: string } | null }} contexto
 */
export function eventosDeRecorrido(recorrido, { revision, host, goal, agent, runKey, attempt, fin = null }) {
  const runId = `${runKey}|${attempt}`;
  const base = inicioDeCorrida(runKey);
  const evento = (type, step, ms, campos) => ({
    v: VERSION,
    id: `${runId}|${step}|${type}`,
    ts: new Date(ms).toISOString(),
    revision,
    host,
    goal,
    agent,
    run_id: runId,
    attempt,
    type,
    step,
    ...campos,
  });
  let nodo = pagina(recorrido.start.url, recorrido.start.title);
  let ultimo = base;
  const eventos = [evento("start", 0, base, { node: nodo, signals: [] })];
  for (const paso of recorrido.steps) {
    const desde = paso.url_before ? pagina(paso.url_before, paso.title_before) : nodo;
    nodo = pagina(paso.url, paso.title);
    ultimo = Math.max(ultimo, instante(paso.settled_at) ?? base + numero(paso.seconds_since_start) * 1000);
    eventos.push(evento("step", paso.number, ultimo, { action: accion(paso, agent), from: desde, node: nodo, signals: [...(paso.signals ?? [])] }));
  }
  if (fin) {
    const duracion = Number.isFinite(recorrido.duration_s) ? base + recorrido.duration_s * 1000 : ultimo;
    eventos.push(evento("end", recorrido.steps.at(-1)?.number ?? 0, Math.max(ultimo, duracion), { node: nodo, signals: [], ...fin }));
  }
  return eventos;
}

// La Guía termina con su etapa: con route.json (verificada o no) o, si falló, con lo que exploró.
function finDeLaGuia({ estado, recorrido }) {
  if (recorrido?.archivo === "route.json") {
    const status = texto(recorrido.datos.status);
    return { outcome: status === "verified" ? "success" : "failed", end_reason: status || "done" };
  }
  if (estado === "failed") return { outcome: "failed", end_reason: "failed" };
  return CERRADO.has(estado) ? { outcome: "error", end_reason: estado } : null;
}

// Un intento termina con su run.json (veredicto), con una traza "failed" (se interrumpió) o cuando la etapa se cerró
// sin run.json. Una traza "succeeded" espera el veredicto, que llega con run.json al cerrar la etapa.
function finDelIntento({ archivo, datos }, estadoDeLaEtapa) {
  if (archivo === "run.json") return { outcome: RESULTADOS[datos.verdict?.outcome] ?? "abandoned", end_reason: texto(datos.end_reason) || "done" };
  if (datos.status === "failed") return { outcome: "error", end_reason: "interrupted" };
  return CERRADO.has(estadoDeLaEtapa) ? { outcome: "error", end_reason: texto(datos.status) || estadoDeLaEtapa } : null;
}

const ordenar = (a, b) =>
  a.ts.localeCompare(b.ts) || (a.agent === b.agent ? 0 : a.agent === "guide" ? -1 : 1) || a.run_id.localeCompare(b.run_id) ||
  a.step - b.step || ORDEN_DEL_TIPO[a.type] - ORDEN_DEL_TIPO[b.type];

/**
 * Todos los eventos conocidos de un goal, en orden de ts y sin ids repetidos (una Guía que reempieza su exploración
 * repite números de paso: vale el primero).
 * @param {{ revision: string, host: string | null, goal: { goal: string, guide: object, visitor: object } }} leido
 */
export function eventosDelGoal({ revision, host, goal: { goal, guide, visitor } }) {
  const comun = { revision, host, goal };
  const eventos = [];
  const recorridoGuia = guide.recorrido ? recorridoDe(guide.recorrido.datos, { guia: true }) : null;
  if (recorridoGuia && guide.runKey) {
    eventos.push(...eventosDeRecorrido(recorridoGuia, { ...comun, agent: "guide", runKey: guide.runKey, attempt: PERFIL_DE_LA_GUIA, fin: finDeLaGuia(guide) }));
  }
  for (const intento of visitor.runKey ? visitor.intentos ?? [] : []) {
    const recorrido = recorridoDe(intento.datos, { carpeta: intento.carpeta });
    if (!recorrido) continue;
    eventos.push(
      ...eventosDeRecorrido(recorrido, { ...comun, agent: "visitor", runKey: visitor.runKey, attempt: intento.carpeta, fin: finDelIntento(intento, visitor.estado) }),
    );
  }
  const vistos = new Set();
  return eventos.filter((evento) => !vistos.has(evento.id) && vistos.add(evento.id)).sort(ordenar);
}

/** La ruta verificada de la Guía como páginas [{ url, title }] (sin repetir una página seguida), o null. */
export function rutaDeLaGuia(guide) {
  const { archivo, datos } = guide?.recorrido ?? {};
  if (archivo !== "route.json" || datos.status !== "verified") return null;
  const recorrido = recorridoDe(datos, { guia: true });
  if (!recorrido) return null;
  const paginas = [recorrido.start, ...recorrido.steps].map((paso) => ({ clave: claveDeNodo(paso.url, paso.title), ...pagina(paso.url, paso.title) }));
  return paginas.filter((actual, i) => i === 0 || actual.clave !== paginas[i - 1].clave).map(({ url, title }) => ({ url, title }));
}

/** true cuando ya no habrá más eventos del goal: el Visitante cerró (o no se lanzará) o la revisión terminó. */
export const goalTerminado = ({ estado, goal }) => CERRADO.has(goal.visitor.estado) || estado === "done" || estado === "failed";

/**
 * Lo que falta enviar de cada lectura: los eventos que no salieron antes, y el end de cada intento una sola vez.
 * Con `ultimoId` (Last-Event-ID), la primera lectura da por enviado todo hasta ese evento; si ya no está, lo de su
 * intento hasta ese paso.
 * @param {string | null} [ultimoId]
 * @returns {(eventos: object[]) => object[]}
 */
export function crearSeguimiento(ultimoId = null) {
  const enviados = new Set();
  const terminados = new Set();
  let pendiente = ultimoId ? String(ultimoId) : null;
  return function nuevos(eventos) {
    if (pendiente) {
      const hasta = eventos.findIndex((evento) => evento.id === pendiente);
      const [runKey, intento, paso] = pendiente.split("|");
      const yaEnviado = hasta >= 0
        ? (_, i) => i <= hasta
        : (evento) => evento.run_id === `${runKey}|${intento}` && (evento.type !== "end" ? evento.step <= Number(paso) : pendiente.endsWith("|end"));
      eventos.forEach((evento, i) => {
        if (!yaEnviado(evento, i)) return;
        enviados.add(evento.id);
        if (evento.type === "end") terminados.add(evento.run_id);
      });
      pendiente = null;
    }
    const salen = [];
    for (const evento of eventos) {
      if (enviados.has(evento.id) || (evento.type === "end" && terminados.has(evento.run_id))) continue;
      enviados.add(evento.id);
      if (evento.type === "end") terminados.add(evento.run_id);
      salen.push(evento);
    }
    return salen;
  };
}
