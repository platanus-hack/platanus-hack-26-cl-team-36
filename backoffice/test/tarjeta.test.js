import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UMBRAL_DETENIDA_MS,
  actualizadaDe,
  agentesYGoals,
  armarTarjeta,
  conPropuesta,
  elegirCapturas,
  enColaDeRevision,
  estaDetenida,
  estadoDeFase,
  estadoDeTarjeta,
  etapasDe,
  goalsEnOrden,
  itemsPorEtapa,
  motivoDe,
} from "../lib/tarjeta.js";

const AHORA = new Date("2026-11-22T03:36:49.000Z");
const meta = (campos) => ({ PK: "REV#rev-1", SK: "META", url: "https://www.movilsur.test/", host: "movilsur.test", created_at: "2026-11-22T03:25:02.031Z", updated_at: "2026-11-22T03:25:02.031Z", ...campos });
const item = (SK, status, campos = {}) => ({ PK: "REV#rev-1", SK, status, updated_at: "2026-11-22T03:30:00.000Z", ...campos });
const goal = (nombre, guia, visita) => [
  ...(guia ? [item(`GOAL#${nombre}#guide`, guia)] : []),
  ...(visita ? [item(`GOAL#${nombre}#visitor`, visita)] : []),
];
const enLinea = (etapas) => Object.values(etapas).join("·");
const agentesEnLinea = (agentes) => agentes.map((a) => `${a.rol}:${a.estado}${a.dispositivo ? `/${a.dispositivo}` : ""}`).join(" ");

// Las revisiones del mock que nombra el contrato (§2.1), con sus ítems.
const MOVILSUR = [item("STAGE#cataloger", "succeeded"), ...goal("cobertura-5g", "succeeded", "succeeded"), ...goal("dar-de-baja", "succeeded", "succeeded"), ...goal("portabilidad", "succeeded", "succeeded"), item("STAGE#improver", "running")];
const MOVILSUR_NUEVA = [item("STAGE#cataloger", "succeeded"), ...goal("cobertura-5g", "running", "pending"), ...goal("dar-de-baja", "pending", "pending"), ...goal("roaming-europa", "pending", "pending")];
const VALLE_VERDE = [item("STAGE#cataloger", "succeeded"), ...goal("certificado-residencia", "succeeded", "succeeded"), ...goal("subsidio-agua", "running", "pending"), ...goal("licencia-conducir", "pending", "pending")];
const TIENDA = [item("STAGE#cataloger", "succeeded"), ...goal("costo-despacho", "succeeded", "succeeded"), ...goal("garantia-extendida", "succeeded", "succeeded"), ...goal("devolver-producto", "running", "pending")];
const BANCO = [item("STAGE#cataloger", "running", { updated_at: "2026-11-22T00:36:53.936Z" })];
const VALLE_VERDE_20 = [item("STAGE#cataloger", "succeeded"), ...goal("certificado-residencia", "succeeded", "succeeded"), ...goal("subsidio-agua", "succeeded", "succeeded"), ...goal("licencia-conducir", "failed", "succeeded"), item("STAGE#improver", "failed")];
const LIMITE = "AgentCore429: ThrottlingException: Rate exceeded";

test("detenida: una revisión running sin cambios por más de 30 min respecto de ahora", () => {
  assert.equal(UMBRAL_DETENIDA_MS, 30 * 60 * 1000);
  const hace = (ms) => new Date(AHORA.getTime() - ms).toISOString();
  assert.equal(estaDetenida("running", hace(UMBRAL_DETENIDA_MS), AHORA), false, "justo 30 min: todavía no");
  assert.equal(estaDetenida("running", hace(UMBRAL_DETENIDA_MS + 1), AHORA), true);
  assert.equal(estaDetenida("running", "2026-11-22T00:36:53.936Z", AHORA), true, "Banco Andino /personas: ~3 h");
  assert.equal(estaDetenida("running", "2026-11-22T03:36:22.840Z", AHORA), false);
  assert.equal(estaDetenida("done", hace(10 * UMBRAL_DETENIDA_MS), AHORA), false, "solo las que corren");
  assert.equal(estaDetenida("running", null, AHORA), false, "sin fecha no se puede decir");
});

