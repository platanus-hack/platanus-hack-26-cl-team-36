// Lambda proyectora: cada manifest.json y trace.json que llega al almacén (evento S3) se
// refleja en la tabla de revisiones. S3 es la fuente de verdad; la tabla solo resume.

import { ORDEN_ETAPA, ORDEN_META, claveRevision, previos } from "./estados.js";

const MANIFIESTO = "/manifest.json";
const TRAZA = "/trace.json";
const META_DE = { running: "running", succeeded: "done", failed: "failed" };

// Misma selección que el conductor (agents/shared, catalog/goal.py `for_revision`): user_goal
// sin barreras que lo excluyan, ordenados: primero los que no salen del sitio, luego sin barreras,
// los más demandados, los más prominentes y en el orden del catálogo. Hasta `goalsMax`, un tercio
// largos y otro tercio medianos (lo que falte de un nivel lo completa el siguiente) y el resto, los primeros.
const BARRERAS = ["login", "personal_data", "bot_check"];
const PROMINENCIA = ["buried", "secondary", "primary"];
const DEMANDA = ["top", "common", "rare"];

// Como `site_host` de agents/shared (nodes/urls.py): sin www y con el puerto si no es el de siempre.
const sitio = (url) => new URL(url).host.toLowerCase().replace(/^www\./, "");

function saleDelSitio(goal) {
  if (!goal.entry) return false;
  try {
    const host = sitio(new URL(goal.entry, goal.start_url)), propio = sitio(goal.start_url);
    return host !== propio && !host.endsWith(`.${propio}`);
  } catch {
    return true;
  }
}

// Como `depth` de goal.py: long con formulario o 5 pasos o más, medium con 3 o 4, short con 1 o 2.
export function profundidad(goal) {
  const pasos = Number.isInteger(goal.estimated_steps) ? goal.estimated_steps : null;
  if (goal.submits_form || (pasos ?? 0) >= 5) return "long";
  if (pasos === null) return null;
  return pasos >= 3 ? "medium" : "short";
}

export function goalsElegidos(goals, goalsMax) {
  const demanda = (goal) => (DEMANDA.includes(goal.demand) ? DEMANDA.indexOf(goal.demand) : DEMANDA.indexOf("common"));
  const orden = (goal) => [
    saleDelSitio(goal) ? 1 : 0,
    [].concat(goal.gates ?? []).length ? 1 : 0,
    demanda(goal),
    -PROMINENCIA.indexOf(goal.prominence),
  ];
  const comparar = (a, b) => a.reduce((diferencia, valor, i) => diferencia || valor - b[i], 0);
  const candidatos = goals
    .filter((goal) => goal.level === "user_goal" && ![].concat(goal.gates ?? []).some((gate) => BARRERAS.includes(gate)))
    .map((goal) => ({ goal, clave: orden(goal) }))
    .sort((a, b) => comparar(a.clave, b.clave))
    .map(({ goal }) => goal);
  if (!(goalsMax < candidatos.length)) return candidatos.map((goal) => goal.id);
  const cuota = Math.floor(goalsMax / 3);
  const elegidos = new Set();
  for (const [nivel, quiero] of [["long", cuota], ["medium", 2 * cuota]]) {
    const faltan = quiero - elegidos.size;
    candidatos.filter((goal) => profundidad(goal) === nivel).slice(0, Math.max(faltan, 0)).forEach((goal) => elegidos.add(goal));
  }
  candidatos.filter((goal) => !elegidos.has(goal)).slice(0, goalsMax - elegidos.size).forEach((goal) => elegidos.add(goal));
  return candidatos.filter((goal) => elegidos.has(goal)).map((goal) => goal.id);
}

const GOAL = /^GOAL#(.+)#(guide|visitor)$/;

// Foto de la revisión a partir de todos sus ítems: no depende del orden de los eventos.
export function resumir(items) {
  const vacia = () => Object.fromEntries(Object.keys(ORDEN_ETAPA).map((estado) => [estado, 0]));
  const fases = { catalog: vacia(), guide: vacia(), visitor: vacia(), improver: vacia() };
  const contar = (fase, status) => Object.hasOwn(fases[fase], status) && fases[fase][status]++;
  const etapa = (SK) => items.find((item) => item.SK === SK)?.status ?? "pending";
  contar("catalog", etapa("STAGE#cataloger"));
  contar("improver", etapa("STAGE#improver"));
  const goals = new Set();
  let pasos = 0;
  for (const item of items) {
    const [, goal, agente] = GOAL.exec(item.SK) ?? [];
    if (!goal) continue;
    goals.add(goal);
    contar(agente, item.status);
    if (Number.isFinite(item.step)) pasos += item.step;
  }
  const agentes_activos = Object.values(fases).reduce((total, fase) => total + fase.running, 0);
  return { fases, agentes_activos, pasos, goals_total: goals.size };
}

