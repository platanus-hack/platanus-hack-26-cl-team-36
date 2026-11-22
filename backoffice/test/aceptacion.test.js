// Aceptación del Overview (especificación §5) sobre un almacén y una tabla en memoria, generados aquí: las cifras
// exactas del contrato §1 (82 + 213 + 922 + 69 = 1,286; desktop 708, mobile 214 = 119·44·28·14·9) y las reglas de
// en_cola, con todo lo que no debe contar mezclado (manifests ilegibles u otros estados, trazas viejas, nombres fuera
// del layout). La misma prueba sobre los datos de prueba de verdad está en aceptacion-mock.test.js.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { crearPanel } from "../lib/panel.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";
import { almacenEnMemoria } from "./almacen-en-memoria.js";
import { clienteDynamoFalso, comandosDynamo } from "./aws-falso.js";

const AHORA = "2026-11-22T03:36:49.000Z";
const RELOJ = () => new Date(AHORA);
const TABLA = "chameleon-revisiones";

// El JSON de /api/resumen del contrato (§1), tal cual.
const CONTRATO = {
  ahora: AHORA,
  roles: {
    cataloger: { logrado: 72, fallido: 9, en_curso: 1, en_cola: 0 },
    guide: { logrado: 191, fallido: 19, en_curso: 3, en_cola: 3 },
    visitor: {
      all: { logrado: 595, fallido: 128, abandonado: 128, sin_medir: 49, error: 22, en_curso: 0, en_cola: 6 },
      desktop: { logrado: 476, fallido: 84, abandonado: 100, sin_medir: 35, error: 13, en_curso: 0, en_cola: 6 },
      mobile: { logrado: 119, fallido: 44, abandonado: 28, sin_medir: 14, error: 9, en_curso: 0, en_cola: 6 },
    },
    improver: { logrado: 65, fallido: 3, en_curso: 1, en_cola: 3 },
  },
};

// ── El almacén ────────────────────────────────────────────────────────────────

const HOSTS = ["uno.test", "dos.test", "tres.test"];
const GOALS = ["ver-planes", "pagar-cuenta", "dar-de-baja", "portabilidad"];

