import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearFuente } from "../lib/fuente.js";
import { crearFuenteDeArchivos } from "../lib/fuentes/archivos.js";
import { crearFuenteS3, parsearAlmacen } from "../lib/fuentes/s3.js";
import { leerTanda, listarTandas } from "../lib/tandas.js";
import { crearServidor } from "../servidor.js";
import { CLAVES_DE_EJEMPLO, CORRIDAS_DE_EJEMPLO } from "./almacen-en-memoria.js";
import { clienteS3Falso, comandosS3, objetosDeCarpeta } from "./aws-falso.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const BUCKET = "chameleon-almacen-000000000000";
const ID = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
const EN_CURSO = "demo.cl/visitor/tarea-demo/2026-11-21T13-00-00Z";
const CATALOGO = "demo.cl/cataloger/2026-11-21T09-00-00Z";

function almacen(prefijo = "") {
  const objetos = {
    ...objetosDeCarpeta(RAIZ, prefijo),
    [`${prefijo}${CATALOGO}/manifest.json`]: JSON.stringify({ agent: "cataloger", status: "succeeded" }),
    [`${prefijo}${CATALOGO}/goals.json`]: JSON.stringify({ goals: [{ id: "tarea-demo" }] }),
    [`${prefijo}demo.cl/improver/2026-11-21T14-00-00Z/tema.css`]: "html.mi-tema body { color: red; }",
    [`${prefijo}otro-prefijo-que-no-es-host_/x.json`]: "{}",
  };
  const cliente = clienteS3Falso(BUCKET, objetos);
  return { objetos, cliente, fuente: crearFuenteS3({ bucket: BUCKET, prefijo, cliente, comandos: comandosS3 }) };
}

const texto = async (cuerpo) => Buffer.concat(await cuerpo.toArray()).toString("latin1");

test("parsearAlmacen: bucket y prefijo normalizado", () => {
  assert.deepEqual(parsearAlmacen(`s3://${BUCKET}`), { bucket: BUCKET, prefijo: "" });
  assert.deepEqual(parsearAlmacen(`s3://${BUCKET}/`), { bucket: BUCKET, prefijo: "" });
  assert.deepEqual(parsearAlmacen(`s3://${BUCKET}/runs/v1/`), { bucket: BUCKET, prefijo: "runs/v1/" });
  assert.throws(() => parsearAlmacen(undefined), /BACKOFFICE_ALMACEN/);
  assert.throws(() => parsearAlmacen("https://bucket/x"), /BACKOFFICE_ALMACEN/);
});

test("crearFuente elige s3 con su cliente, y sin cliente falla con un mensaje claro", () => {
  const { cliente } = almacen();
  const fuente = crearFuente({ tipo: "s3", almacen: `s3://${BUCKET}/corridas`, s3: { cliente, comandos: comandosS3 } });
  assert.equal(fuente.descripcion, `s3://${BUCKET}/corridas/`);
  assert.throws(() => crearFuente({ tipo: "s3", almacen: `s3://${BUCKET}` }), /cliente de S3/);
});

for (const prefijo of ["", "corridas/"]) {
  test(`fuente S3 (prefijo «${prefijo}»): lista lo mismo que la de archivos y deriva las mismas tandas`, async () => {
    const { fuente } = almacen(prefijo);
    const local = crearFuenteDeArchivos({ raiz: RAIZ });
    assert.deepEqual((await fuente.listarIds()).sort(), (await local.listarIds()).sort());
    const [s3, disco] = await Promise.all([listarTandas(fuente), listarTandas(local)]);
    assert.equal(s3.carpeta, `s3://${BUCKET}/${prefijo}`);
    assert.deepEqual(s3.tandas, disco.tandas);
    assert.deepEqual(await leerTanda(fuente, ID), await leerTanda(local, ID));
    assert.equal(await leerTanda(fuente, EN_CURSO), null, "una corrida en curso no es una tanda");
  });
}

