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
  const { tarjetas, pestanas } = await panel.overview();
  // Las en cola son tarjetas (§7.3): en Recent y en Live, más nuevas primero.
  assert.deepEqual(pestanas.recent.ids, ["espera", "corre", "lista", "mala", "roja"]);
  assert.deepEqual(pestanas.live.ids, ["espera", "corre"]);
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

const puntero = (url, revision) => ({ PK: `URL#${url}`, SK: "URL", revision });

test("vigentes: dos revisiones de la misma página son una tarjeta, la que apunta URL#<url>, con cuántas reemplazó", async () => {
  const { panel } = armar({ items: [...ITEMS, puntero("https://uno.test", "corre"), puntero("https://uno.test/otra", "espera")] });
  const { tarjetas, pestanas, cuentas } = await panel.overview();
  assert.deepEqual(pestanas.recent.ids, ["espera", "corre"]);
  assert.deepEqual([cuentas.total, cuentas.delivered, pestanas.delivered.ids], [2, 0, []], "las entregadas reemplazadas no cuentan");
  assert.deepEqual([tarjetas.corre.estado, tarjetas.corre.anteriores, tarjetas.espera.anteriores], ["running", 3, 0]);
});

test("vigentes: una fallida reemplazada queda fuera de las pestañas; una fallida vigente sale en failed", async () => {
  const items = [
    meta("vieja", "failed", { created_at: "2026-11-22T01:00:00.000Z" }),
    meta("nueva", "done", { created_at: "2026-11-22T02:00:00.000Z" }),
    puntero("https://uno.test", "nueva"),
    meta("rota", "failed", { url: "https://www.uno.test/rota", created_at: "2026-11-22T01:30:00.000Z" }),
    meta("rota-antes", "done", { url: "https://www.uno.test/rota", created_at: "2026-11-22T00:30:00.000Z" }),
    puntero("https://uno.test/rota", "rota"),
  ];
  const { panel } = armar({ items });
  const { pestanas, cuentas } = await panel.overview();
  assert.deepEqual(pestanas.recent.ids, ["nueva", "rota"]);
  assert.deepEqual(pestanas.failed, { ids: ["rota"], total: 1 });
  assert.deepEqual(pestanas.delivered, { ids: ["nueva"], total: 1 });
  assert.deepEqual([cuentas.total, cuentas.failed], [2, 1]);
  assert.equal((await panel.tarjeta("vieja")).estado, "failed", "una reemplazada sigue teniendo tarjeta a pedido");
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
  assert.equal(llamadas.listarCorridas, 1, "dentro de LISTADO_MS no se vuelve a listar el almacén");
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

// 20 revisiones entregadas más, para paginar Delivered (§7.4).
const VIEJAS = Array.from({ length: 20 }, (_, i) =>
  meta(`vieja-${String(i).padStart(2, "0")}`, "done", { created_at: `2026-11-21T${String(i).padStart(2, "0")}:00:00.000Z` }),
);

test("páginas: no se mezclan en la memoria; la larga trae las tarjetas de la corta, iguales y en orden; lo cerrado no se relee", async () => {
  const { panel, cliente } = armar({ items: [...ITEMS, ...VIEJAS], memoriaMs: 60_000 });
  const consultadas = () => cliente.llamadas.filter((c) => c.constructor.name === "QueryCommand").map((c) => c.input.ExpressionAttributeValues[":pk"].replace(/^REV#/, ""));
  const corta = await panel.overview();
  const antes = consultadas().length;
  const larga = await panel.overview({ pestana: "delivered", limite: "16" });

  assert.equal(corta.pestanas.delivered.ids.length, 6);
  assert.equal(larga.pestanas.delivered.ids.length, 16);
  assert.equal(larga.pestanas.delivered.total, corta.pestanas.delivered.total);
  assert.deepEqual(larga.pestanas.delivered.ids.slice(0, 6), corta.pestanas.delivered.ids);
  for (const otra of ["recent", "live", "failed"]) assert.deepEqual(larga.pestanas[otra], corta.pestanas[otra], otra);
  const deLaCorta = Object.keys(corta.tarjetas);
  for (const id of deLaCorta) assert.deepEqual(larga.tarjetas[id], corta.tarjetas[id], id);
  assert.deepEqual(Object.keys(larga.tarjetas).filter((id) => deLaCorta.includes(id)), deLaCorta, "en el mismo orden");
  assert.ok(larga.pestanas.delivered.ids.every((id) => larga.tarjetas[id]), "una tarjeta por cada id devuelto");

  // Solo se consultan las cerradas que se suman (y la que está en cola, que no se guarda).
  const sumadas = Object.keys(larga.tarjetas).filter((id) => !deLaCorta.includes(id));
  assert.equal(sumadas.length, 10);
  assert.deepEqual(consultadas().slice(antes).sort(), [...sumadas, "espera"].sort());

  // Cada página tiene su lugar en la memoria (un parámetro inválido es la página de siempre).
  assert.equal(await panel.overview(), corta);
  assert.equal(await panel.overview({ pestana: "delivered", limite: 16 }), larga);
  assert.equal(await panel.overview({ pestana: "delivered", limite: "5" }), corta);
  assert.equal(await panel.overview({ pestana: "otra", limite: "16" }), corta);
  assert.notEqual(await panel.overview({ pestana: "delivered", limite: "26" }), larga);
});

test("servidor: ?pestana=&limite= pagina la pestaña pedida (6 por defecto, inválido o menor que 6 vale 6, tope 500)", async () => {
  const { fuente } = armar();
  const conViejas = crearServidor({
    fuente,
    revisiones: crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, [...ITEMS, ...VIEJAS]), comandos: comandosDynamo }),
    reloj: RELOJ,
  });
  await new Promise((listo) => conViejas.listen(0, "127.0.0.1", listo));
  try {
    const pestanas = async (consulta) => (await (await fetch(`${base(conViejas)}/api/overview${consulta}`)).json()).pestanas;
    const largos = async (consulta) => Object.fromEntries(Object.entries(await pestanas(consulta)).map(([nombre, p]) => [nombre, [p.ids.length, p.total]]));
    assert.deepEqual(await largos(""), { recent: [6, 25], live: [2, 2], delivered: [6, 23], failed: [0, 0] });
    assert.deepEqual(await largos("?pestana=delivered&limite=16"), { recent: [6, 25], live: [2, 2], delivered: [16, 23], failed: [0, 0] });
    assert.deepEqual(await largos("?pestana=recent&limite=500"), { recent: [25, 25], live: [2, 2], delivered: [6, 23], failed: [0, 0] });
    assert.deepEqual(await largos("?pestana=delivered&limite=999"), { recent: [6, 25], live: [2, 2], delivered: [23, 23], failed: [0, 0] }, "tope");
    for (const consulta of ["?pestana=delivered&limite=abc", "?pestana=delivered&limite=3", "?pestana=delivered&limite=10.5", "?limite=16", "?pestana=nada&limite=16"]) {
      assert.deepEqual(await largos(consulta), await largos(""), consulta);
    }
  } finally {
    conViejas.close();
  }
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
  assert.deepEqual(Object.keys(overview), ["ahora", "disponible", "umbralDetenidaMin", "cuentas", "pestanas", "tarjetas"]);
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
