// Revisiones del flujo en AWS, leídas de la tabla DynamoDB `chameleon-revisiones` (la escriben la API y la Lambda
// proyectora; el backoffice solo lee). Una revisión es un ítem META y uno por etapa (STAGE#…) o goal (GOAL#…).
//
// GET /api/revisiones → { disponible, revisiones: [{ revision, url, host, estado, goalsTotal, css, creada, actualizada,
//   resumen | null, anteriores }], historial: [lo mismo sin anteriores] }
//   revisiones: la vigente de cada página (revisionesVigentes), aunque esté en curso; historial: las que reemplazó.
// GET /api/revisiones/<rev> → lo mismo de su META, más:
//   resumen: { fases: { catalog|guide|visitor|improver: { pending, running, succeeded, failed, skipped } }, agentesActivos,
//              pasos, goalsTotal, calculado }   (calculado: true si META no lo traía y salió de los ítems)
//   catalogo, improver: { estado, runKey, actualizada, resultados }
//   goals: [{ goal,
//     guide:   { estado, runKey, actualizada, resultados, pasos, ultimo: { accion, url, titulo } | null, traza, trazaActualizada,
//                recorrido: { archivo: "route.json" | "trace.json" } | null },
//     visitor: { …lo mismo sin recorrido…, intentos: [{ carpeta, archivo: "run.json" | "trace.json" }] },
//     telarana: { fuente: "vivo" | "tanda", tanda: <id de tanda> | null, paginas, ramas, ruta: { paginas } | null } | null }]
//   Los archivos leídos no viajan (leerGoal() sí los da, para lib/eventos.js). La telaraña tiene ids estables entre
//   refrescos (URL sin consulta + título); con el Visitante terminado es la de la tanda (lib/vivo.js).
//   progreso: { cerrados, total, goalsConocidos }
//   estado de un paso: pending | running | succeeded | failed | skipped (Visitante no lanzado porque su Guía falló, solo en revisiones viejas).

import { REVISION, partesDeCorrida } from "../public/nucleo/almacen.js";
import { leerSinVecinas } from "./tandas.js";
import { recorridoDe, telaranaCompacta, telaranaEnVivo } from "./vivo.js";

const CERRADO = new Set(["succeeded", "failed", "skipped"]);
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

/**
 * La run_key de un ítem de la tabla, solo si es una corrida del rol esperado (y, con `goal`, de ese goal): la misma
 * regla que paso(). Lo que lee del almacén el Overview (lib/panel.js) pasa por aquí. → la clave de la corrida o null.
 * @param {object | null | undefined} item
 * @param {"cataloger" | "guide" | "visitor" | "improver"} rol
 * @param {string} [goal]
 */
export function claveDeCorridaDelItem(item, rol, goal) {
  const clave = item ? claveDeCorrida(item.run_key) : null;
  const corrida = clave ? partesDeCorrida(clave) : null;
  if (!corrida || corrida.agente !== rol || (goal !== undefined && corrida.objetivo !== goal)) return null;
  return clave;
}

/** La clave de la corrida del improver de un css_key de META ("<corrida>/tema.css"), o null. */
export function claveDelTema(cssKey) {
  const resultado = partesDeResultado(cssKey);
  return resultado?.archivo === "tema.css" && partesDeCorrida(resultado.runKey)?.agente === "improver" ? resultado.runKey : null;
}

const CARPETA = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const TRAZA = "trace.json";

/**
 * La clave de un trace.json de la tabla, validada contra la etapa y el goal: "<corrida>/trace.json" (Guía) o
 * "<corrida>/<carpeta del intento>/trace.json" (Visitante). → { runKey, carpeta } o null.
 */
