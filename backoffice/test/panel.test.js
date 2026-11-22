// El Overview de punta a punta sobre un almacén y una tabla en memoria (lib/panel.js y servidor.js): lo que se lee
// por pasada, lo que se guarda y lo que nunca se lee.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { memorizar } from "../lib/memoria.js";
import { crearPanel } from "../lib/panel.js";
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
    [`${TEMA}/mejora.json`]: JSON.stringify({ vistas: [{ url: "https://www.uno.test/", titulo: "Inicio", capturas: {
      desktop: { antes: "vistas/escritorio-antes.png", despues: "vistas/escritorio-despues.png" },
      mobile: { antes: "vistas/movil-antes.png", despues: "../movil-despues.png" } } }] }),
    [`${CATALOGO}/mejora.json`]: JSON.stringify({ vistas: [{ url: "https://www.uno.test/", capturas: { desktop: { despues: "vistas/escritorio-despues.png" } } }] }),
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
    { goal: "b", instruccion: "Hacer B", intentos: [{ estado: "abandonado", dispositivo: "desktop" }, { estado: "en_curso", dispositivo: "mobile" }], espera: false, tanda: null, visitante: "running" },
    { goal: "a", instruccion: "Hacer A", intentos: [{ estado: "fallido", dispositivo: "desktop" }, { estado: "error", dispositivo: "desktop" }], espera: false, tanda: LISTA, visitante: "succeeded" },
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
  // El Diseñador terminó con vistas: su «después» encima de la del Visitante; una ruta fuera de vistas/ no sale.
  assert.deepEqual(tarjetas.lista.capturas, {
    desktop: { tanda: ENTREGADA_B, carpeta: "desktop", archivo: "step_00.png", despues: `${TEMA}/vistas/escritorio-despues.png` },
    mobile: { tanda: VIEJA, carpeta: "mobile", archivo: "step_00.png" },
  });
  assert.equal(tarjetas.roja.capturas.desktop?.despues, undefined, "sin mejora.json, la del Visitante");
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
  assert.deepEqual(pestanas.failed, { ids: ["rota"], total: 1, pagina: 1, paginas: 1 });
  assert.deepEqual(pestanas.delivered, { ids: ["nueva"], total: 1, pagina: 1, paginas: 1 });
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
  assert.ok(!fuente.lecturas.includes(`${CATALOGO}/mejora.json`), "ni su mejora.json");
  assert.equal(mala.capturas.desktop.despues, undefined);
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

