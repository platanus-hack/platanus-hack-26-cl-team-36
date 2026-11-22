// El Overview de punta a punta sobre un almacén y una tabla en memoria (lib/panel.js y servidor.js): lo que se lee
// por pasada, lo que se guarda y lo que nunca se lee.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { crearPanel, memorizar } from "../lib/panel.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";
import { almacenEnMemoria } from "./almacen-en-memoria.js";
import { clienteDynamoFalso, comandosDynamo } from "./aws-falso.js";

const AHORA = "2026-11-22T03:36:49.000Z";
const RELOJ = () => new Date(AHORA);
const TABLA = "chameleon-revisiones";

const CATALOGO = "uno.test/cataloger/2026-11-22T03-00-00Z";
const VIEJA = "uno.test/visitor/a/2026-11-20T00-00-00Z";
const LISTA = "uno.test/visitor/a/2026-11-22T03-10-00Z";
const CORRIENDO = "uno.test/visitor/b/2026-11-22T03-20-00Z";
const ENTREGADA_B = "uno.test/visitor/b/2026-11-22T02-00-00Z";
const TEMA = "uno.test/improver/2026-11-22T03-30-00Z";
const TEMA_ROJO = "uno.test/improver/2026-11-22T03-31-00Z";

const run = (viewport, outcome, url = "https://www.uno.test/", title = "Inicio | Sitio Uno") =>
  JSON.stringify({ viewport, start: { url, title, screenshot: "step_00.png" }, verdict: { outcome }, instruction: "Hacer A (del run)" });

function almacen() {
  return almacenEnMemoria({
    [`${CATALOGO}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${CATALOGO}/goals.json`]: JSON.stringify({ goals: [{ id: "b", instruction: "Hacer B" }, { id: "a", description: "Hacer A" }] }),
    [`${VIEJA}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${VIEJA}/route_tree.json`]: "{}",
    [`${VIEJA}/desktop/run.json`]: run("1024x768", "success"),
    [`${VIEJA}/mobile/run.json`]: run("390x844", "success"),
    [`${LISTA}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${LISTA}/route_tree.json`]: "{}",
    [`${LISTA}/desktop/run.json`]: run("1024x768", "failed"),
    [`${LISTA}/desktop-2/run.json`]: JSON.stringify({ viewport: "1024x768", end_reason: "api_error", start: { url: "https://www.uno.test/", screenshot: "step_00.png" } }),
    [`${ENTREGADA_B}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${ENTREGADA_B}/route_tree.json`]: "{}",
    [`${ENTREGADA_B}/desktop/run.json`]: run("1024x768", "success"),
    [`${CORRIENDO}/manifest.json`]: JSON.stringify({ status: "running" }),
    [`${CORRIENDO}/desktop/run.json`]: run("1024x768", "abandoned"),
    [`${CORRIENDO}/mobile/trace.json`]: JSON.stringify({ status: "running", profile: "mobile" }),
    [`${TEMA}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${TEMA}/tema.css`]: "html.mi-tema { --mi-acento: #ABCDEF; }",
    [`${TEMA_ROJO}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${TEMA_ROJO}/tema.css`]: "html.mi-tema { --mi-acento: red; }",
  });
}

const meta = (revision, status, campos = {}) => ({
  PK: `REV#${revision}`,
  SK: "META",
  url: "https://www.uno.test/",
  host: "uno.test",
  status,
  created_at: "2026-11-22T03:00:00.000Z",
  updated_at: "2026-11-22T03:35:00.000Z",
  ...campos,
});
const item = (revision, SK, status, run_key) => ({ PK: `REV#${revision}`, SK, status, run_key, updated_at: "2026-11-22T03:35:00.000Z" });

