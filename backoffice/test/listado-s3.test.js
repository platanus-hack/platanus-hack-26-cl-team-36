// El costo en S3 del refresco del Overview (lib/indice.js, LISTADO_MS): las corridas nuevas se buscan listando el
// almacén a lo más cada LISTADO_MS; entre listados cada pasada relee solo lo abierto. Con el S3 falso, contando LIST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearFuenteS3 } from "../lib/fuentes/s3.js";
import { LISTADO_MS } from "../lib/indice.js";
import { crearPanel } from "../lib/panel.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";
import { clienteDynamoFalso, clienteS3Falso, comandosDynamo, comandosS3 } from "./aws-falso.js";

const AHORA = "2026-11-22T03:36:49.000Z";
const TABLA = "chameleon-revisiones";
const BUCKET = "chameleon-almacen-000000000000";
const CATALOGO = "uno.test/cataloger/2026-11-22T03-00-00Z";
const GUIA = "uno.test/guide/b/desktop/2026-11-22T03-10-00Z";
const LISTA = "uno.test/visitor/a/2026-11-22T03-05-00Z";
const CORRIENDO = "uno.test/visitor/b/2026-11-22T03-20-00Z";
const NUEVA = "uno.test/visitor/a/2026-11-22T03-30-00Z";

const run = (viewport, outcome) =>
  JSON.stringify({ viewport, start: { url: "https://www.uno.test/", title: "Inicio | Uno", screenshot: "step_00.png" }, verdict: { outcome } });
const tandaTerminada = (clave) => ({
  [`${clave}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
  [`${clave}/route_tree.json`]: "{}",
  [`${clave}/desktop/run.json`]: run("1024x768", "success"),
  [`${clave}/desktop/step_00.png`]: "png",
  [`${clave}/mobile/run.json`]: run("390x844", "failed"),
  [`${clave}/mobile/step_00.png`]: "png",
});

function almacen() {
  const objetos = {
    [`${CATALOGO}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${CATALOGO}/goals.json`]: JSON.stringify({ goals: [{ id: "a", instruction: "Hacer A" }, { id: "b", instruction: "Hacer B" }] }),
    [`${GUIA}/manifest.json`]: JSON.stringify({ status: "running" }),
    ...tandaTerminada(LISTA),
    [`${CORRIENDO}/manifest.json`]: JSON.stringify({ status: "running" }),
    [`${CORRIENDO}/desktop/run.json`]: run("1024x768", "abandoned"),
    [`${CORRIENDO}/mobile/trace.json`]: JSON.stringify({ status: "running", profile: "mobile" }),
  };
  const cliente = clienteS3Falso(BUCKET, objetos, { porPagina: 1000 });
  return { objetos, cliente, fuente: crearFuenteS3({ bucket: BUCKET, cliente, comandos: comandosS3 }) };
}

const item = (revision, SK, status, run_key) => ({ PK: `REV#${revision}`, SK, status, run_key, updated_at: "2026-11-22T03:35:00.000Z" });
const ITEMS = [
  { PK: "REV#corre", SK: "META", url: "https://www.uno.test/", host: "uno.test", status: "running", goals_total: 2, created_at: "2026-11-22T03:00:00.000Z", updated_at: "2026-11-22T03:35:00.000Z" },
  item("corre", "STAGE#cataloger", "succeeded", CATALOGO),
  item("corre", "GOAL#a#guide", "succeeded"),
  item("corre", "GOAL#a#visitor", "succeeded", LISTA),
  item("corre", "GOAL#b#guide", "running", GUIA),
  item("corre", "GOAL#b#visitor", "running", CORRIENDO),
];

function armar({ items = [...ITEMS], listadoMs } = {}) {
  const s3 = almacen();
  const revisiones = crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, items, { porPagina: 50 }), comandos: comandosDynamo });
  const panel = crearPanel({ fuente: s3.fuente, revisiones, reloj: () => new Date(AHORA), memoriaMs: 0, listadoMs });
  // Lo que pidió cada pasada: los prefijos listados y las claves leídas.
  const pedidos = () => {
    const llamadas = s3.cliente.llamadas.splice(0);
    const de = (nombre, campo) => llamadas.filter((c) => c.constructor.name === nombre).map((c) => c.input[campo]);
    return { listados: de("ListObjectsV2Command", "Prefix"), leidos: de("GetObjectCommand", "Key"), cabezas: de("HeadObjectCommand", "Key") };
  };
  const pasada = async () => {
    const [resumen, overview] = await Promise.all([panel.resumen(), panel.overview()]);
    return { resumen, overview, ...pedidos() };
  };
  return { ...s3, items, panel, pasada };
}

test("LISTADO_MS: 30 s, documentado", () => {
  assert.equal(LISTADO_MS, 30_000);
});

test("dos pasadas dentro del plazo: un solo listado; la segunda relee solo lo abierto", async () => {
  const { pasada } = armar({ listadoMs: 60_000 });
  const primera = await pasada();
  assert.ok(primera.listados.includes(""), "la primera lista el almacén desde la raíz");
  const segunda = await pasada();
  assert.deepEqual(segunda.listados, [`${CORRIENDO}/`], "solo la carpeta de la tanda que corre (intentos nuevos)");
  assert.deepEqual(
    [...new Set(segunda.leidos)].sort(),
    [`${CORRIENDO}/manifest.json`, `${CORRIENDO}/mobile/run.json`, `${CORRIENDO}/mobile/trace.json`, `${GUIA}/manifest.json`].sort(),
    "solo manifests e intentos de lo abierto",
  );
  assert.deepEqual(segunda.cabezas, []);
  assert.deepEqual(segunda.resumen, primera.resumen);
});