export function partesDeTraza(clave, etapa, goal) {
  const partes = String(clave ?? "").split("/");
  if (partes.at(-1) !== TRAZA) return null;
  const carpeta = etapa === "visitor" ? partes.at(-2) : null;
  const runKey = partes.slice(0, etapa === "visitor" ? -2 : -1).join("/");
  const corrida = partesDeCorrida(runKey);
  if (!corrida || corrida.agente !== etapa || (goal !== undefined && corrida.objetivo !== goal)) return null;
  if (etapa === "visitor" && !CARPETA.test(carpeta ?? "")) return null;
  return { runKey, carpeta };
}

const numero = (valor) => (valor === undefined || valor === null || valor === "" || !Number.isFinite(Number(valor)) ? null : Number(valor));
const textoONulo = (valor) => (typeof valor === "string" && valor ? valor : null);

function paso(item, etapa, goal) {
  const estado = item?.status ?? "pending";
  let runKey = item ? claveDeCorrida(item.run_key) : null;
  // Una run_key de otra etapa u otro goal no se lee.
  const corrida = runKey ? partesDeCorrida(runKey) : null;
  if (goal !== undefined && corrida && (corrida.agente !== etapa || corrida.objetivo !== goal)) runKey = null;
  const traza = goal !== undefined ? partesDeTraza(item?.trace_key, etapa, goal) : null;
  const trazaValida = traza && (!runKey || traza.runKey === runKey) ? traza : null;
  const resultados = [];
  if (runKey && CERRADO.has(estado)) {
    if (estado === "succeeded" && etapa === "visitor") resultados.push({ tanda: runKey });
    if (estado === "succeeded" && PRINCIPAL[etapa]) resultados.push({ archivo: PRINCIPAL[etapa], clave: `${runKey}/${PRINCIPAL[etapa]}` });
    resultados.push({ archivo: "manifest.json", clave: `${runKey}/manifest.json` });
  }
  const base = { estado, runKey, actualizada: item?.updated_at ?? null, resultados };
  if (goal === undefined) return base;
  const ultimo = item && (item.last_action || item.last_url || item.last_title)
    ? { accion: textoONulo(item.last_action), url: textoONulo(item.last_url), titulo: textoONulo(item.last_title) }
    : null;
  return {
    ...base,
    runKey: runKey ?? trazaValida?.runKey ?? null,
    pasos: numero(item?.step),
    ultimo,
    traza: trazaValida ? [trazaValida.runKey, trazaValida.carpeta, TRAZA].filter(Boolean).join("/") : null,
    trazaActualizada: trazaValida ? textoONulo(item.trace_at) : null,
  };
}

export const FASES = ["catalog", "guide", "visitor", "improver"];
const ESTADOS = ["pending", "running", "succeeded", "failed", "skipped"];
const fasesVacias = () => Object.fromEntries(FASES.map((fase) => [fase, Object.fromEntries(ESTADOS.map((e) => [e, 0]))]));
const entero = (valor) => Math.max(0, Math.trunc(numero(valor) ?? 0));

// Como pasosDelGoal de backend/proyectora.js: con varios intentos, los de cada uno (`step#<carpeta>`); si no, `step`.
function pasosDelGoal(item) {
  const porIntento = Object.keys(item).filter((nombre) => nombre.startsWith("step#"));
  return porIntento.length ? porIntento.reduce((total, nombre) => total + entero(item[nombre]), 0) : entero(item.step);
}

/**
 * El resumen por fase que la proyectora guarda en META (`resumen`), calculado desde los ítems: para revisiones viejas
 * que no lo tienen. Los goals que META anuncia y todavía no tienen ítem cuentan como pendientes.
 */
