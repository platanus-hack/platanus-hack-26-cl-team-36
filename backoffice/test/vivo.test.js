// La revisión en curso: resumen por fase, trazas (trace.json) de la Guía y del Visitante, y la telaraña que crece.
// Todo con clientes falsos de S3 y DynamoDB, sin red.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearFuenteS3 } from "../lib/fuentes/s3.js";
import { avanceDeRevision, calcularResumen, crearRevisiones, partesDeTraza, resumenDeRevision } from "../lib/revisiones.js";
import { leerTanda } from "../lib/tandas.js";
import { arbolEnVivo, recorridoDe, telaranaCompacta, telaranaEnVivo } from "../lib/vivo.js";
import { crearServidor } from "../servidor.js";
import { clienteDynamoFalso, clienteS3Falso, comandosDynamo, comandosS3, objetosDeCarpeta } from "./aws-falso.js";

const TABLA = "chameleon-revisiones";
const BUCKET = "almacen-de-prueba";
const RAIZ = fileURLToPath(new URL("./fixtures/recorrido-unico", import.meta.url));
const TANDA = "ejemplo.test/visitor/horario/2026-11-22T10-00-00Z";
const GUIA = "ejemplo.test/guide/horario/desktop/2026-11-22T09-55-00Z";
const GUIA_EN_CURSO = "ejemplo.test/guide/contacto/desktop/2026-11-22T09-56-00Z";
const VISITA = "ejemplo.test/visitor/horario/2026-11-22T10-40-00Z";

const INICIO = { url: "https://www.ejemplo.test/", title: "Inicio" };
const AYUDA = { url: "https://www.ejemplo.test/ayuda", title: "Ayuda" };
const HORARIO = { url: "https://www.ejemplo.test/ayuda/horario", title: "Horario" };

// Pasos con la forma de route.json (Guía) y de run.json (Visitante).
const pasoDeGuia = (number, antes, despues, texto) => ({
  number,
  label: `click «${texto}»`,
  action: "click",
  value: null,
  target: { tag: "a", role: "link", name: texto, text: texto, href: null },
  url_before: antes.url,
  title_before: antes.title,
  url_after: despues.url,
  title_after: despues.title,
  changes_node: antes.url !== despues.url,
  screenshot: `step_0${number}.png`,
});
const pasoDeVisita = (number, antes, despues, texto, segundos) => ({
  number,
  action: "left_click",
  description: `clic en (1, ${number})`,
  element: { tag: "a", text: texto, href: null },
  url_before: antes.url,
  title_before: antes.title,
  url: despues.url,
  title: despues.title,
  screenshot: `step_0${number}.png`,
  seconds_since_start: segundos,
  signals: [],
});
const traza = (agent, status, steps, extra = {}) => ({
  schema_version: 1,
  agent,
  goal: "horario",
  revision: "en-vivo",
  profile: agent === "visitor" ? "desktop" : null,
  status,
  updated_at: "2026-11-22T10:41:00Z",
  start: { ...INICIO, screenshot: "step_00.png" },
  steps,
  ...extra,
});
const RUTA_DE_LA_GUIA = [pasoDeGuia(1, INICIO, AYUDA, "Ayuda"), pasoDeGuia(2, AYUDA, HORARIO, "Horario")];
const manifiesto = (status) => JSON.stringify({ status, revision: "en-vivo" });

function objetos() {
  return {
    ...objetosDeCarpeta(RAIZ),
    [`${GUIA}/manifest.json`]: manifiesto("succeeded"),
    [`${GUIA}/route.json`]: JSON.stringify({ goal: "horario", status: "verified", start: { ...INICIO, screenshot: "step_00.png" }, steps: RUTA_DE_LA_GUIA }),
    [`${GUIA}/trace.json`]: JSON.stringify(traza("guide", "succeeded", RUTA_DE_LA_GUIA)),
    [`${GUIA_EN_CURSO}/manifest.json`]: manifiesto("running"),
    [`${GUIA_EN_CURSO}/trace.json`]: JSON.stringify(traza("guide", "running", [pasoDeGuia(1, INICIO, AYUDA, "Ayuda")])),
    [`${VISITA}/manifest.json`]: manifiesto("running"),
    [`${VISITA}/desktop/trace.json`]: JSON.stringify(traza("visitor", "running", [pasoDeVisita(1, INICIO, AYUDA, "Ayuda", 3.1)])),
    [`${VISITA}/mobile/trace.json`]: '{"schema_version": 1, "steps": [{"number": 1, "url": "https://www.ej',
  };
}