const ITEMS = [
  meta("corre", "running", { goals_total: 2, created_at: "2026-11-22T03:05:00.000Z" }),
  item("corre", "STAGE#cataloger", "succeeded", CATALOGO),
  item("corre", "GOAL#a#guide", "succeeded"),
  item("corre", "GOAL#a#visitor", "succeeded", `${LISTA}/manifest.json`),
  item("corre", "GOAL#b#guide", "succeeded"),
  item("corre", "GOAL#b#visitor", "running", CORRIENDO),
  meta("lista", "done", { created_at: "2026-11-22T02:00:00.000Z", css_key: `${TEMA}/tema.css` }),
  item("lista", "STAGE#cataloger", "succeeded", CATALOGO),
  item("lista", "GOAL#a#guide", "succeeded"),
  item("lista", "GOAL#a#visitor", "succeeded", VIEJA),
  item("lista", "GOAL#b#guide", "succeeded"),
  item("lista", "GOAL#b#visitor", "succeeded", ENTREGADA_B),
  item("lista", "STAGE#improver", "succeeded", TEMA),
  // Claves que no se leen: de otro goal, de otro rol, que no son del almacén; un css_key que no es un tema.
  meta("mala", "done", { created_at: "2026-11-22T01:00:00.000Z", css_key: `${CATALOGO}/goals.json` }),
  item("mala", "STAGE#cataloger", "succeeded", "uno.test/guide/a/desktop/2026-11-22T03-00-00Z"),
  item("mala", "GOAL#a#guide", "succeeded"),
  item("mala", "GOAL#a#visitor", "succeeded", CORRIENDO),
  item("mala", "GOAL#b#guide", "succeeded"),
  item("mala", "GOAL#b#visitor", "succeeded", "uno.test/visitor/b/../../../../etc/2026-11-22T03-20-00Z"),
  item("mala", "STAGE#improver", "succeeded", CATALOGO),
  meta("roja", "done", { created_at: "2026-11-22T00:30:00.000Z" }),
  item("roja", "STAGE#improver", "succeeded", TEMA_ROJO),
  meta("espera", "queued", { url: "https://www.uno.test/otra", created_at: "2026-11-22T03:36:00.000Z" }),
];

function armar({ items = ITEMS, memoriaMs } = {}) {
  const fuente = almacen();
  const cliente = clienteDynamoFalso(TABLA, items, { porPagina: 50 });
  const revisiones = crearRevisiones({ tabla: TABLA, cliente, comandos: comandosDynamo });
  const llamadas = { listarCorridas: 0 };
  const listarCorridas = fuente.listarCorridas;
  fuente.listarCorridas = () => {
    llamadas.listarCorridas += 1;
    return listarCorridas();
  };
  const consultas = () => cliente.llamadas.map((c) => (c.constructor.name === "ScanCommand" ? "Scan" : `Query ${c.input.ExpressionAttributeValues[":pk"]}`));
  return { fuente, cliente, consultas, llamadas, panel: crearPanel({ fuente, revisiones, reloj: RELOJ, memoriaMs }) };
}

test("tarjetas: intentos por goal (con los en curso), goals en el orden de goals.json y capturas solo de tandas listadas", async () => {
  const { panel } = armar();
  const { tarjetas, pestanas, cola } = await panel.overview();
  assert.deepEqual(pestanas.recent.ids, ["corre", "lista", "mala", "roja"]);
  assert.deepEqual(cola.ids, ["espera"]);
  const corre = tarjetas.corre;
  assert.equal(corre.sitio, "Sitio Uno");
  // tanda: la del Visitante del goal en esta revisión si se lista; la que corre todavía no (null).
  assert.deepEqual(corre.goals, [
    { goal: "b", instruccion: "Hacer B", intentos: [{ estado: "abandonado", dispositivo: "desktop" }, { estado: "en_curso", dispositivo: "mobile" }], espera: false, tanda: null },
    { goal: "a", instruccion: "Hacer A", intentos: [{ estado: "fallido", dispositivo: "desktop" }, { estado: "error", dispositivo: "desktop" }], espera: false, tanda: LISTA },
  ]);
  // La tanda que corre no está listada: de ella no sale captura; la de la revisión, sin error primero; el móvil, de
  // la tanda más nueva del mismo host y ruta.
  assert.deepEqual(corre.capturas, {
    desktop: { tanda: LISTA, carpeta: "desktop", archivo: "step_00.png" },
    mobile: { tanda: VIEJA, carpeta: "mobile", archivo: "step_00.png" },
  });
  assert.equal(corre.acento, null);
  assert.equal(tarjetas.lista.acento, "#abcdef");
  assert.deepEqual(tarjetas.lista.goals.map((g) => [g.goal, g.tanda]), [["b", ENTREGADA_B], ["a", VIEJA]], "entregada: la tanda de cada goal");
  assert.equal(tarjetas.roja.acento, null, "un acento que no es hex no sale");
  assert.deepEqual(tarjetas.espera.capturas, { desktop: null, mobile: null }, "otra ruta del host: sin captura");
});