export function calcularResumen(items) {
  const meta = items.find((item) => item.SK === "META") ?? {};
  const fases = fasesVacias();
  const contar = (fase, estado) => {
    fases[fase][ESTADOS.includes(estado) ? estado : "pending"] += 1;
  };
  contar("catalog", items.find((item) => item.SK === "STAGE#cataloger")?.status);
  contar("improver", items.find((item) => item.SK === "STAGE#improver")?.status);
  const goals = new Set();
  let pasos = 0;
  for (const item of items) {
    const partes = /^GOAL#(.+)#(guide|visitor)$/.exec(item.SK ?? "");
    if (!partes) continue;
    goals.add(partes[1]);
    contar(partes[2], item.status);
    pasos += pasosDelGoal(item);
  }
  const goalsTotal = Math.max(numero(meta.goals_total) ?? 0, goals.size);
  for (const fase of ["guide", "visitor"]) {
    const conocidos = ESTADOS.reduce((suma, estado) => suma + fases[fase][estado], 0);
    fases[fase].pending += Math.max(0, goalsTotal - conocidos);
  }
  const agentesActivos = FASES.reduce((suma, fase) => suma + fases[fase].running, 0);
  return { fases, agentesActivos, pasos, goalsTotal, calculado: true };
}

/** El `resumen` de META con forma fija (números no negativos), o el calculado si falta o no es un objeto. */
export function resumenDeRevision(items) {
  const crudo = items.find((item) => item.SK === "META")?.resumen;
  if (!crudo || typeof crudo !== "object" || !crudo.fases || typeof crudo.fases !== "object") return calcularResumen(items);
  const fases = fasesVacias();
  for (const fase of FASES) for (const estado of ESTADOS) fases[fase][estado] = entero(crudo.fases[fase]?.[estado]);
  return { fases, agentesActivos: entero(crudo.agentes_activos), pasos: entero(crudo.pasos), goalsTotal: entero(crudo.goals_total), calculado: false };
}