function generarAlmacen() {
  const archivos = {};
  let n = 0;
  // Ids de corrida únicos, un minuto y un segundo aparte.
  const corrida = () => `${new Date(Date.UTC(2026, 10, 1) + n++ * 61_000).toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
  const manifiesto = (status) => JSON.stringify({ status });
  const porEstado = (cuantas, hacer) => {
    for (const [status, total] of Object.entries(cuantas)) for (let i = 0; i < total; i += 1) hacer(status, i);
  };

  porEstado({ succeeded: 72, failed: 9, running: 1 }, (status, i) => {
    archivos[`${HOSTS[i % 3]}/cataloger/${corrida()}/manifest.json`] = manifiesto(status);
  });
  porEstado({ succeeded: 191, failed: 19, running: 3 }, (status, i) => {
    archivos[`${HOSTS[i % 3]}/guide/${GOALS[i % 4]}/${i % 5 ? "desktop" : "mobile"}/${corrida()}/manifest.json`] = manifiesto(status);
  });
  porEstado({ succeeded: 65, failed: 3, running: 1 }, (status, i) => {
    const clave = `${HOSTS[i % 3]}/improver/${corrida()}`;
    archivos[`${clave}/manifest.json`] = manifiesto(status);
    if (status === "succeeded") archivos[`${clave}/tema.css`] = `html.mi-tema { --mi-acento: #0${i % 10}a0b0; }`;
  });

  // Lo que no cuenta: manifest dañado, sin manifest, otro estado, viewport o goal fuera del layout, otro agente,
  // hosts que no son hosts y archivos sueltos.
  archivos[`uno.test/cataloger/${corrida()}/manifest.json`] = "{ roto";
  archivos[`uno.test/cataloger/${corrida()}/goals.json`] = "{}";
  archivos[`uno.test/cataloger/${corrida()}/manifest.json`] = manifiesto("abandoned");
  archivos[`uno.test/guide/ver-planes/tablet/${corrida()}/manifest.json`] = manifiesto("succeeded");
  archivos[`uno.test/guide/Ver_Planes/desktop/${corrida()}/manifest.json`] = manifiesto("succeeded");
  archivos[`uno.test/improver/no-es-una-corrida/manifest.json`] = manifiesto("succeeded");
  archivos[`uno.test/summary/${corrida()}/manifest.json`] = manifiesto("succeeded");
  archivos[`Host_Malo/cataloger/${corrida()}/manifest.json`] = manifiesto("succeeded");
  archivos["LEEME.md"] = "no es una corrida";

  // Los intentos del Visitante: cada resultado de varias formas (las de lib/derivar.js).
  const inicio = { url: "https://www.uno.test/", title: "Inicio - Uno", screenshot: "step_00.png" };
  const run = (viewport, campos) => JSON.stringify({ viewport, start: inicio, end_reason: "done", ...campos });
  const ESCRITORIO = ["1024x768", "1280x800", "700x900"];
  const MOVIL = ["390x844", "699x1000"];
  const intentos = [];
  const agregar = (dispositivo, cuantos, hacer) => {
    for (let i = 0; i < cuantos; i += 1) {
      const viewport = (dispositivo === "mobile" ? MOVIL : ESCRITORIO)[i % (dispositivo === "mobile" ? 2 : 3)];
      intentos.push({ dispositivo, contenido: hacer(viewport, i) });
    }
  };
  const veredicto = (outcome) => (viewport) => run(viewport, { verdict: { outcome } });
  const abandono = (viewport, i) =>
    [run(viewport, { verdict: { outcome: "abandoned" } }), run(viewport, { verdict: { outcome: "interrupted" } }), run(viewport, {})][i % 3];
  agregar("desktop", 476, veredicto("success"));
  agregar("desktop", 84, veredicto("failed"));
  agregar("desktop", 100, abandono);
  agregar("desktop", 35, veredicto("unmeasured"));
  agregar("desktop", 10, (viewport) => run(viewport, { end_reason: "api_error", verdict: { outcome: "interrupted" } }));
  agregar("desktop", 1, (viewport) => run(viewport, { verdict: { outcome: "success", justification: "No se pudo obtener el veredicto" } }));
  agregar("desktop", 2, () => "{ run.json a medio escribir"); // dañado: error, sin viewport → desktop
  agregar("mobile", 119, veredicto("success"));
  agregar("mobile", 44, veredicto("failed"));
  agregar("mobile", 28, abandono);
  agregar("mobile", 14, veredicto("unmeasured"));
  agregar("mobile", 9, (viewport) => run(viewport, { end_reason: "internal_error", verdict: { outcome: "interrupted" } }));
  assert.equal(intentos.length, 922);

  // En tandas de 7, terminadas, fallidas o en curso: los run.json cuentan sea cual sea el estado de la tanda.
  for (let desde = 0, t = 0; desde < intentos.length; desde += 7, t += 1) {
    const clave = `${HOSTS[t % 3]}/visitor/${GOALS[t % 4]}/${corrida()}`;
    const status = t % 15 === 7 ? "running" : t % 10 === 3 ? "failed" : "succeeded";
    archivos[`${clave}/manifest.json`] = manifiesto(status);
    if (status === "succeeded") archivos[`${clave}/route_tree.json`] = "{}";
    const vistas = {};
    for (const { dispositivo, contenido } of intentos.slice(desde, desde + 7)) {
      vistas[dispositivo] = (vistas[dispositivo] ?? 0) + 1;
      const carpeta = vistas[dispositivo] > 1 ? `${dispositivo}-${vistas[dispositivo]}` : dispositivo;
      archivos[`${clave}/${carpeta}/run.json`] = contenido;
      archivos[`${clave}/${carpeta}/step_00.png`] = "png";
    }
    // Trazas que no son intentos en curso: una vieja en una tanda cerrada, una terminada en una que corre.
    if (status === "succeeded" && t % 9 === 0) archivos[`${clave}/mobile-9/trace.json`] = JSON.stringify({ status: "running", profile: "mobile" });
    if (status === "running") archivos[`${clave}/desktop-9/trace.json`] = JSON.stringify({ status: "succeeded", profile: "desktop" });
  }
  // Tandas fallidas sin un solo run.json (como las del mock): no aportan visitantes.
  for (const goal of GOALS.slice(0, 2)) archivos[`dos.test/visitor/${goal}/${corrida()}/manifest.json`] = manifiesto("failed");
  return archivos;
}