test("actualizada: el updated_at más nuevo entre META y los ítems", () => {
  assert.equal(actualizadaDe(meta({ updated_at: "2026-11-22T03:25:02.031Z" }), MOVILSUR), "2026-11-22T03:30:00.000Z");
  assert.equal(actualizadaDe(meta({ updated_at: "2026-11-22T03:40:00Z" }), MOVILSUR), "2026-11-22T03:40:00Z");
  assert.equal(actualizadaDe(meta({ updated_at: undefined }), []), null);
});

test("estado de la tarjeta según la tabla", () => {
  assert.equal(estadoDeTarjeta("done", false), "delivered");
  assert.equal(estadoDeTarjeta("failed", false), "failed");
  assert.equal(estadoDeTarjeta("queued", false), "queued");
  assert.equal(estadoDeTarjeta("running", false), "running");
  assert.equal(estadoDeTarjeta("running", true), "stalled");
  for (const otro of ["cancelled", undefined, "constructor"]) assert.equal(estadoDeTarjeta(otro, false), "queued", String(otro));
});

test("estado de una fase según sus ítems", () => {
  for (const [estados, esperado] of [
    [[], "pendiente"],
    [["succeeded", "running"], "en_curso"],
    [["pending", "pending"], "pendiente"],
    [["skipped", "skipped"], "pendiente"],
    [["succeeded", "pending"], "en_curso"],
    [["skipped", "pending"], "en_curso"],
    [["failed", "failed"], "fallido"],
    [["failed", "succeeded"], "hecho"],
    [["skipped", "succeeded"], "hecho"],
  ]) {
    assert.equal(estadoDeFase(estados), esperado, estados.join(","));
  }
});

test("etapas: los ejemplos del contrato", () => {
  assert.equal(enLinea(etapasDe("running", meta({ goals_total: 3 }), MOVILSUR)), "hecho·hecho·hecho·en_curso");
  assert.equal(enLinea(etapasDe("running", meta({ goals_total: 3 }), TIENDA)), "hecho·en_curso·en_curso·pendiente");
  assert.equal(enLinea(etapasDe("stalled", meta({}), BANCO)), "detenido·pendiente·pendiente·pendiente");
  assert.equal(enLinea(etapasDe("failed", meta({ error: LIMITE }), [])), "fallido·pendiente·pendiente·pendiente", "429 sin ítems");
  assert.equal(enLinea(etapasDe("failed", meta({}), [item("STAGE#cataloger", "failed")])), "fallido·pendiente·pendiente·pendiente");
  assert.equal(enLinea(etapasDe("failed", meta({ goals_total: 3 }), VALLE_VERDE_20)), "hecho·hecho·hecho·fallido");
  assert.equal(enLinea(etapasDe("queued", meta({}), MOVILSUR)), "pendiente·pendiente·pendiente·pendiente", "en cola: todo pendiente");
  assert.equal(enLinea(etapasDe("delivered", meta({}), [...MOVILSUR.slice(0, -1), item("STAGE#improver", "succeeded")])), "hecho·hecho·hecho·hecho");
});

test("etapas: tras una fallida todo queda pendiente; una revisión que corre cuenta los goals anunciados sin ítem", () => {
  const guiasFallidas = [item("STAGE#cataloger", "succeeded"), ...goal("a", "failed", "skipped"), ...goal("b", "failed", "skipped"), item("STAGE#improver", "succeeded")];
  assert.equal(enLinea(etapasDe("failed", meta({}), guiasFallidas)), "hecho·fallido·pendiente·pendiente");
  assert.equal(enLinea(etapasDe("stalled", meta({}), [item("STAGE#cataloger", "succeeded"), ...goal("a", "succeeded", "running")])), "hecho·hecho·detenido·pendiente");
  const anunciados = [item("STAGE#cataloger", "succeeded"), ...goal("a", "succeeded", "succeeded")];
  assert.equal(enLinea(etapasDe("running", meta({ goals_total: 2 }), anunciados)), "hecho·en_curso·en_curso·pendiente");
  assert.equal(enLinea(etapasDe("running", meta({ goals_total: 1 }), anunciados)), "hecho·hecho·hecho·pendiente");
});