test("pasado el plazo se vuelve a listar y aparece una corrida nueva", async () => {
  const { pasada, objetos } = armar({ listadoMs: 40 });
  const antes = (await pasada()).resumen.roles.cataloger.logrado;
  objetos["uno.test/cataloger/2026-11-22T03-40-00Z/manifest.json"] = JSON.stringify({ status: "succeeded" });
  const dentro = await pasada();
  assert.equal(dentro.resumen.roles.cataloger.logrado, antes, "dentro del plazo todavía no se ve");
  assert.ok(!dentro.listados.includes(""));
  await new Promise((listo) => setTimeout(listo, 50));
  const despues = await pasada();
  assert.ok(despues.listados.includes(""), "volvió a listar");
  assert.equal(despues.resumen.roles.cataloger.logrado, antes + 1);
});

test("una corrida en curso que termina entre pasadas se ve terminada en la siguiente, sin esperar el listado", async () => {
  const { pasada, objetos } = armar({ listadoMs: 60_000 });
  const primera = await pasada();
  assert.deepEqual([primera.resumen.roles.guide.en_curso, primera.resumen.roles.visitor.mobile.en_curso], [1, 1]);
  assert.equal(primera.overview.tarjetas.corre.goals.find((g) => g.goal === "b").tanda, null, "corre: todavía no se lista");

  objetos[`${GUIA}/manifest.json`] = JSON.stringify({ status: "succeeded" });
  objetos[`${CORRIENDO}/mobile/run.json`] = run("390x844", "success");
  objetos[`${CORRIENDO}/route_tree.json`] = "{}";
  objetos[`${CORRIENDO}/manifest.json`] = JSON.stringify({ status: "succeeded" });
  const segunda = await pasada();
  assert.ok(!segunda.listados.includes(""), "sin volver a listar el almacén");
  const { guide, visitor } = segunda.resumen.roles;
  assert.deepEqual([guide.en_curso, guide.logrado, visitor.mobile.en_curso, visitor.mobile.logrado], [0, primera.resumen.roles.guide.logrado + 1, 0, 1 + primera.resumen.roles.visitor.mobile.logrado]);
  assert.equal(segunda.overview.tarjetas.corre.goals.find((g) => g.goal === "b").tanda, CORRIENDO, "terminada: su tanda ya se lista");

  const tercera = await pasada();
  assert.deepEqual([tercera.listados, tercera.leidos], [[], []], "todo cerrado: nada que releer");
});

test("una run_key que la tabla nombra antes del próximo listado: su tarjeta la lee igual", async () => {
  const { pasada, objetos, items } = armar({ listadoMs: 60_000 });
  await pasada();
  Object.assign(objetos, tandaTerminada(NUEVA));
  items.push(
    { PK: "REV#nueva", SK: "META", url: "https://www.uno.test/", host: "uno.test", status: "done", created_at: "2026-11-22T03:30:00.000Z", updated_at: "2026-11-22T03:36:00.000Z" },
    item("nueva", "GOAL#a#guide", "succeeded"),
    item("nueva", "GOAL#a#visitor", "succeeded", NUEVA),
  );
  const { overview, listados } = await pasada();
  assert.ok(!listados.includes(""), "sin volver a listar");
  const [goal] = overview.tarjetas.nueva.goals;
  assert.deepEqual([goal.goal, goal.tanda, goal.intentos.map((i) => `${i.estado}/${i.dispositivo}`)], ["a", NUEVA, ["logrado/desktop", "fallido/mobile"]]);
  assert.equal(overview.tarjetas.nueva.capturas.desktop.tanda, NUEVA);
});

test("/archivos/ sirve una tanda nueva dentro del plazo: si el id no está, lista en fresco antes del 404", async () => {
  const { fuente, objetos, cliente } = almacen();
  const servidor = crearServidor({ fuente });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  const pedir = async (ruta) => {
    const respuesta = await fetch(`http://127.0.0.1:${servidor.address().port}/backoffice/archivos/${ruta}`);
    await respuesta.arrayBuffer();
    return respuesta.status;
  };
  const listados = () => cliente.contar("ListObjectsV2Command");
  try {
    assert.equal(await pedir(`${LISTA}/desktop/step_00.png`), 200);
    Object.assign(objetos, tandaTerminada(NUEVA));
    const antes = listados();
    assert.equal(await pedir(`${NUEVA}/desktop/step_00.png`), 200, "la tanda nueva se sirve sin esperar LISTADO_MS");
    assert.ok(listados() > antes, "listó en fresco");
    const despues = listados();
    assert.equal(await pedir(`${NUEVA}/mobile/step_00.png`), 200);
    assert.equal(await pedir(`${LISTA}/mobile/step_00.png`), 200);
    assert.equal(listados(), despues, "la lista fresca queda guardada");
    assert.equal(await pedir(`${CORRIENDO}/desktop/step_00.png`), 404, "una que corre sigue sin servirse");
  } finally {
    servidor.close();
  }
});