test("seguridad: una run_key de otro rol, de otro goal o fuera del almacén no se lee, y un css_key que no es tema tampoco", async () => {
  const { panel, fuente } = armar();
  const { tarjetas } = await panel.overview();
  const mala = tarjetas.mala;
  assert.deepEqual(mala.goals.map((g) => [g.goal, g.intentos.length, g.tanda]), [["a", 0, null], ["b", 0, null]], "de otro goal o fuera del almacén: sin tanda");
  assert.equal(mala.acento, null);
  assert.ok(!fuente.lecturas.some((ruta) => ruta.includes("..")), "nada con ..");
  assert.ok(!fuente.lecturas.includes(`${CATALOGO}/tema.css`), "el improver de la revisión apuntaba al catalogador");
  assert.ok(!fuente.lecturas.some((ruta) => ruta.startsWith("uno.test/guide/")), "goals.json solo de un catalogador");
  // Sin tandas propias válidas: la más nueva del mismo host y ruta que tenga ese dispositivo.
  assert.deepEqual([mala.capturas.desktop.tanda, mala.capturas.mobile.tanda], [LISTA, VIEJA]);
});

test("lecturas: dos pedidos juntos comparten la misma; luego solo se consulta lo que corre y lo que no está guardado", async () => {
  const { panel, consultas, cliente, llamadas } = armar({ memoriaMs: 50 });
  await Promise.all([panel.resumen(), panel.overview()]);
  assert.equal(llamadas.listarCorridas, 1, "una pasada por el almacén para los dos");
  assert.deepEqual(consultas().sort(), ["Query REV#corre", "Query REV#espera", "Query REV#lista", "Query REV#mala", "Query REV#roja", "Scan"].sort());

  await new Promise((listo) => setTimeout(listo, 60));
  cliente.llamadas.length = 0;
  await panel.overview();
  assert.deepEqual(consultas().sort(), ["Query REV#corre", "Query REV#espera", "Scan"].sort(), "las cerradas quedaron guardadas");
  assert.equal(llamadas.listarCorridas, 2);
});

test("memorizar: comparte la promesa mientras corre y por un rato después; un error no se guarda", async () => {
  let llamadas = 0;
  const lenta = memorizar(async () => {
    llamadas += 1;
    await new Promise((listo) => setTimeout(listo, 20));
    return llamadas;
  }, 30);
  assert.deepEqual(await Promise.all([lenta(), lenta()]), [1, 1]);
  assert.equal(await lenta(), 1, "recién terminada: la misma");
  await new Promise((listo) => setTimeout(listo, 40));
  assert.equal(await lenta(), 2, "pasado el rato: otra");

  let intentos = 0;
  const falla = memorizar(async () => {
    intentos += 1;
    if (intentos === 1) throw new Error("tabla caída");
    return "ok";
  }, 1000);
  await assert.rejects(falla(), /tabla caída/);
  assert.equal(await falla(), "ok");
});

let servidor;
let sinTabla;
const base = (s) => `http://127.0.0.1:${s.address().port}/backoffice`;
before(async () => {
  const { fuente } = armar();
  servidor = crearServidor({ fuente, revisiones: crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, ITEMS), comandos: comandosDynamo }), reloj: RELOJ });
  sinTabla = crearServidor({ fuente: almacen() });
  await Promise.all([servidor, sinTabla].map((s) => new Promise((listo) => s.listen(0, "127.0.0.1", listo))));
});
after(() => {
  servidor.close();
  sinTabla.close();
});

test("servidor: /api/resumen y /api/overview solo con GET o HEAD, con ahora del reloj", async () => {
  const overview = await (await fetch(`${base(servidor)}/api/overview`)).json();
  assert.equal(overview.ahora, AHORA);
  assert.deepEqual(Object.keys(overview), ["ahora", "disponible", "umbralDetenidaMin", "cuentas", "pestanas", "cola", "tarjetas"]);
  for (const ruta of ["/api/resumen", "/api/overview"]) {
    assert.equal((await fetch(`${base(servidor)}${ruta}`, { method: "HEAD" })).status, 200, ruta);
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await fetch(`${base(servidor)}${ruta}`, { method })).status, 405, `${method} ${ruta}`);
  }
  for (const ruta of ["/api/resumen/x", "/api/overview/corre", "/api/overviews"]) assert.equal((await fetch(`${base(servidor)}${ruta}`)).status, 404, ruta);
});

test("servidor: sin reloj, ahora es la hora real", async () => {
  const antes = Date.now();
  const { ahora, disponible } = await (await fetch(`${base(sinTabla)}/api/overview`)).json();
  assert.equal(disponible, false);
  assert.ok(Date.parse(ahora) >= antes - 1000 && Date.parse(ahora) <= Date.now() + 1000, ahora);
});
