import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearFuente } from "../lib/fuente.js";
import { crearFuenteDeArchivos } from "../lib/fuentes/archivos.js";
import { ABIERTA_MS, FIRMA_S, VENTANA_S, crearFuenteS3, parsearAlmacen } from "../lib/fuentes/s3.js";
import { idsDeTandas, leerTanda, listarTandas } from "../lib/tandas.js";
import { crearServidor } from "../servidor.js";
import { CLAVES_DE_EJEMPLO, CORRIDAS_DE_EJEMPLO } from "./almacen-en-memoria.js";
import { clienteS3Falso, comandosS3, firmarFalso, objetosDeCarpeta } from "./aws-falso.js";

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
  const { fuente, objetos, cliente } = almacen();
  await fuente.listarIds();
  assert.deepEqual((await fuente.listarPerfiles(ID)).sort(), ["first_time", "hurried", "mobile"]);
  assert.equal((await fuente.leerJson(ID, "route_tree.json")).task_id, "tarea-demo");
  assert.deepEqual(await fuente.leerJsonDetallado(ID, "no-existe.json"), { datos: null, estado: "falta" });
  assert.equal(await fuente.existe(ID, "first_time/step_01.png"), true);
  assert.equal(await fuente.existe(ID, "first_time/video.webm"), false);
  assert.equal(await fuente.abrirArchivo(ID, "first_time/step_99.png"), null);

  const bytes = objetos[`${ID}/first_time/step_01.png`];
  const pedidos = cliente.llamadas.length;
  const entero = await fuente.abrirArchivo(ID, "first_time/step_01.png");
  assert.deepEqual([entero.tamano, entero.rango], [bytes.length, null]);
  assert.deepEqual(cliente.llamadas.slice(pedidos).map((comando) => comando.constructor.name), ["GetObjectCommand"], "entero: un solo GET");
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

test("fuente S3: lo de una corrida cerrada se lee una vez; una en curso se vuelve a mirar pasado ABIERTA_MS", async () => {
  const { cliente, objetos } = almacen();
  let ahora = 0;
  const fuente = crearFuenteS3({ bucket: BUCKET, cliente, comandos: comandosS3, reloj: () => ahora });
  await listarTandas(fuente);
  const desde = cliente.llamadas.length;
  await listarTandas(fuente);
  assert.equal(cliente.llamadas.length, desde, "dentro de LISTA_MS: la lista guardada y lo leído de las cerradas");

  const leidasAlListar = async () => {
    const antes = cliente.llamadas.length;
    const ids = await fuente.listarIds();
    const nuevas = cliente.llamadas.slice(antes);
    return { ids, leidas: nuevas.filter((c) => c.constructor.name !== "ListObjectsV2Command").map((c) => c.input.Key) };
  };
  assert.deepEqual((await leidasAlListar()).leidas, [], "la en curso, dentro de ABIERTA_MS: sin releer su manifiesto");
  ahora += ABIERTA_MS;
  assert.deepEqual((await leidasAlListar()).leidas, [`${EN_CURSO}/manifest.json`], "pasado el plazo: solo el manifiesto de la en curso");

  // La corrida en curso termina bien: aparece pasado el plazo.
  const manifiesto = JSON.parse(objetos[`${EN_CURSO}/manifest.json`]);
  objetos[`${EN_CURSO}/manifest.json`] = JSON.stringify({ ...manifiesto, status: "succeeded" });
  assert.ok(!(await fuente.listarIds()).includes(EN_CURSO));
  ahora += ABIERTA_MS;
  assert.ok((await fuente.listarIds()).includes(EN_CURSO));
});

test("idsDeTandas: los que piden a la vez comparten una pasada, se guarda LISTA_MS y `fresca` vuelve a listar", async () => {
  const { fuente, cliente } = almacen();
  const listados = () => cliente.contar("ListObjectsV2Command");
  const [a, b] = await Promise.all([idsDeTandas(fuente), idsDeTandas(fuente)]);
  assert.equal(a, b, "la misma lista");
  const unaPasada = listados();
  assert.deepEqual(await idsDeTandas(fuente), a);
  assert.equal(listados(), unaPasada, "guardada");
  const fresca = await idsDeTandas(fuente, { fresca: true });
  assert.ok(listados() > unaPasada, "fresca: vuelve a listar");
  assert.equal(await idsDeTandas(fuente), fresca, "y queda como la compartida");
});