test("fuente S3: perfiles, JSON, existe, archivos y rangos", async (t) => {
  const { fuente, objetos } = almacen();
  await fuente.listarIds();
  assert.deepEqual((await fuente.listarPerfiles(ID)).sort(), ["first_time", "hurried", "mobile"]);
  assert.equal((await fuente.leerJson(ID, "route_tree.json")).task_id, "tarea-demo");
  assert.deepEqual(await fuente.leerJsonDetallado(ID, "no-existe.json"), { datos: null, estado: "falta" });
  assert.equal(await fuente.existe(ID, "first_time/step_01.png"), true);
  assert.equal(await fuente.existe(ID, "first_time/video.webm"), false);
  assert.equal(await fuente.abrirArchivo(ID, "first_time/step_99.png"), null);

  const bytes = objetos[`${ID}/first_time/step_01.png`];
  const entero = await fuente.abrirArchivo(ID, "first_time/step_01.png");
  assert.deepEqual([entero.tamano, entero.rango], [bytes.length, null]);
  assert.equal(await texto(entero.cuerpo), bytes.toString("latin1"));
  const parte = await fuente.abrirArchivo(ID, "first_time/step_01.png", { inicio: 1, fin: 3 });
  assert.deepEqual(parte.rango, { inicio: 1, fin: 3 });
  assert.equal(await texto(parte.cuerpo), bytes.subarray(1, 4).toString("latin1"));
  const final = await fuente.abrirArchivo(ID, "first_time/step_01.png", { fin: 5 });
  assert.deepEqual(final.rango, { inicio: bytes.length - 5, fin: bytes.length - 1 });
  final.cuerpo.destroy();
  const fuera = await fuente.abrirArchivo(ID, "first_time/step_01.png", { inicio: 10_000 });
  assert.deepEqual([fuera.cuerpo, fuera.rango, fuera.tamano], [null, null, bytes.length]);

  // Un JSON dañado se dice una vez en la consola.
  const consola = t.mock.method(console, "error", () => {});
  objetos[`${ID}/criteria.json`] = "{ roto";
  const otra = crearFuenteS3({ bucket: BUCKET, cliente: clienteS3Falso(BUCKET, objetos), comandos: comandosS3 });
  assert.equal((await otra.leerJsonDetallado(ID, "criteria.json")).estado, "danado");
  assert.equal((await otra.leerJsonDetallado(ID, "criteria.json")).estado, "danado");
  assert.equal(consola.mock.callCount(), 1);
});

test("fuente S3: lo de una corrida cerrada se lee una vez; una en curso se vuelve a mirar hasta que termina", async () => {
  const { fuente, cliente, objetos } = almacen();
  await listarTandas(fuente);
  const desde = cliente.llamadas.length;
  await listarTandas(fuente);
  const nuevas = cliente.llamadas.slice(desde);
  const leidas = nuevas.filter((c) => c.constructor.name !== "ListObjectsV2Command").map((c) => c.input.Key);
  assert.deepEqual(leidas, [`${EN_CURSO}/manifest.json`], "solo el manifiesto de la corrida en curso");
  assert.ok(nuevas.some((c) => c.constructor.name === "ListObjectsV2Command"), "vuelve a listar: puede haber corridas nuevas");

  // La corrida en curso termina bien: aparece.
  const manifiesto = JSON.parse(objetos[`${EN_CURSO}/manifest.json`]);
  objetos[`${EN_CURSO}/manifest.json`] = JSON.stringify({ ...manifiesto, status: "succeeded" });
  assert.ok((await fuente.listarIds()).includes(EN_CURSO));
});

test("fuente S3: una corrida de otro agente se abre por su clave (resultados de una revisión)", async () => {
  const { fuente } = almacen();
  const goals = await fuente.abrirArchivo(CATALOGO, "goals.json");
  assert.match(await texto(goals.cuerpo), /tarea-demo/);
});