test("motivo: detenida → sin_avance; fallida → límite, catalogador, diseñador, guía o error", () => {
  assert.deepEqual(motivoDe("stalled", meta({}), BANCO), { tipo: "sin_avance", detalle: null });
  assert.equal(motivoDe("running", meta({}), MOVILSUR), null);
  assert.equal(motivoDe("delivered", meta({}), MOVILSUR), null);
  assert.deepEqual(motivoDe("failed", meta({ error: LIMITE }), []), { tipo: "limite", detalle: LIMITE });
  assert.deepEqual(motivoDe("failed", meta({}), [item("STAGE#cataloger", "failed", { error: "HTTP 429 Too Many Requests" })]), {
    tipo: "limite",
    detalle: "HTTP 429 Too Many Requests",
  });
  assert.deepEqual(motivoDe("failed", meta({}), [item("STAGE#cataloger", "failed")]), { tipo: "catalogador", detalle: null });
  assert.deepEqual(motivoDe("failed", meta({ error: "boom" }), [item("STAGE#cataloger", "failed")]), { tipo: "catalogador", detalle: "boom" });
  assert.deepEqual(motivoDe("failed", meta({}), [item("STAGE#cataloger", "failed", { error: "sin goals" })]), { tipo: "catalogador", detalle: "sin goals" });
  assert.deepEqual(motivoDe("failed", meta({}), VALLE_VERDE_20), { tipo: "disenador", detalle: null }, "el diseñador antes que la Guía");
  assert.deepEqual(motivoDe("failed", meta({}), [item("STAGE#cataloger", "succeeded"), ...goal("a", "failed", "skipped")]), { tipo: "guia", detalle: null });
  assert.deepEqual(motivoDe("failed", meta({}), [item("STAGE#cataloger", "succeeded")]), { tipo: "error", detalle: null });
  assert.deepEqual(motivoDe("failed", meta({ error: "Lambda timeout" }), []), { tipo: "error", detalle: "Lambda timeout" });
});

const intentosPor = (mapa) => (nombre) => mapa[nombre] ?? [];
const GOALS_JSON = { goals: [{ id: "portabilidad", instruction: "Cambiarse de compañía" }, { id: "cobertura-5g", description: "Revisar la cobertura 5G" }, { id: "dar-de-baja" }] };

test("agentes y goals de una revisión que corre, en el orden de goals.json", () => {
  const { agentes, goals } = agentesYGoals({
    estado: "running",
    meta: meta({ goals_total: 3 }),
    items: MOVILSUR,
    catalogo: GOALS_JSON,
    intentosDe: intentosPor({
      portabilidad: [{ estado: "logrado", dispositivo: "desktop" }, { estado: "logrado", dispositivo: "mobile" }],
      "cobertura-5g": [{ estado: "fallido", dispositivo: "desktop", instruccion: "otra" }],
      "dar-de-baja": [{ estado: "error", dispositivo: "mobile", instruccion: "Encontrar cómo dar de baja" }],
    }),
    tandaDe: (goal) => (goal === "portabilidad" ? "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z" : undefined),
  });
  assert.equal(
    agentesEnLinea(agentes),
    "cataloger:logrado guide:logrado guide:logrado guide:logrado visitor:logrado/desktop visitor:logrado/mobile visitor:fallido/desktop visitor:error/mobile improver:en_curso",
  );
  assert.deepEqual(goals, [
    {
      goal: "portabilidad",
      instruccion: "Cambiarse de compañía",
      intentos: [{ estado: "logrado", dispositivo: "desktop" }, { estado: "logrado", dispositivo: "mobile" }],
      espera: false,
      tanda: "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z",
    },
    { goal: "cobertura-5g", instruccion: "Revisar la cobertura 5G", intentos: [{ estado: "fallido", dispositivo: "desktop" }], espera: false, tanda: null },
    { goal: "dar-de-baja", instruccion: "Encontrar cómo dar de baja", intentos: [{ estado: "error", dispositivo: "mobile" }], espera: false, tanda: null },
  ]);
  assert.deepEqual(Object.keys(goals[0]), ["goal", "instruccion", "intentos", "espera", "tanda"], "la forma del contrato (§6.5)");
});