// <host>/guide/<goal>/<viewport>/<run>/trace.json o <host>/visitor/<goal>/<run>/<carpeta>/trace.json
function rutaDeTraza(clave) {
  const [, agente, goal, ...resto] = clave.split("/");
  return ["guide", "visitor"].includes(agente) && goal && resto.length === 3 ? { agente, goal } : null;
}

const texto = (valor) => (typeof valor === "string" ? valor : null);

// Lo último que hizo el agente: route.json (Guía) y run.json (Visitante) nombran distinto los campos del paso.
function ultimoPaso({ steps, start }) {
  const paso = steps.at(-1);
  if (!paso || typeof paso !== "object") {
    return { last_action: null, last_url: texto(start?.url), last_title: texto(start?.title) };
  }
  return {
    last_action: texto(paso.label ?? paso.description ?? paso.action),
    last_url: texto(paso.url_after ?? paso.url),
    last_title: texto(paso.title_after ?? paso.title),
  };
}

export function crearProyectora({ db, almacen, ahora = () => new Date(), goalsMax = 6 }) {
  const avanzarEtapa = (revision, SK, status, atributos) =>
    db.actualizar(claveRevision(revision, SK), { status, ...atributos }, { previos: previos(ORDEN_ETAPA, status) });

  // `existente`: un manifiesto con una revisión que la API no creó no inventa su META.
  const actualizarMeta = (revision, atributos, opciones) =>
    db.actualizar(claveRevision(revision), atributos, { existente: true, ...opciones });

  // goals_total es la estimación del catálogo; si el conductor elige otros, sus GOAL# aparecen igual.
  async function crearGoals(revision, runKey, updated_at) {
    const goals = (await leerJsonValido(`${runKey}/goals.json`))?.goals;
    if (!Array.isArray(goals)) return;
    const ids = goalsElegidos(goals.filter((goal) => goal && typeof goal.id === "string"), goalsMax);
    for (const id of ids) {
      for (const agente of ["guide", "visitor"]) {
        await avanzarEtapa(revision, `GOAL#${id}#${agente}`, "pending", { updated_at });
      }
    }
    await actualizarMeta(revision, { goals_total: ids.length, updated_at });
  }

  // Un JSON malformado se salta con un aviso: reintentar no lo arregla.
  async function leerJsonValido(clave) {
    try {
      return await almacen.leerJson(clave);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn(`✖ ${clave}: JSON inválido`);
      return null;
    }
  }

  // El tema.json es opcional: cualquier error al buscarlo cuenta como que no está y no frena el registro de css_key.
  // Sin s3:ListBucket, S3 responde 403 (no 404) por un objeto que no existe: eso tampoco se avisa.
  async function existeTema(clave) {
    try {
      await almacen.cabecera(clave);
      return true;
    } catch (error) {
      if (!["NotFound", "NoSuchKey", "Forbidden", "AccessDenied"].includes(error.name)) {
        console.warn(`✖ ${clave}: no se pudo ver si existe, se registra sin tema (${error.name}: ${error.message})`);
      }
      return false;
    }
  }

  // `resumen_version`: si otro escribió un resumen después de esta consulta, puede no ver este evento; se vuelve a consultar.
  async function guardarResumen(revision, intentos = 10) {
    const items = await db.listar(claveRevision(revision).PK);
    const meta = items.find((item) => item.SK === "META");
    if (!meta) return;
    const { resumen_version: version } = meta;
    const atributos = { resumen: resumir(items), resumen_version: (version ?? 0) + 1, updated_at: ahora().toISOString() };
    if (await actualizarMeta(revision, atributos, { igual: { resumen_version: version } })) return;
    if (intentos <= 1) throw new Error(`No se pudo guardar el resumen de ${revision}`);
    await guardarResumen(revision, intentos - 1);
  }

  // Con --runs el Visitante tiene un trace.json por intento: su GOAL muestra el último que avanzó (`trace_at`).
  async function proyectarTraza(clave) {
    const ruta = rutaDeTraza(clave);
    const traza = ruta && (await leerJsonValido(clave));
    const { revision, steps = [], start, updated_at: trace_at } = traza && typeof traza === "object" ? traza : {};
    if (!ruta || typeof revision !== "string" || !revision || !Array.isArray(steps) || typeof trace_at !== "string") {
      console.warn(`✖ ${clave}: traza inválida o sin revisión`);
      return;
    }
    const items = await db.listar(claveRevision(revision).PK);
    if (!items.some((item) => item.SK === "META")) {
      console.warn(`✖ ${clave}: no existe la revisión ${revision}`);
      return;
    }
    const SK = `GOAL#${ruta.goal}#${ruta.agente}`;
    const updated_at = ahora().toISOString();
    const avance = { step: steps.length, ...ultimoPaso({ steps, start }), trace_key: clave, trace_at, updated_at };
    await db.actualizar(claveRevision(revision, SK), avance, { hasta: { trace_at } });
    const status = items.find((item) => item.SK === SK)?.status;
    if (status === undefined || status === "pending") await avanzarEtapa(revision, SK, "running", { updated_at });
    await guardarResumen(revision);
  }

  return async function proyectar(clave) {
    if (clave.endsWith(TRAZA)) return proyectarTraza(clave);
    if (!clave.endsWith(MANIFIESTO)) return;
    const { agent, goal, status, revision } = (await leerJsonValido(clave)) ?? {};
    if (typeof revision !== "string" || !revision || !Object.hasOwn(META_DE, status)) return;
    const run_key = clave.slice(0, -MANIFIESTO.length);
    const updated_at = ahora().toISOString();

    switch (agent) {
      case "conductor": {
        const meta = META_DE[status];
        await actualizarMeta(revision, { status: meta, updated_at }, { previos: previos(ORDEN_META, meta) });
        break;
      }
      case "cataloger":
        await avanzarEtapa(revision, `STAGE#${agent}`, status, { run_key, updated_at });
        if (status === "succeeded") await crearGoals(revision, run_key, updated_at);
        break;
      case "improver": {
        const avanzo = await avanzarEtapa(revision, `STAGE#${agent}`, status, { run_key, updated_at });
        if (status !== "succeeded") break;
        // Otra corrida terminada de la misma revisión (just aws improve) reemplaza a la anterior si es más nueva; los
        // ids de corrida ordenan como texto. Una vieja que llega tarde no.
        const reemplaza =
          avanzo ||
          (await db.actualizar(claveRevision(revision, `STAGE#${agent}`), { run_key, updated_at }, { igual: { status }, hasta: { run_key } }));
        if (!reemplaza) break;
        // null y no undefined: sin tema.json, el de la corrida anterior ya no corresponde.
        const tema_key = (await existeTema(`${run_key}/tema.json`)) ? `${run_key}/tema.json` : null;
        const css_key = `${run_key}/tema.css`;
        // El tema listo termina la revisión en la misma escritura: done nunca llega antes que su css_key. Pasa
        // también sobre un failed del conductor, que es del mismo orden y pudo llegar antes por el desorden de S3.
        await actualizarMeta(revision, { css_key, tema_key, status: "done", updated_at }, { hasta: { css_key } });
        break;
      }
      case "guide":
      case "visitor":
        if (typeof goal !== "string" || !goal) break;
        await avanzarEtapa(revision, `GOAL#${goal}#${agent}`, status, { run_key, updated_at });
        if (agent === "guide" && status === "failed") {
          await db.actualizar(claveRevision(revision, `GOAL#${goal}#visitor`), { status: "skipped", updated_at }, { previos: ["pending"] });
        }
        break;
    }
    await guardarResumen(revision);
  };
}

// Las claves de los eventos S3 vienen codificadas como en un formulario.
export const claveDeEvento = (registro) => decodeURIComponent(registro.s3.object.key.replace(/\+/g, " "));

let proyectar;

function iniciar() {
  proyectar ??= (async () => {
    const { almacenS3, tablaDynamo } = await import("./aws.js");
    const [db, almacen] = await Promise.all([tablaDynamo(process.env.REVISIONES_TABLA), almacenS3(process.env.ALMACEN_BUCKET)]);
    return crearProyectora({ db, almacen, goalsMax: Number(process.env.GOALS_MAX) || 6 });
  })().catch((error) => {
    proyectar = undefined;
    throw error;
  });
  return proyectar;
}

// Carga el SDK durante el arranque en frío; si falla, el evento lo reintenta.
if (process.env.REVISIONES_TABLA) iniciar().catch(() => {});

export async function handler(evento) {
  const proyectarClave = await iniciar();
  // Si algo falla, Lambda reintenta el evento entero: proyectar es idempotente.
  for (const registro of evento.Records ?? []) await proyectarClave(claveDeEvento(registro));
}