test("leerTanda ve una tanda que terminó después de la lista guardada, aunque la fuente la recuerde abierta", async () => {
  const { fuente, objetos } = almacen();
  assert.ok(!(await listarTandas(fuente)).tandas.some((tanda) => tanda.id === EN_CURSO));
  const manifiesto = JSON.parse(objetos[`${EN_CURSO}/manifest.json`]);
  objetos[`${EN_CURSO}/manifest.json`] = JSON.stringify({ ...manifiesto, status: "succeeded" });
  assert.equal((await leerTanda(fuente, EN_CURSO))?.id, EN_CURSO);
  assert.equal(await leerTanda(fuente, "no/es/un-id"), null);
});

test("idsDeTandas: un error no se guarda", async () => {
  let fallar = true;
  const fuente = {
    async listarIds() {
      if (fallar) throw new Error("caído");
      return [ID];
    },
  };
  await assert.rejects(idsDeTandas(fuente), /caído/);
  fallar = false;
  assert.deepEqual(await idsDeTandas(fuente), [ID]);
});

test("fuente S3: URL firmada con el tipo y el caché pedidos, la misma dentro de una ventana de VENTANA_S", async () => {
  const { cliente } = almacen("corridas/");
  let ahora = Date.UTC(2026, 10, 22, 10, 0, 1);
  const fuente = crearFuenteS3({ bucket: BUCKET, prefijo: "corridas/", region: "us-east-2", cliente, comandos: comandosS3, firmar: firmarFalso, reloj: () => ahora });
  assert.equal(fuente.origenDeDescargas, `https://${BUCKET}.s3.us-east-2.amazonaws.com`);
  const pedir = () => fuente.urlDeDescarga(ID, "first_time/step_01.png", { tipo: "image/png", cache: "private, max-age=1" });
  const url = new URL(await pedir());
  assert.equal(url.origin, fuente.origenDeDescargas);
  assert.equal(url.pathname, `/corridas/${ID}/first_time/step_01.png`);
  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    { tipo: "image/png", cache: "private, max-age=1", vence: String(FIRMA_S), firmada: "2026-11-22T10:00:00.000Z" },
  );
  ahora += (VENTANA_S - 2) * 1000;
  assert.equal(await pedir(), url.href, "dentro de la ventana: la misma URL");
  ahora += 2000;
  assert.notEqual(await pedir(), url.href, "otra ventana, otra firma");
  assert.equal(cliente.llamadas.length, 0, "firmar no llama a S3");

  const sinFirma = crearFuenteS3({ bucket: BUCKET, cliente, comandos: comandosS3 });
  assert.equal(sinFirma.urlDeDescarga, undefined);
  assert.equal(sinFirma.origenDeDescargas, undefined);
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

test("fuente S3: existe de un archivo suelto de una corrida cerrada sale de su carpeta ya listada, sin HEAD", async () => {
  const { fuente, cliente } = almacen();
  const cabezas = () => cliente.contar("HeadObjectCommand");
  await fuente.listarPerfiles(ID); // corrida cerrada: su carpeta queda guardada
  assert.deepEqual([await fuente.existe(ID, "route_tree.json"), await fuente.existe(ID, "no-existe.json")], [true, false]);
  assert.equal(cabezas(), 0);
  assert.equal(await fuente.existe(ID, "first_time/step_01.png"), true, "dentro de un perfil, con HEAD");
  assert.equal(cabezas(), 1);
  await fuente.listarPerfiles(EN_CURSO);
  assert.equal(await fuente.existe(EN_CURSO, "route_tree.json"), true);
  assert.equal(await fuente.existe(EN_CURSO, "route_tree.json"), true);
  assert.equal(cabezas(), 3, "una en curso se vuelve a mirar");
});

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