test("agentes: lo que todavía no parte va en cola solo mientras la revisión corre", () => {
  const corre = agentesYGoals({ estado: "running", meta: meta({ goals_total: 3 }), items: MOVILSUR_NUEVA, catalogo: null, intentosDe: () => [] });
  assert.equal(agentesEnLinea(corre.agentes), "cataloger:logrado guide:en_curso guide:en_cola guide:en_cola visitor:en_cola visitor:en_cola visitor:en_cola improver:en_cola");
  // Sin goals.json: por id; la instrucción cae al id.
  assert.deepEqual(corre.goals.map((g) => [g.goal, g.instruccion, g.espera]), [
    ["cobertura-5g", "cobertura-5g", true],
    ["dar-de-baja", "dar-de-baja", true],
    ["roaming-europa", "roaming-europa", true],
  ]);
  const anunciados = agentesYGoals({ estado: "running", meta: meta({ goals_total: 4 }), items: MOVILSUR_NUEVA, catalogo: null, intentosDe: () => [] });
  assert.equal(anunciados.agentes.filter((a) => a.rol === "guide").length, 4, "un goal anunciado sin ítem: una Guía en cola");
  assert.equal(anunciados.agentes.filter((a) => a.rol === "visitor").length, 4);
  assert.equal(anunciados.goals.length, 3, "goals: solo los que tienen ítem");

  const entregada = agentesYGoals({ estado: "delivered", meta: meta({}), items: [...MOVILSUR_NUEVA, item("STAGE#improver", "skipped")], catalogo: null, intentosDe: () => [] });
  assert.equal(agentesEnLinea(entregada.agentes), "cataloger:logrado guide:en_curso", "sin cola ni skipped fuera de una que corre");
  assert.ok(entregada.goals.every((g) => g.espera === false));

  const visitanteCerrado = agentesYGoals({ estado: "running", meta: meta({}), items: [item("STAGE#cataloger", "succeeded"), ...goal("a", "failed", "skipped"), ...goal("b", "succeeded", "failed")], catalogo: null, intentosDe: () => [] });
  assert.equal(agentesEnLinea(visitanteCerrado.agentes), "cataloger:logrado guide:fallido guide:logrado improver:en_cola", "un Visitante cerrado sin intentos no espera");
  assert.deepEqual(visitanteCerrado.goals.map((g) => g.espera), [false, false]);
});

test("agentes: en una detenida lo en curso pasa a detenido y lo pendiente no va", () => {
  const { agentes, goals } = agentesYGoals({
    estado: "stalled",
    meta: meta({ goals_total: 2 }),
    items: [item("STAGE#cataloger", "succeeded"), ...goal("a", "succeeded", "running"), ...goal("b", "pending", "pending")],
    catalogo: null,
    intentosDe: intentosPor({ a: [{ estado: "en_curso", dispositivo: "mobile" }, { estado: "logrado", dispositivo: "desktop" }] }),
  });
  assert.equal(agentesEnLinea(agentes), "cataloger:logrado guide:logrado visitor:detenido/mobile visitor:logrado/desktop");
  assert.deepEqual(goals[0].intentos, [{ estado: "detenido", dispositivo: "mobile" }, { estado: "logrado", dispositivo: "desktop" }]);
  assert.equal(goals[1].espera, false);
  assert.equal(agentesEnLinea(agentesYGoals({ estado: "stalled", meta: meta({}), items: BANCO, catalogo: null, intentosDe: () => [] }).agentes), "cataloger:detenido");
});