const meta = (revision, campos = {}) => ({
  PK: `REV#${revision}`,
  SK: "META",
  url: "https://www.ejemplo.test/",
  host: "ejemplo.test",
  status: "running",
  created_at: "2026-11-22T09:50:00Z",
  updated_at: "2026-11-22T10:41:00Z",
  ...campos,
});
const item = (revision, SK, status, campos = {}) => ({ PK: `REV#${revision}`, SK, status, updated_at: "2026-11-22T10:41:00Z", ...campos });

const EN_VIVO = [
  meta("en-vivo", {
    goals_total: 2,
    resumen: {
      fases: { catalog: { succeeded: 1 }, guide: { running: 1, succeeded: 1 }, visitor: { running: 1, pending: 1 }, improver: { pending: 1 } },
      agentes_activos: 2,
      pasos: 4,
      goals_total: 2,
    },
  }),
  item("en-vivo", "STAGE#cataloger", "succeeded", { run_key: "ejemplo.test/cataloger/2026-11-22T09-50-00Z" }),
  item("en-vivo", "GOAL#horario#guide", "succeeded", { run_key: GUIA, step: 2, last_action: "click «Horario»", last_url: HORARIO.url, last_title: HORARIO.title, trace_key: `${GUIA}/trace.json` }),
  item("en-vivo", "GOAL#horario#visitor", "running", { run_key: VISITA, step: 1, last_action: "clic en (1, 1)", last_url: AYUDA.url, last_title: AYUDA.title, trace_key: `${VISITA}/desktop/trace.json` }),
  item("en-vivo", "GOAL#contacto#guide", "running", { run_key: GUIA_EN_CURSO, step: 1, trace_key: `${GUIA_EN_CURSO}/trace.json` }),
];
const TERMINADA = [
  meta("terminada", { status: "done", goals_total: 1 }),
  item("terminada", "STAGE#cataloger", "succeeded", { run_key: "ejemplo.test/cataloger/2026-11-22T09-50-00Z" }),
  item("terminada", "GOAL#horario#guide", "succeeded", { run_key: GUIA, step: 2, trace_key: `${GUIA}/trace.json` }),
  item("terminada", "GOAL#horario#visitor", "succeeded", { run_key: TANDA, step: 4 }),
  item("terminada", "STAGE#improver", "succeeded", { run_key: "ejemplo.test/improver/2026-11-22T10-30-00Z" }),
];
// Revisión vieja (sin resumen ni trazas) que falló, con claves que no corresponden a su goal.
const FALLIDA = [
  meta("fallida", { status: "failed", goals_total: 3 }),
  item("fallida", "STAGE#cataloger", "succeeded", { run_key: "ejemplo.test/cataloger/2026-11-22T09-50-00Z" }),
  item("fallida", "GOAL#horario#guide", "failed", { run_key: GUIA_EN_CURSO, trace_key: `${GUIA_EN_CURSO}/trace.json` }),
  item("fallida", "GOAL#otro#guide", "running", { trace_key: "../../secreto/trace.json", step: "x" }),
];

const nombres = (telarana) => Object.fromEntries(telarana.paginas.map((pagina) => [pagina.id, pagina.titulo]));
const tramos = (telarana) => telarana.ramas.map((rama) => `${nombres(telarana)[rama.origen]}>${nombres(telarana)[rama.destino]}:${rama.intentos}:${rama.resultado}`).sort();
const ruta = (telarana) => telarana.ruta?.paginas.map((id) => nombres(telarana)[id]) ?? null;

// ── Derivación pura ────────────────────────────────────────────────────

test("Guía sola: su camino es el eje, sin intentos ni finales", () => {
  const guia = recorridoDe(traza("guide", "running", RUTA_DE_LA_GUIA), { guia: true, enCurso: true });
  const telarana = telaranaEnVivo({ goal: "horario", guia, intentos: [] });
  assert.deepEqual(ruta(telarana), ["Inicio", "Ayuda", "Horario"]);
  assert.deepEqual(tramos(telarana), ["Ayuda>Horario:1:exito", "Inicio>Ayuda:1:exito"]);
  assert.ok(telarana.paginas.every((pagina) => Object.values(pagina.finales).every((n) => n === 0)));
  assert.equal(telarana.paginas.find((pagina) => pagina.esInicio).titulo, "Inicio");
});

test("Guía fallida: el eje se dibuja como fallo", () => {
  const guia = recorridoDe(traza("guide", "failed", RUTA_DE_LA_GUIA.slice(0, 1)), { guia: true });
  assert.deepEqual(tramos(telaranaEnVivo({ goal: "horario", guia, intentos: [], guiaFallo: true })), ["Inicio>Ayuda:1:fallo"]);
});