// ── La tabla: las 4 revisiones que corren del mock (más una detenida y otras que no corren) ──────────────────

const RECIEN = "2026-11-22T03:36:00.000Z";
const meta = (revision, status, campos = {}) => ({
  PK: `REV#${revision}`,
  SK: "META",
  url: "https://www.uno.test/",
  host: "uno.test",
  status,
  created_at: "2026-11-22T03:25:00.000Z",
  updated_at: RECIEN,
  ...campos,
});
const item = (revision, SK, status, updated_at = RECIEN) => ({ PK: `REV#${revision}`, SK, status, updated_at });
const goal = (revision, nombre, guia, visita) => [item(revision, `GOAL#${nombre}#guide`, guia), item(revision, `GOAL#${nombre}#visitor`, visita)];

const ITEMS = [
  // Guía corriendo y el resto por partir: 2 Guías, 3 Visitantes y el Diseñador en cola.
  meta("corre-a", "running", { goals_total: 3 }),
  item("corre-a", "STAGE#cataloger", "succeeded"),
  ...goal("corre-a", "ver-planes", "running", "pending"),
  ...goal("corre-a", "pagar-cuenta", "pending", "pending"),
  ...goal("corre-a", "dar-de-baja", "pending", "pending"),
  // 1 Guía, 2 Visitantes y el Diseñador.
  meta("corre-b", "running", { goals_total: 3 }),
  item("corre-b", "STAGE#cataloger", "succeeded"),
  ...goal("corre-b", "ver-planes", "succeeded", "succeeded"),
  ...goal("corre-b", "pagar-cuenta", "running", "pending"),
  ...goal("corre-b", "dar-de-baja", "pending", "pending"),
  // 1 Visitante y el Diseñador.
  meta("corre-c", "running", { goals_total: 3 }),
  item("corre-c", "STAGE#cataloger", "succeeded"),
  ...goal("corre-c", "ver-planes", "succeeded", "succeeded"),
  ...goal("corre-c", "pagar-cuenta", "succeeded", "succeeded"),
  ...goal("corre-c", "dar-de-baja", "running", "pending"),
  // Ya en el Diseñador: nada en cola.
  meta("corre-d", "running", { goals_total: 3 }),
  item("corre-d", "STAGE#cataloger", "succeeded"),
  ...goal("corre-d", "ver-planes", "succeeded", "succeeded"),
  ...goal("corre-d", "pagar-cuenta", "succeeded", "succeeded"),
  ...goal("corre-d", "dar-de-baja", "succeeded", "succeeded"),
  item("corre-d", "STAGE#improver", "running"),
  // Detenida hace 3 h: lo suyo no está en cola.
  meta("detenida", "running", { created_at: "2026-11-22T00:36:49.000Z", updated_at: "2026-11-22T00:36:53.936Z" }),
  item("detenida", "STAGE#cataloger", "running", "2026-11-22T00:36:53.936Z"),
  // Las que no corren tampoco.
  meta("en-cola", "queued"),
  meta("lista", "done", { goals_total: 1 }),
  item("lista", "STAGE#cataloger", "succeeded"),
  ...goal("lista", "ver-planes", "succeeded", "pending"),
  meta("fallida", "failed", { error: "AgentCore429: ThrottlingException: Rate exceeded" }),
  { PK: "URL#https://www.uno.test/", SK: "URL", revision: "corre-a" },
];

const revisionesDe = (items) => crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, items, { porPagina: 7 }), comandos: comandosDynamo });

let servidor;
let sinTabla;
const base = (s) => `http://127.0.0.1:${s.address().port}/backoffice`;
before(async () => {
  servidor = crearServidor({ fuente: almacenEnMemoria(generarAlmacen()), revisiones: revisionesDe(ITEMS), reloj: RELOJ });
  sinTabla = crearServidor({ fuente: almacenEnMemoria(generarAlmacen()), reloj: RELOJ });
  await Promise.all([servidor, sinTabla].map((s) => new Promise((listo) => s.listen(0, "127.0.0.1", listo))));
});
after(() => {
  servidor.close();
  sinTabla.close();
});