test("una fallida por 429 sin ítems no tiene agentes ni goals", () => {
  assert.deepEqual(agentesYGoals({ estado: "failed", meta: meta({ error: LIMITE }), items: [], catalogo: null, intentosDe: () => [] }), { agentes: [], goals: [] });
});

test("goals en el orden de goals.json; los que no están, al final por id", () => {
  const { goals } = itemsPorEtapa([...goal("zeta", "pending"), ...goal("dar-de-baja", "pending"), ...goal("alfa", "pending"), ...goal("portabilidad", "pending")]);
  assert.deepEqual(goalsEnOrden(goals, GOALS_JSON).map((g) => g.goal), ["portabilidad", "dar-de-baja", "alfa", "zeta"]);
  assert.deepEqual(goalsEnOrden(goals, { goals: "no es una lista" }).map((g) => g.goal), ["alfa", "dar-de-baja", "portabilidad", "zeta"]);
});

test("en cola (resumen): los agentes que no parten en una revisión que corre y no está detenida", () => {
  const suma = (...listas) => listas.reduce((total, lista) => Object.fromEntries(Object.keys(total).map((rol) => [rol, total[rol] + lista[rol]])));
  const corriendo = [
    enColaDeRevision(meta({ status: "running", goals_total: 3 }), MOVILSUR_NUEVA, false),
    enColaDeRevision(meta({ status: "running", goals_total: 3 }), VALLE_VERDE, false),
    enColaDeRevision(meta({ status: "running", goals_total: 3 }), TIENDA, false),
    enColaDeRevision(meta({ status: "running", goals_total: 3 }), MOVILSUR, false),
  ];
  assert.deepEqual(corriendo[0], { cataloger: 0, guide: 2, visitor: 3, improver: 1 });
  assert.deepEqual(suma(...corriendo), { cataloger: 0, guide: 3, visitor: 6, improver: 3 }, "las cifras del mock");
  const nada = { cataloger: 0, guide: 0, visitor: 0, improver: 0 };
  assert.deepEqual(enColaDeRevision(meta({ status: "running" }), BANCO, true), nada, "detenida: no cuenta");
  assert.deepEqual(enColaDeRevision(meta({ status: "queued" }), [], false), nada, "en cola de revisiones: no cuenta");
  assert.deepEqual(enColaDeRevision(meta({ status: "done" }), MOVILSUR_NUEVA, false), nada);
  assert.deepEqual(enColaDeRevision(meta({ status: "running" }), [], false), { cataloger: 1, guide: 0, visitor: 0, improver: 1 }, "recién lanzada: catalogador y diseñador");
  assert.deepEqual(enColaDeRevision(meta({ status: "running" }), [item("STAGE#cataloger", "pending")], false), { cataloger: 1, guide: 0, visitor: 0, improver: 1 });
  assert.deepEqual(enColaDeRevision(meta({ status: "running", goals_total: 4 }), MOVILSUR_NUEVA, false), { cataloger: 0, guide: 3, visitor: 4, improver: 1 }, "un goal anunciado sin ítem");
  assert.deepEqual(enColaDeRevision(meta({ status: "running" }), [...MOVILSUR.slice(0, -1), item("STAGE#improver", "pending")], false), { cataloger: 0, guide: 0, visitor: 0, improver: 1 });
});