test("Guía + Visitante a medias: la traza suma sobre el eje y los ids no cambian al crecer", () => {
  const guia = recorridoDe(traza("guide", "succeeded", RUTA_DE_LA_GUIA), { guia: true });
  const visita = (pasos) => recorridoDe({ folder: "desktop", ...traza("visitor", "running", pasos) }, { carpeta: "desktop", enCurso: true });
  const primero = telaranaEnVivo({ goal: "horario", guia, intentos: [visita([pasoDeVisita(1, INICIO, AYUDA, "Ayuda", 3)])] });
  // El intento en curso no tiene veredicto: «sin medir», sin final todavía.
  assert.deepEqual(tramos(primero), ["Ayuda>Horario:1:exito", "Inicio>Ayuda:2:exito"]);
  assert.ok(primero.paginas.every((pagina) => pagina.finales.sin_medir === 0));

  const CONTACTO = { url: "https://www.ejemplo.test/contacto", title: "Contacto" };
  const despues = telaranaEnVivo({
    goal: "horario",
    guia,
    intentos: [visita([pasoDeVisita(1, INICIO, AYUDA, "Ayuda", 3), pasoDeVisita(2, AYUDA, CONTACTO, "Contacto", 6)])],
  });
  assert.deepEqual(ruta(despues), ["Inicio", "Ayuda", "Horario"]);
  assert.ok(primero.paginas.every((pagina) => despues.paginas.some((otra) => otra.id === pagina.id)), "las páginas ya dibujadas conservan su id");
  assert.ok(primero.ramas.every((rama) => despues.ramas.some((otra) => otra.id === rama.id)), "los tramos ya dibujados conservan su id");
  assert.ok(tramos(despues).includes("Ayuda>Contacto:1:sin_medir"));
});

test("una traza a medio escribir: se ignoran los pasos sin URL y sin inicio no hay recorrido", () => {
  const recorrido = recorridoDe({ start: INICIO, steps: [pasoDeVisita(1, INICIO, AYUDA, "Ayuda", 1), { number: 2 }, null, "x"] });
  assert.equal(recorrido.steps.length, 1);
  assert.equal(recorridoDe({ steps: [] }), null);
  assert.equal(recorridoDe(null), null);
  assert.equal(recorridoDe("texto"), null);
  // Sin start, el inicio sale del primer paso.
  assert.equal(recorridoDe({ steps: [pasoDeGuia(1, INICIO, AYUDA, "Ayuda")] }, { guia: true }).start.url, INICIO.url);
  assert.equal(telaranaEnVivo({ goal: "x", guia: null, intentos: [] }), null);
});

test("arbolEnVivo une como build_route_tree: los run.json terminados suman su final", async () => {
  const tanda = await leerTanda(RAIZ, TANDA);
  assert.ok(tanda);
  const { readFileSync } = await import("node:fs");
  const runs = ["desktop", "desktop-2", "mobile", "mobile-2"].map((carpeta) =>
    recorridoDe({ folder: carpeta, ...JSON.parse(readFileSync(`${RAIZ}/${TANDA}/${carpeta}/run.json`, "utf8")) }, { carpeta }),
  );
  const arbol = arbolEnVivo({ guia: null, intentos: runs });
  const real = JSON.parse(readFileSync(`${RAIZ}/${TANDA}/route_tree.json`, "utf8"));
  const resumen = (nodos) => nodos.map((n) => [n.url, n.title, n.visits, n.is_start, n.endings]).sort();
  assert.deepEqual(resumen(arbol.nodes), resumen(real.nodes));
  const ramas = (lista, nodos) => {
    const url = new Map(nodos.map((n) => [n.id, n.url]));
    return lista.map((r) => [url.get(r.source), url.get(r.target), r.action, r.successes, r.failures]).sort();
  };
  assert.deepEqual(ramas(arbol.branches, arbol.nodes), ramas(real.branches, real.nodes));
});

// ── Resumen ────────────────────────────────────────────────────────────