for (const prefijo of ["", "corridas/"]) {
  test(`fuente S3 (prefijo «${prefijo}»): listarCorridas ve los cuatro roles, terminadas o no, y nada fuera del layout`, async () => {
    const objetos = Object.fromEntries(Object.entries(CORRIDAS_DE_EJEMPLO).map(([clave, valor]) => [`${prefijo}${clave}`, valor]));
    const fuente = crearFuenteS3({ bucket: BUCKET, prefijo, cliente: clienteS3Falso(BUCKET, objetos), comandos: comandosS3 });
    assert.deepEqual((await fuente.listarCorridas()).sort(), CLAVES_DE_EJEMPLO);
    assert.deepEqual(await fuente.listarIds(), [], "listarIds sigue pidiendo route_tree.json");
  });
}

test("fuente S3: leerTexto guarda el de una corrida cerrada y vuelve a leer el de una en curso", async () => {
  const objetos = { ...CORRIDAS_DE_EJEMPLO, "demo.cl/improver/2026-11-21T15-00-00Z/tema.css": "html.mi-tema { --mi-acento: #123; }" };
  const cliente = clienteS3Falso(BUCKET, objetos);
  const fuente = crearFuenteS3({ bucket: BUCKET, cliente, comandos: comandosS3 });
  const CERRADA = "demo.cl/improver/2026-11-21T14-00-00Z";
  const EN_CURSO = "demo.cl/improver/2026-11-21T15-00-00Z";
  const lecturasDe = (clave) => cliente.llamadas.filter((c) => c.constructor.name === "GetObjectCommand" && c.input.Key === clave).length;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await fuente.leerTexto(CERRADA, "tema.css"), "html.mi-tema { --mi-acento: #ABC; }");
    assert.equal(await fuente.leerTexto(EN_CURSO, "tema.css"), "html.mi-tema { --mi-acento: #123; }");
  }
  assert.equal(lecturasDe(`${CERRADA}/tema.css`), 1, "cerrada: una sola vez");
  assert.equal(lecturasDe(`${EN_CURSO}/tema.css`), 3, "en curso: cada vez");
  assert.equal(await fuente.leerTexto(CERRADA, "no-existe.css"), null);
});

let servidor;
let base;
before(async () => {
  servidor = crearServidor({ fuente: almacen().fuente });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}/backoffice`;
});
after(() => servidor.close());

test("el servidor sirve tandas y resultados desde S3", async () => {
  const lista = await (await fetch(`${base}/api/tandas`)).json();
  assert.ok(lista.tandas.some((tanda) => tanda.id === ID));
  const captura = await fetch(`${base}/archivos/${ID}/first_time/step_01.png`, { headers: { Range: "bytes=0-3" } });
  assert.equal(captura.status, 206);
  assert.equal((await captura.arrayBuffer()).byteLength, 4);

  const goals = await fetch(`${base}/resultados/${CATALOGO}/goals.json`);
  assert.equal(goals.status, 200);
  assert.match(goals.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await goals.json(), { goals: [{ id: "tarea-demo" }] });
  const tema = await fetch(`${base}/resultados/demo.cl/improver/2026-11-21T14-00-00Z/tema.css`);
  assert.equal(tema.status, 200);
  assert.match(tema.headers.get("content-type"), /^text\/plain/, "un tema no se sirve como hoja de estilos");
  assert.equal(tema.headers.get("x-content-type-options"), "nosniff");

  // Solo los archivos de resultado de una clave de corrida válida.
  for (const ruta of [
    `${ID}/first_time/run.json`,
    `${ID}/criteria.json`,
    `${CATALOGO}/outline.json`,
    "demo.cl/cataloger/no-es-corrida/goals.json",
    `demo.cl/guide/tarea-demo/2026-11-21T10-00-00Z/route.json`,
    "demo.cl/improver/2026-11-21T15-00-00Z/tema.css",
  ]) {
    assert.equal((await fetch(`${base}/resultados/${ruta}`)).status, 404, ruta);
  }
});