test("páginas: cada una con sus 6 tarjetas, sin mezclarse en la memoria; lo cerrado no se relee", async () => {
  const { panel, cliente } = armar({ items: [...ITEMS, ...VIEJAS], memoriaMs: 60_000 });
  const consultadas = () => cliente.llamadas.filter((c) => c.constructor.name === "QueryCommand").map((c) => c.input.ExpressionAttributeValues[":pk"].replace(/^REV#/, ""));
  const primera = await panel.overview();
  const antes = consultadas().length;
  const segunda = await panel.overview({ pestana: "delivered", pagina: "2" });

  assert.equal(primera.pestanas.delivered.ids.length, 6);
  assert.equal(segunda.pestanas.delivered.ids.length, 6);
  assert.deepEqual([primera.pestanas.delivered.pagina, segunda.pestanas.delivered.pagina], [1, 2]);
  assert.equal(segunda.pestanas.delivered.total, primera.pestanas.delivered.total);
  assert.equal(segunda.pestanas.delivered.paginas, Math.ceil(primera.pestanas.delivered.total / 6));
  assert.ok(segunda.pestanas.delivered.ids.every((id) => !primera.pestanas.delivered.ids.includes(id)), "otra página, otras revisiones");
  for (const otra of ["recent", "live", "failed"]) assert.deepEqual(segunda.pestanas[otra], primera.pestanas[otra], otra);
  assert.ok(segunda.pestanas.delivered.ids.every((id) => segunda.tarjetas[id]), "una tarjeta por cada id devuelto");
  for (const id of Object.keys(primera.tarjetas).filter((id) => segunda.tarjetas[id])) assert.deepEqual(segunda.tarjetas[id], primera.tarjetas[id], id);

  // Solo se consultan las cerradas que la página suma (y la que está en cola, que no se guarda).
  const nuevas = Object.keys(segunda.tarjetas).filter((id) => !primera.tarjetas[id]);
  assert.equal(nuevas.length, 6);
  assert.deepEqual(consultadas().slice(antes).sort(), [...nuevas, "espera"].sort());

  // Cada página tiene su lugar en la memoria (un parámetro inválido o la página 1 es la página de siempre).
  assert.equal(await panel.overview(), primera);
  assert.equal(await panel.overview({ pestana: "delivered", pagina: 2 }), segunda);
  assert.equal(await panel.overview({ pestana: "delivered", pagina: "1" }), primera);
  assert.equal(await panel.overview({ pestana: "otra", pagina: "2" }), primera);
  assert.notEqual(await panel.overview({ pestana: "delivered", pagina: "3" }), segunda);
});
test("servidor: ?link= deja solo las revisiones cuyo link calza, en cifras y pestañas, y dice qué buscó", async () => {
  const items = [
    meta("metro", "done", { url: "https://www.metro.cl/", created_at: "2026-11-22T03:00:00.000Z" }),
    meta("metro-horarios", "failed", { url: "https://www.metro.cl/horarios", created_at: "2026-11-22T02:00:00.000Z" }),
    meta("dt", "done", { url: "https://www.dt.gob.cl/portal/1626/w3-channel.html", created_at: "2026-11-22T01:00:00.000Z" }),
  ];
  const { fuente } = armar();
  const conLinks = crearServidor({
    fuente,
    revisiones: crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, items), comandos: comandosDynamo }),
    reloj: RELOJ,
  });
  await new Promise((listo) => conLinks.listen(0, "127.0.0.1", listo));
  try {
    const pedir = async (consulta) => (await fetch(`${base(conLinks)}/api/overview${consulta}`)).json();
    const todas = await pedir("");
    assert.deepEqual([todas.busqueda, todas.cuentas.total], [null, 3]);
    const metro = await pedir("?link=Metro");
    assert.equal(metro.busqueda, "metro", "normalizada");
    assert.deepEqual(metro.pestanas.recent.ids, ["metro", "metro-horarios"]);
    assert.deepEqual([metro.cuentas.total, metro.cuentas.delivered, metro.cuentas.failed], [2, 1, 1]);
    assert.deepEqual(Object.keys(metro.tarjetas).sort(), ["metro", "metro-horarios"]);
    // Pegar el link entero, con protocolo y www, también lo encuentra; con varias palabras, cada una debe estar.
    assert.deepEqual((await pedir(`?link=${encodeURIComponent("https://www.metro.cl/horarios/")}`)).pestanas.recent.ids, ["metro-horarios"]);
    assert.deepEqual((await pedir("?link=portal%201626")).pestanas.recent.ids, ["dt"]);
    assert.deepEqual((await pedir("?link=nada")).pestanas.recent, { ids: [], total: 0, pagina: 1, paginas: 1 });
    // La búsqueda y la página van juntas: la página pedida es de lo que calza.
    assert.deepEqual((await pedir("?link=metro&pestana=failed&pagina=1")).pestanas.failed.ids, ["metro-horarios"]);
    // Solo espacios es sin búsqueda.
    assert.equal((await pedir("?link=%20%20")).busqueda, null);
  } finally {
    conLinks.close();
  }
});

test("servidor: ?pestana=&pagina= da esa página de 6 de la pestaña pedida (la 1 si es inválida; más allá, la última)", async () => {
  const { fuente } = armar();
  const conViejas = crearServidor({
    fuente,
    revisiones: crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, [...ITEMS, ...VIEJAS]), comandos: comandosDynamo }),
    reloj: RELOJ,
  });
  await new Promise((listo) => conViejas.listen(0, "127.0.0.1", listo));
  try {
    const pestanas = async (consulta) => (await (await fetch(`${base(conViejas)}/api/overview${consulta}`)).json()).pestanas;
    // [ids, total, página, páginas] de cada pestaña
    const largos = async (consulta) =>
      Object.fromEntries(Object.entries(await pestanas(consulta)).map(([nombre, p]) => [nombre, [p.ids.length, p.total, p.pagina, p.paginas]]));
    const primera = { recent: [6, 25, 1, 5], live: [2, 2, 1, 1], delivered: [6, 23, 1, 4], failed: [0, 0, 1, 1] };
    assert.deepEqual(await largos(""), primera);
    assert.deepEqual(await largos("?pestana=delivered&pagina=2"), { ...primera, delivered: [6, 23, 2, 4] });
    assert.deepEqual(await largos("?pestana=delivered&pagina=4"), { ...primera, delivered: [5, 23, 4, 4] }, "la última, con lo que queda");
    assert.deepEqual(await largos("?pestana=recent&pagina=5"), { ...primera, recent: [1, 25, 5, 5] });
    assert.deepEqual(await largos("?pestana=delivered&pagina=99"), { ...primera, delivered: [5, 23, 4, 4] }, "más allá, la última");
    for (const consulta of ["?pestana=delivered&pagina=abc", "?pestana=delivered&pagina=0", "?pestana=delivered&pagina=2.5", "?pagina=2", "?pestana=nada&pagina=2", "?pestana=delivered&limite=16"]) {
      assert.deepEqual(await largos(consulta), primera, consulta);
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
  assert.deepEqual(Object.keys(overview), ["ahora", "disponible", "umbralDetenidaMin", "busqueda", "cuentas", "pestanas", "tarjetas"]);
  assert.equal(overview.busqueda, null, "sin búsqueda");
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