test("resumen: el de META con forma fija; sin él, calculado desde los ítems", () => {
  assert.deepEqual(resumenDeRevision(EN_VIVO), {
    fases: {
      catalog: { pending: 0, running: 0, succeeded: 1, failed: 0 },
      guide: { pending: 0, running: 1, succeeded: 1, failed: 0 },
      visitor: { pending: 1, running: 1, succeeded: 0, failed: 0 },
      improver: { pending: 1, running: 0, succeeded: 0, failed: 0 },
    },
    agentesActivos: 2,
    pasos: 4,
    goalsTotal: 2,
    calculado: false,
  });
  // El cálculo de respaldo coincide con lo que la proyectora habría guardado.
  const { calculado, ...calculadoEnVivo } = calcularResumen(EN_VIVO);
  const { calculado: _, ...guardado } = resumenDeRevision(EN_VIVO);
  assert.equal(calculado, true);
  assert.deepEqual(calculadoEnVivo, guardado);

  assert.deepEqual(resumenDeRevision(FALLIDA), {
    fases: {
      catalog: { pending: 0, running: 0, succeeded: 1, failed: 0 },
      guide: { pending: 1, running: 1, succeeded: 0, failed: 1 },
      visitor: { pending: 3, running: 0, succeeded: 0, failed: 0 },
      improver: { pending: 1, running: 0, succeeded: 0, failed: 0 },
    },
    agentesActivos: 1,
    pasos: 0,
    goalsTotal: 3,
    calculado: true,
  });
  assert.equal(resumenDeRevision([meta("rara", { resumen: "no es un objeto" })]).calculado, true);
});

// ── Claves ─────────────────────────────────────────────────────────────

test("partesDeTraza: solo un trace.json de la etapa y el goal del ítem", () => {
  assert.deepEqual(partesDeTraza(`${GUIA}/trace.json`, "guide", "horario"), { runKey: GUIA, carpeta: null });
  assert.deepEqual(partesDeTraza(`${VISITA}/desktop-2/trace.json`, "visitor", "horario"), { runKey: VISITA, carpeta: "desktop-2" });
  for (const [clave, etapa, goal] of [
    [`${GUIA}/trace.json`, "visitor", "horario"],
    [`${GUIA}/trace.json`, "guide", "otro"],
    [`${GUIA}/route.json`, "guide", "horario"],
    [`${VISITA}/trace.json`, "visitor", "horario"],
    [`${VISITA}/../trace.json`, "visitor", "horario"],
    [`${VISITA}/.oculto/trace.json`, "visitor", "horario"],
    ["../../secreto/trace.json", "guide", "otro"],
    [`s3://${BUCKET}/${GUIA}/trace.json`, "guide", "horario"],
    [null, "guide", "horario"],
  ]) {
    assert.equal(partesDeTraza(clave, etapa, goal), null, String(clave));
  }
});

test("avanceDeRevision: pasos, última acción y traza por goal; una traza de otra corrida no se acepta", () => {
  const avance = avanceDeRevision(EN_VIVO);
  const horario = avance.goals.find((goal) => goal.goal === "horario");
  assert.equal(horario.visitor.pasos, 1);
  assert.deepEqual(horario.visitor.ultimo, { accion: "clic en (1, 1)", url: AYUDA.url, titulo: AYUDA.title });
  assert.equal(horario.visitor.traza, `${VISITA}/desktop/trace.json`);
  assert.equal(horario.telarana, null, "sin fuente no hay telaraña");

  const fallida = avanceDeRevision(FALLIDA);
  const [deHorario, deOtro] = fallida.goals.sort((a, b) => a.goal.localeCompare(b.goal));
  assert.equal(deHorario.guide.runKey, null, "la run_key de otro goal no se lee");
  assert.equal(deHorario.guide.traza, null);
  assert.equal(deOtro.guide.traza, null);
  assert.equal(deOtro.guide.pasos, null);
});

// ── Con el almacén (S3 falso) ─────────────────────────────────────────

function armar(items, almacen = objetos()) {
  const s3 = clienteS3Falso(BUCKET, almacen, { porPagina: 50 });
  const fuente = crearFuenteS3({ bucket: BUCKET, cliente: s3, comandos: comandosS3 });
  return { s3, almacen, revisiones: crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, items, { porPagina: 50 }), comandos: comandosDynamo, fuente }) };
}

