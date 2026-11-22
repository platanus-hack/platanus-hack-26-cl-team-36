// Revisiones del flujo en AWS, leídas de la tabla DynamoDB `chameleon-revisiones` (la escriben la API y la Lambda
// proyectora; el backoffice solo lee). Una revisión es un ítem META y uno por etapa (STAGE#…) o goal (GOAL#…).

import { REVISION, partesDeCorrida } from "../public/nucleo/almacen.js";

const CERRADO = new Set(["succeeded", "failed"]);
// Lo que se enlaza de una corrida terminada, además de su manifest.json.
const PRINCIPAL = { cataloger: "goals.json", guide: "route.json", improver: "tema.css" };
export const ARCHIVO_DE_RESULTADO = /^(?:manifest\.json|goals\.json|route\.json|tema\.css)$/;

export const esRevision = (valor) => REVISION.test(String(valor ?? ""));

/** "<clave de corrida>/<archivo>" → { runKey, archivo }, o null si no es un resultado que se pueda servir. */
export function partesDeResultado(clave) {
  const texto = String(clave ?? "");
  const corte = texto.lastIndexOf("/");
  const runKey = texto.slice(0, corte);
  const archivo = texto.slice(corte + 1);
  return corte > 0 && ARCHIVO_DE_RESULTADO.test(archivo) && partesDeCorrida(runKey) ? { runKey, archivo } : null;
}

// Acepta la clave de la corrida o la de su manifiesto.
function claveDeCorrida(valor) {
  const clave = String(valor ?? "").replace(/\/manifest\.json$/, "").replace(/\/+$/, "");
  return partesDeCorrida(clave) ? clave : null;
}

function paso(item, etapa) {
  const estado = item?.status ?? "pending";
  const runKey = item ? claveDeCorrida(item.run_key) : null;
  const resultados = [];
  if (runKey && CERRADO.has(estado)) {
    if (estado === "succeeded" && etapa === "visitor") resultados.push({ tanda: runKey });
    if (estado === "succeeded" && PRINCIPAL[etapa]) resultados.push({ archivo: PRINCIPAL[etapa], clave: `${runKey}/${PRINCIPAL[etapa]}` });
    resultados.push({ archivo: "manifest.json", clave: `${runKey}/manifest.json` });
  }
  return { estado, runKey, actualizada: item?.updated_at ?? null, resultados };
}

const numero = (valor) => (valor === undefined || valor === null || valor === "" ? null : Number(valor));

/** Lo que muestra la lista: un ítem META. */
export function resumenDeMeta(item) {
  return {
    revision: String(item.PK).replace(/^REV#/, ""),
    url: item.url ?? null,
    host: item.host ?? null,
    estado: item.status ?? "queued",
    goalsTotal: numero(item.goals_total),
    css: partesDeResultado(item.css_key) ? item.css_key : null,
    creada: item.created_at ?? null,
    actualizada: item.updated_at ?? null,
  };
}

/**
 * El avance de una revisión a partir de todos sus ítems (Query por PK = REV#<revision>), o null si no tiene META.
 * `progreso` cuenta pasos cerrados (succeeded o failed) sobre los esperados: catálogo, guide y visitor por goal, improver.
 */
export function avanceDeRevision(items) {
  const meta = items.find((item) => item.SK === "META");
  if (!meta) return null;
  const etapa = (nombre) => items.find((item) => item.SK === `STAGE#${nombre}`);
  const porGoal = new Map();
  for (const item of items) {
    const partes = /^GOAL#(.+)#(guide|visitor)$/.exec(item.SK ?? "");
    if (!partes) continue;
    if (!porGoal.has(partes[1])) porGoal.set(partes[1], {});
    porGoal.get(partes[1])[partes[2]] = item;
  }
  const goals = [...porGoal.keys()].sort().map((goal) => ({
    goal,
    guide: paso(porGoal.get(goal).guide, "guide"),
    visitor: paso(porGoal.get(goal).visitor, "visitor"),
  }));
  const resumen = resumenDeMeta(meta);
  const catalogo = paso(etapa("cataloger"), "cataloger");
  const improver = paso(etapa("improver"), "improver");

  const conocidos = Math.max(resumen.goalsTotal ?? 0, goals.length);
  const pasos = [catalogo, improver, ...goals.flatMap((g) => [g.guide, g.visitor])];
  return {
    ...resumen,
    catalogo,
    goals,
    improver,
    progreso: {
      cerrados: pasos.filter((p) => CERRADO.has(p.estado)).length,
      total: 2 + 2 * conocidos,
      goalsConocidos: resumen.goalsTotal !== null || goals.length > 0,
    },
  };
}

const porFecha = (a, b) => String(b.creada ?? "").localeCompare(String(a.creada ?? "")) || a.revision.localeCompare(b.revision);

/**
 * @param {{ tabla: string, cliente: { send: Function }, comandos: { QueryCommand: Function, ScanCommand: Function } }} opciones
 *        cliente de lib-dynamodb (ítems como objetos planos)
 */
export function crearRevisiones({ tabla, cliente, comandos }) {
  const { QueryCommand, ScanCommand } = comandos;
  async function todas(Comando, entrada) {
    const items = [];
    let desde;
    do {
      const pagina = await cliente.send(new Comando({ TableName: tabla, ...entrada, ExclusiveStartKey: desde }));
      items.push(...(pagina.Items ?? []));
      desde = pagina.LastEvaluatedKey;
    } while (desde);
    return items;
  }
  return {
    descripcion: `dynamodb://${tabla}`,

    /** Resúmenes de todas las revisiones, de la más nueva a la más vieja. */
    async listar() {
      const metas = await todas(ScanCommand, { FilterExpression: "SK = :meta", ExpressionAttributeValues: { ":meta": "META" } });
      return metas.map(resumenDeMeta).sort(porFecha);
    },

    /** El avance de una revisión, o null si no existe. */
    async leer(revision) {
      if (!esRevision(revision)) return null;
      const items = await todas(QueryCommand, { KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": `REV#${revision}` } });
      return avanceDeRevision(items);
    },
  };
}