/** Lo que muestra la lista: un ítem META. */
export function resumenDeMeta(item) {
  return {
    revision: String(item.PK).replace(/^REV#/, ""),
    url: item.url ?? null,
    host: item.host ?? null,
    estado: item.status ?? "queued",
    goalsTotal: numero(item.goals_total),
    css: partesDeResultado(item.css_key)?.archivo === "tema.css" ? item.css_key : null,
    creada: item.created_at ?? null,
    actualizada: item.updated_at ?? null,
    // En la lista solo el que guardó la proyectora: calcularlo pediría los ítems de cada revisión.
    resumen: item.resumen && typeof item.resumen === "object" ? resumenDeRevision([item]) : null,
  };
}

/**
 * El avance de una revisión a partir de todos sus ítems (Query por PK = REV#<revision>), o null si no tiene META.
 * `progreso` cuenta pasos cerrados (succeeded, failed o skipped) sobre los esperados: catálogo, guide y visitor por goal, improver.
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
    guide: paso(porGoal.get(goal).guide, "guide", goal),
    visitor: paso(porGoal.get(goal).visitor, "visitor", goal),
    telarana: null,
  }));
  const resumen = resumenDeMeta(meta);
  const catalogo = paso(etapa("cataloger"), "cataloger");
  const improver = paso(etapa("improver"), "improver");

  const conocidos = Math.max(resumen.goalsTotal ?? 0, goals.length);
  const pasos = [catalogo, improver, ...goals.flatMap((g) => [g.guide, g.visitor])];
  return {
    ...resumen,
    resumen: resumenDeRevision(items),
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

const idDe = (meta) => String(meta?.PK ?? "").replace(/^REV#/, "");

/** La URL del ítem URL#<url> (backend/urls.js) que le corresponde al `url` de META (origin + pathname), o null. */
export function paginaDeRevision(url) {
  try {
    const partes = new URL(url);
    const nombre = partes.hostname.replace(/\.$/, "").replace(/^www\./, "");
    return `${partes.protocol}//${partes.port ? `${nombre}:${partes.port}` : nombre}${partes.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Qué revisiones están vigentes: la que apunta el ítem URL#<url> de su página (`revision`). Las demás de esa página
 * quedan en el historial (un `force` deja la anterior ahí). Una página sin ese ítem, o con uno que apunta a una
 * revisión sin META, deja vigentes todas las suyas.
 * @param {object[]} metas     ítems META
 * @param {object[]} punteros  ítems SK = URL
 * @returns {{ vigentes: Set<string>, anteriores: Map<string, number> }}  anteriores: por revisión vigente, cuántas reemplazó
 */
export function revisionesVigentes(metas, punteros) {
  const ids = new Set(metas.map(idDe));
  const apuntada = new Map(
    punteros.filter((item) => item?.SK === "URL" && ids.has(item.revision)).map((item) => [String(item.PK).replace(/^URL#/, ""), item.revision]),
  );
  const vigentes = new Set();
  const anteriores = new Map();
  for (const meta of metas) {
    const id = idDe(meta);
    const actual = apuntada.get(paginaDeRevision(meta.url));
    if (actual === undefined || actual === id) vigentes.add(id);
    else anteriores.set(actual, (anteriores.get(actual) ?? 0) + 1);
  }
  return { vigentes, anteriores };
}

const porFecha = (a, b) => String(b.creada ?? "").localeCompare(String(a.creada ?? "")) || a.revision.localeCompare(b.revision);

const LIMITE_EN_MEMORIA = 500;
// Por refresco, un Visitante en curso cuesta un LIST y un GET por intento: con este tope, a lo más 1 + 12.
const LIMITE_DE_INTENTOS = 12;

function recordar(mapa, clave, valor) {
  mapa.delete(clave);
  mapa.set(clave, valor);
  if (mapa.size > LIMITE_EN_MEMORIA) mapa.delete(mapa.keys().next().value);
}

const MEMORIA_MS = 2000;
// El SDK no tiene plazos: una lectura colgada se comparte a lo más este tiempo; después, quien llega empieza otra.
const EN_VUELO_MS = 15_000;

/** Por clave, una sola lectura en vuelo y su resultado compartido `ms` después de llegar (pestañas y sondeos a la vez). */
function memorizarPorClave(fn, ms = MEMORIA_MS) {
  const guardadas = new Map();
  const vigente = (guardada, ahora) => (guardada.hasta === null ? ahora - guardada.desde < EN_VUELO_MS : ahora < guardada.hasta);
  return (clave) => {
    const ahora = performance.now();
    for (const [otra, guardada] of guardadas) if (!vigente(guardada, ahora)) guardadas.delete(otra);
    if (guardadas.has(clave)) return guardadas.get(clave).promesa;
    const actual = { promesa: null, desde: ahora, hasta: null };
    actual.promesa = fn(clave).then(
      (valor) => {
        actual.hasta = performance.now() + ms;
        return valor;
      },
      (error) => {
        if (guardadas.get(clave) === actual) guardadas.delete(clave);
        throw error;
      },
    );
    guardadas.set(clave, actual);
    return actual.promesa;
  };
}

/**
 * Lo que se dibuja de cada goal, leído del almacén con las claves de la tabla ya validadas (paso()).
 * Lo de una corrida cerrada se guarda en memoria; lo de una en curso se vuelve a leer en cada pedido. De un trace.json
 * a medio escribir (no es JSON) se usa la última versión buena que se leyó.
 * @param {import("./fuente.js").Fuente} fuente
 */
export function crearLectorDeTrazas(fuente) {
  const cerradas = new Map();
  const ultimaBuena = new Map();

  async function leer(runKey, relativa, cerrada) {
    const clave = `${runKey}/${relativa}`;
    if (cerradas.has(clave)) return cerradas.get(clave);
    let leido;
    try {
      leido = await fuente.leerJsonDetallado(runKey, relativa);
    } catch (error) {
      console.error(`revisiones: no se pudo leer «${clave}».`, error);
      return null;
    }
    let datos = leido.estado === "ok" && leido.datos && typeof leido.datos === "object" ? leido.datos : null;
    if (datos && relativa.endsWith(TRAZA)) {
      recordar(ultimaBuena, clave, datos);
    } else if (!datos && leido.estado === "danado") {
      datos = ultimaBuena.get(clave) ?? null;
    }
    if (cerrada && leido.estado !== "danado") recordar(cerradas, clave, datos);
    return datos;
  }

  async function guia(paso) {
    if (!paso.runKey) return null;
    const cerrada = CERRADO.has(paso.estado);
    if (paso.estado === "succeeded") {
      const datos = await leer(paso.runKey, "route.json", true);
      if (datos) return { archivo: "route.json", datos };
    }
    const datos = await leer(paso.runKey, TRAZA, cerrada);
    return datos ? { archivo: TRAZA, datos } : null;
  }

  async function intentos(paso) {
    if (!paso.runKey) return [];
    const cerrada = CERRADO.has(paso.estado);
    let carpetas = [];
    try {
      carpetas = (await fuente.listarPerfiles(paso.runKey)).filter((carpeta) => CARPETA.test(carpeta));
    } catch (error) {
      console.error(`revisiones: no se pudo listar «${paso.runKey}».`, error);
    }
    const deLaTraza = paso.traza?.split("/").at(-2);
    const elegidas = [...new Set([deLaTraza, ...carpetas.sort()].filter(Boolean))].slice(0, LIMITE_DE_INTENTOS);
    const leidos = await Promise.all(
      elegidas.sort().map(async (carpeta) => {
        // run.json sube recién con finish_run y manda sobre el trace.json.
        const run = cerrada ? await leer(paso.runKey, `${carpeta}/run.json`, true) : null;
        if (run) return { carpeta, archivo: "run.json", datos: run };
        const traza = await leer(paso.runKey, `${carpeta}/${TRAZA}`, cerrada);
        return traza ? { carpeta, archivo: TRAZA, datos: traza } : null;
      }),
    );
    return leidos.filter(Boolean);
  }

  async function tandaTerminada(runKey) {
    const clave = `${runKey}/telarana`;
    if (cerradas.has(clave)) return cerradas.get(clave);
    let telarana = null;
    try {
      const tanda = await leerSinVecinas(fuente, runKey);
      if (tanda.arbol === "ok") telarana = { fuente: "tanda", tanda: runKey, ...telaranaCompacta(tanda) };
    } catch (error) {
      console.error(`revisiones: no se pudo leer la tanda «${runKey}».`, error);
      return null;
    }
    if (telarana) recordar(cerradas, clave, telarana);
    return telarana;
  }

  /** Un goal de avanceDeRevision() con lo leído de cada agente: guide.recorrido y visitor.intentos. */
  async function leerRecorridos(goal) {
    const [recorrido, intentosVisitante] = await Promise.all([guia(goal.guide), intentos(goal.visitor)]);
    return { ...goal, guide: { ...goal.guide, recorrido }, visitor: { ...goal.visitor, intentos: intentosVisitante } };
  }

  /** Completa un goal de avanceDeRevision() con lo leído (recorrido, intentos) y su telaraña. */
  async function completarGoal(goal) {
    const { guide, visitor } = await leerRecorridos(goal);
    const recorridoGuia = guide.recorrido;
    const intentosVisitante = visitor.intentos;
    let telarana = goal.visitor.estado === "succeeded" && goal.visitor.runKey ? await tandaTerminada(goal.visitor.runKey) : null;
    if (!telarana) {
      const enCurso = (archivo, datos) => archivo === TRAZA && datos.status === "running";
      const deLaGuia = recorridoGuia
        ? recorridoDe(recorridoGuia.datos, { guia: true, enCurso: enCurso(recorridoGuia.archivo, recorridoGuia.datos) })
        : null;
      const recorridos = intentosVisitante
        .map(({ carpeta, archivo, datos }) => recorridoDe({ folder: carpeta, ...datos }, { carpeta, enCurso: !CERRADO.has(goal.visitor.estado) && enCurso(archivo, datos) }))
        .filter(Boolean);
      const vivo = telaranaEnVivo({ goal: goal.goal, guia: deLaGuia, intentos: recorridos, guiaFallo: goal.guide.estado === "failed" });
      telarana = vivo ? { fuente: "vivo", tanda: null, ...vivo } : null;
    }
    return {
      ...goal,
      guide: { ...guide, recorrido: recorridoGuia ? { archivo: recorridoGuia.archivo } : null },
      visitor: { ...visitor, intentos: intentosVisitante.map(({ carpeta, archivo }) => ({ carpeta, archivo })) },
      telarana,
    };
  }

  return { leerRecorridos, completarGoal };
}

/**
 * @param {{ tabla: string, cliente: { send: Function }, comandos: { QueryCommand: Function, ScanCommand: Function },
 *           fuente?: import("./fuente.js").Fuente, memoriaMs?: number }} opciones
 *        cliente de lib-dynamodb (ítems como objetos planos); con `fuente`, leer() suma lo que se dibuja de cada goal;
 *        listar() y leer() comparten su resultado `memoriaMs` (memorizarPorClave)
 */
export function crearRevisiones({ tabla, cliente, comandos, fuente = null, memoriaMs = MEMORIA_MS }) {
  const lector = fuente ? crearLectorDeTrazas(fuente) : null;
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
  /** Los ítems META y los URL#<url> tal cual (un Scan), en cualquier orden. */
  async function metasYPunteros() {
    const leidos = await todas(ScanCommand, { FilterExpression: "SK IN (:meta, :url)", ExpressionAttributeValues: { ":meta": "META", ":url": "URL" } });
    return { metas: leidos.filter((item) => item.SK === "META"), punteros: leidos.filter((item) => item.SK === "URL") };
  }
  /** Todos los ítems de una revisión tal cual (Query por PK = REV#<revision>); [] si el id no es válido. */
  const items = async (revision) =>
    esRevision(revision) ? todas(QueryCommand, { KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": `REV#${revision}` } }) : [];
  const avanceDe = async (revision) => (esRevision(revision) ? avanceDeRevision(await items(revision)) : null);
  const listaMemorizada = memorizarPorClave(async () => {
    const { metas, punteros } = await metasYPunteros();
    const { vigentes, anteriores } = revisionesVigentes(metas, punteros);
    const resumenes = metas.map(resumenDeMeta).sort(porFecha);
    return {
      revisiones: resumenes.filter((r) => vigentes.has(r.revision)).map((r) => ({ ...r, anteriores: anteriores.get(r.revision) ?? 0 })),
      historial: resumenes.filter((r) => !vigentes.has(r.revision)),
    };
  }, memoriaMs);
  const avanceMemorizado = memorizarPorClave(async (revision) => {
    const avance = await avanceDe(revision);
    if (!avance || !lector) return avance;
    return { ...avance, goals: await Promise.all(avance.goals.map(lector.completarGoal)) };
  }, memoriaMs);
  return {
    descripcion: `dynamodb://${tabla}`,

    /** Resúmenes de las vigentes y del historial, de la más nueva a la más vieja. */
    listar: () => listaMemorizada("lista"),

    /** El avance de una revisión, o null si no existe. */
    leer: (revision) => (esRevision(revision) ? avanceMemorizado(revision) : Promise.resolve(null)),

    /**
     * Un goal de la revisión con lo leído de sus agentes y sin telaraña (lo que sigue lib/eventos.js), o null si la
     * revisión o el goal no están en la tabla. → { revision, host, estado, goal: { goal, guide, visitor } }
     */
    async leerGoal(revision, goal) {
      const avance = await avanceDe(revision);
      const encontrado = avance?.goals.find((otro) => otro.goal === goal);
      if (!encontrado || !lector) return null;
      const host = avance.host ?? partesDeCorrida(encontrado.visitor.runKey ?? encontrado.guide.runKey ?? "")?.host ?? null;
      return { revision, host, estado: avance.estado, goal: await lector.leerRecorridos(encontrado) };
    },

    // Crudos, para el Overview (lib/panel.js): necesita campos que listar() y leer() no entregan (META.error).
    metasYPunteros,
    items,
  };
}
