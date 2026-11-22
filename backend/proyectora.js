// Lambda proyectora: cada manifest.json que llega al almacén (evento S3) se refleja
// en la tabla de revisiones. S3 es la fuente de verdad; la tabla solo resume.

import { ORDEN_ETAPA, ORDEN_META, claveRevision, previos } from "./estados.js";

const MANIFIESTO = "/manifest.json";
const META_DE = { running: "running", succeeded: "done", failed: "failed" };

// Misma selección que el conductor (agents/shared, catalog/goal.py `routable`): user_goal
// sin barreras, los más escondidos primero y luego por id, hasta `goalsMax`.
const BARRERAS = ["login", "personal_data", "bot_check"];
const PROMINENCIA = ["buried", "secondary", "primary"];

export function goalsElegidos(goals, goalsMax) {
  return goals
    .filter((goal) => goal.level === "user_goal" && ![].concat(goal.gates ?? []).some((gate) => BARRERAS.includes(gate)))
    .sort((a, b) => PROMINENCIA.indexOf(a.prominence) - PROMINENCIA.indexOf(b.prominence) || (a.id < b.id ? -1 : 1))
    .slice(0, goalsMax)
    .map((goal) => goal.id);
}

export function crearProyectora({ db, almacen, ahora = () => new Date(), goalsMax = 3 }) {
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

  return async function proyectar(clave) {
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
      case "improver":
        await avanzarEtapa(revision, `STAGE#${agent}`, status, { run_key, updated_at });
        if (status !== "succeeded") break;
        if (agent === "cataloger") await crearGoals(revision, run_key, updated_at);
        else await actualizarMeta(revision, { css_key: `${run_key}/tema.css`, updated_at });
        break;
      case "guide":
      case "visitor":
        if (typeof goal === "string" && goal) await avanzarEtapa(revision, `GOAL#${goal}#${agent}`, status, { run_key, updated_at });
        break;
    }
  };
}

// Las claves de los eventos S3 vienen codificadas como en un formulario.
export const claveDeEvento = (registro) => decodeURIComponent(registro.s3.object.key.replace(/\+/g, " "));

let proyectar;

export async function handler(evento) {
  if (!proyectar) {
    const { almacenS3, tablaDynamo } = await import("./aws.js");
    proyectar = crearProyectora({
      db: await tablaDynamo(process.env.REVISIONES_TABLA),
      almacen: await almacenS3(process.env.ALMACEN_BUCKET),
      goalsMax: Number(process.env.GOALS_MAX) || 3,
    });
  }
  // Si algo falla, Lambda reintenta el evento entero: proyectar es idempotente.
  for (const registro of evento.Records ?? []) await proyectar(claveDeEvento(registro));
}