test("GET /api/resumen: exactamente las cifras del contrato (1,286 agentes; desktop 708, mobile 214)", async () => {
  const respuesta = await fetch(`${base(servidor)}/api/resumen`);
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get("content-type"), /application\/json/);
  const resumen = await respuesta.json();
  assert.deepEqual(resumen, CONTRATO);
  const { cataloger, guide, visitor, improver } = resumen.roles;
  const visible = ({ en_cola, ...resto }) => Object.values(resto).reduce((suma, n) => suma + n, 0);
  assert.deepEqual([visible(cataloger), visible(guide), visible(visitor.all), visible(improver)], [82, 213, 922, 69]);
  assert.equal(visible(cataloger) + visible(guide) + visible(visitor.all) + visible(improver), 1286);
  assert.deepEqual([visible(visitor.desktop), visible(visitor.mobile)], [708, 214]);
  assert.equal(visible(cataloger) + visible(guide) + visible(visitor.mobile) + visible(improver), 578, "el total con el filtro Mobile");
});

test("sin tabla: en_cola es 0 en todo y /api/overview no está disponible", async () => {
  const { roles } = await (await fetch(`${base(sinTabla)}/api/resumen`)).json();
  assert.deepEqual([roles.cataloger.en_cola, roles.guide.en_cola, roles.improver.en_cola], [0, 0, 0]);
  assert.deepEqual([roles.visitor.all.en_cola, roles.visitor.desktop.en_cola, roles.visitor.mobile.en_cola], [0, 0, 0]);
  assert.equal(roles.visitor.all.logrado, 595);
  assert.deepEqual(await (await fetch(`${base(sinTabla)}/api/overview`)).json(), { ahora: AHORA, disponible: false });
});

test("en_cola: una detenida no cuenta; la misma revisión sin detener aporta su Diseñador", async () => {
  const fuente = almacenEnMemoria(generarAlmacen());
  // A las 00:50, la revisión "detenida" tenía 13 min sin cambios: corre, y su Diseñador todavía no parte.
  const antes = crearPanel({ fuente, revisiones: revisionesDe(ITEMS), reloj: () => new Date("2026-11-22T00:50:00.000Z") });
  const { roles } = await antes.resumen();
  assert.deepEqual([roles.cataloger.en_cola, roles.guide.en_cola, roles.visitor.all.en_cola, roles.improver.en_cola], [0, 3, 6, 4]);
  // Un goal anunciado sin ítem suma una Guía y un Visitante; un catalogador pendiente, uno.
  const mas = [...ITEMS, meta("corre-e", "running", { goals_total: 1 }), item("corre-e", "STAGE#cataloger", "pending")];
  const conMas = await crearPanel({ fuente, revisiones: revisionesDe(mas), reloj: RELOJ }).resumen();
  assert.deepEqual(
    [conMas.roles.cataloger.en_cola, conMas.roles.guide.en_cola, conMas.roles.visitor.mobile.en_cola, conMas.roles.improver.en_cola],
    [1, 4, 7, 4],
  );
});

test("en_curso: un intento sin run.json con trace.json running en una tanda que corre, por dispositivo", async () => {
  const archivos = generarAlmacen();
  const clave = "tres.test/visitor/ver-planes/2026-11-22T03-30-00Z";
  archivos[`${clave}/manifest.json`] = JSON.stringify({ status: "running" });
  archivos[`${clave}/desktop/trace.json`] = JSON.stringify({ status: "running", profile: "desktop" });
  archivos[`${clave}/mobile/trace.json`] = JSON.stringify({ status: "running", profile: "mobile" });
  archivos[`${clave}/mobile-2/trace.json`] = "{ a medio escribir";
  const { roles } = await crearPanel({ fuente: almacenEnMemoria(archivos), reloj: RELOJ }).resumen();
  assert.deepEqual([roles.visitor.all.en_curso, roles.visitor.desktop.en_curso, roles.visitor.mobile.en_curso], [2, 1, 1]);
  assert.equal(roles.visitor.all.logrado, 595);
});