test("capturas: de las tandas de la revisión (sin error primero) y, si no hay de ese dispositivo, del mismo host y ruta", () => {
  const intento = (carpeta, estado, dispositivo, captura = "step_00.png") => ({ carpeta, estado, dispositivo, captura });
  const propias = [
    { tanda: "h/visitor/b/2026-11-22T03-35-00Z", intentos: [intento("desktop", "error", "desktop"), intento("mobile", "en_curso", "mobile", null)] },
    { tanda: "h/visitor/a/2026-11-22T03-30-00Z", intentos: [intento("desktop", "fallido", "desktop", "step_01.png")] },
  ];
  const delHost = [{ tanda: "h/visitor/c/2026-11-20T00-00-00Z", intentos: [intento("mobile-2", "logrado", "mobile"), intento("desktop", "logrado", "desktop")] }];
  assert.deepEqual(elegirCapturas([propias, delHost]), {
    desktop: { tanda: "h/visitor/a/2026-11-22T03-30-00Z", carpeta: "desktop", archivo: "step_01.png" },
    mobile: { tanda: "h/visitor/c/2026-11-20T00-00-00Z", carpeta: "mobile-2", archivo: "step_00.png" },
  });
  assert.deepEqual(elegirCapturas([[propias[0]], []]).desktop, { tanda: "h/visitor/b/2026-11-22T03-35-00Z", carpeta: "desktop", archivo: "step_00.png" }, "si solo hay errores, un error");
  assert.deepEqual(elegirCapturas([[], []]), { desktop: null, mobile: null });
});

test("capturas con propuesta: la «después» del Diseñador encima y la del Visitante de respaldo", () => {
  const visitante = { tanda: "h/visitor/a/2026-11-22T03-30-00Z", carpeta: "desktop", archivo: "step_00.png" };
  const corrida = "h/improver/2026-11-22T03-40-00Z";
  const vistas = [{ capturas: { desktop: { antes: `${corrida}/vistas/escritorio-antes.png`, despues: `${corrida}/vistas/escritorio-despues.png` },
                                mobile: { antes: null, despues: `${corrida}/vistas/movil-despues.png` } } }];
  assert.deepEqual(conPropuesta({ desktop: visitante, mobile: null }, vistas), {
    desktop: { ...visitante, despues: `${corrida}/vistas/escritorio-despues.png` },
    mobile: { tanda: null, carpeta: null, archivo: null, despues: `${corrida}/vistas/movil-despues.png` },
  });
  assert.deepEqual(conPropuesta({ desktop: visitante, mobile: null }, []), { desktop: visitante, mobile: null }, "sin vistas, la del Visitante");
  const sinDespues = [{ capturas: { desktop: { antes: `${corrida}/vistas/escritorio-antes.png`, despues: null }, mobile: { antes: null, despues: null } } }];
  assert.deepEqual(conPropuesta({ desktop: visitante, mobile: null }, sinDespues), { desktop: visitante, mobile: null });
});

test("armarTarjeta: la forma del contrato, en ese orden", () => {
  const tarjeta = armarTarjeta({
    meta: meta({ status: "running", goals_total: 3, updated_at: "2026-11-22T03:36:47.428Z" }),
    items: [meta({}), ...MOVILSUR],
    ahora: AHORA,
    catalogo: GOALS_JSON,
    intentosDe: () => [],
    acento: "#d35609",
    sitio: "Móvil Sur",
  });
  assert.deepEqual(Object.keys(tarjeta), ["revision", "url", "host", "ruta", "sitio", "estado", "creada", "actualizada", "etapas", "agentes", "goals", "capturas", "acento", "motivo", "anteriores"]);
  assert.deepEqual([tarjeta.revision, tarjeta.host, tarjeta.ruta, tarjeta.estado, tarjeta.actualizada], ["rev-1", "movilsur.test", "/", "running", "2026-11-22T03:36:47.428Z"]);
  assert.deepEqual(tarjeta.capturas, { desktop: null, mobile: null });
  const detenida = armarTarjeta({ meta: meta({ status: "running", updated_at: "2026-11-22T00:36:49.000Z" }), items: BANCO, ahora: AHORA, sitio: "Banco Andino" });
  assert.deepEqual([detenida.estado, detenida.motivo, enLinea(detenida.etapas)], ["stalled", { tipo: "sin_avance", detalle: null }, "detenido·pendiente·pendiente·pendiente"]);
});