test("leer en curso: la Guía terminada da su route.json, el Visitante sus trazas (la dañada se salta)", async () => {
  const { revisiones } = armar(EN_VIVO);
  const avance = await revisiones.leer("en-vivo");
  const horario = avance.goals.find((goal) => goal.goal === "horario");
  assert.equal(horario.guide.recorrido.archivo, "route.json");
  assert.deepEqual(horario.visitor.intentos.map((i) => [i.carpeta, i.archivo, i.datos.status]), [["desktop", "trace.json", "running"]]);
  assert.equal(horario.telarana.fuente, "vivo");
  assert.deepEqual(ruta(horario.telarana), ["Inicio", "Ayuda", "Horario"]);
  assert.deepEqual(tramos(horario.telarana), ["Ayuda>Horario:1:exito", "Inicio>Ayuda:2:exito"]);

  const contacto = avance.goals.find((goal) => goal.goal === "contacto");
  assert.equal(contacto.guide.recorrido.archivo, "trace.json");
  assert.deepEqual(contacto.visitor.intentos, []);
  assert.deepEqual(tramos(contacto.telarana), ["Inicio>Ayuda:1:exito"]);
});

test("una traza que queda a medio escribir usa la última versión buena; lo en curso se vuelve a leer", async () => {
  const { almacen, revisiones, s3 } = armar(EN_VIVO);
  await revisiones.leer("en-vivo");
  almacen[`${VISITA}/desktop/trace.json`] = '{"status": "running", "steps": [';
  const avance = await revisiones.leer("en-vivo");
  const horario = avance.goals.find((goal) => goal.goal === "horario");
  assert.equal(horario.visitor.intentos[0].datos.steps.length, 1);
  const lecturas = () => s3.llamadas.filter((c) => c.input.Key === `${VISITA}/desktop/trace.json`).length;
  const antes = lecturas();
  await revisiones.leer("en-vivo");
  assert.equal(lecturas(), antes + 1, "una corrida en curso nunca sale de la memoria");
});

test("terminado: la telaraña es la de la tanda terminada y lo cerrado se lee una sola vez", async () => {
  const { revisiones, s3 } = armar(TERMINADA);
  const avance = await revisiones.leer("terminada");
  const [horario] = avance.goals;
  const tanda = await leerTanda(RAIZ, TANDA);
  assert.deepEqual(horario.telarana, { fuente: "tanda", tanda: TANDA, ...telaranaCompacta(tanda) });
  assert.deepEqual(horario.visitor.intentos.map((i) => [i.carpeta, i.archivo]), [
    ["desktop", "run.json"], ["desktop-2", "run.json"], ["mobile", "run.json"], ["mobile-2", "run.json"],
  ]);
  const antes = s3.llamadas.length;
  assert.deepEqual(await revisiones.leer("terminada"), avance);
  assert.equal(s3.llamadas.length, antes, "lo cerrado sale de la memoria");
});

test("revisión fallida y vieja: resumen calculado, nada leído con claves que no son del goal", async () => {
  const { revisiones, s3 } = armar(FALLIDA);
  const avance = await revisiones.leer("fallida");
  assert.equal(avance.estado, "failed");
  assert.equal(avance.resumen.calculado, true);
  assert.ok(avance.goals.every((goal) => goal.telarana === null && goal.guide.recorrido === null));
  assert.ok(s3.llamadas.every((c) => !String(c.input.Key ?? c.input.Prefix ?? "").includes("secreto")));
  assert.ok(s3.llamadas.every((c) => !String(c.input.Key ?? c.input.Prefix ?? "").includes("contacto")));
});

// ── Endpoints ──────────────────────────────────────────────────────────

let servidor;
let base;
before(async () => {
  const { revisiones } = armar([...EN_VIVO, ...TERMINADA, ...FALLIDA]);
  servidor = crearServidor({ raizCorridas: RAIZ, revisiones });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}/backoffice`;
});
after(() => servidor.close());

test("/api/revisiones/<rev>: resumen, estado por goal y telaraña", async () => {
  const avance = await (await fetch(`${base}/api/revisiones/en-vivo`)).json();
  assert.equal(avance.resumen.agentesActivos, 2);
  const horario = avance.goals.find((goal) => goal.goal === "horario");
  assert.equal(horario.visitor.estado, "running");
  assert.equal(horario.visitor.pasos, 1);
  assert.equal(horario.telarana.fuente, "vivo");
  assert.equal(horario.telarana.paginas.length, 3);

  const terminada = await (await fetch(`${base}/api/revisiones/terminada`)).json();
  assert.equal(terminada.goals[0].telarana.fuente, "tanda");
  const fallida = await (await fetch(`${base}/api/revisiones/fallida`)).json();
  assert.equal(fallida.resumen.calculado, true);
  assert.equal((await fetch(`${base}/api/revisiones/no-existe`)).status, 404);
  const lista = await (await fetch(`${base}/api/revisiones`)).json();
  assert.deepEqual(lista.revisiones.map((r) => r.revision).sort(), ["en-vivo", "fallida", "terminada"]);
});
