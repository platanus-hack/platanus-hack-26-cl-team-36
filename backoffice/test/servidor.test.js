import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearServidor, leerRango } from "../servidor.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const TANDA = "tarea-demo/2026-11-21_10-00-00";
const NUEVA = "tarea-demo/2026-11-21_11-00-00";
let servidor;
let base;

before(async () => {
  servidor = crearServidor({ raizCorridas: RAIZ });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const pedir = (ruta, opciones) => fetch(`${base}${ruta}`, opciones);

test("GET /api/tandas lista las tandas con la carpeta de donde salen", async () => {
  const respuesta = await pedir("/api/tandas");
  assert.equal(respuesta.status, 200);
  const { carpeta, tandas } = await respuesta.json();
  assert.equal(carpeta, "backoffice/test/fixtures/corridas");
  assert.deepEqual(tandas.map((t) => t.id), [NUEVA, TANDA]);
});

test("GET /api/tandas/<id> devuelve la tanda derivada", async () => {
  const respuesta = await pedir(`/api/tandas/${TANDA}`);
  assert.equal(respuesta.status, 200);
  const tanda = await respuesta.json();
  assert.equal(tanda.intentos.length, 3);
  assert.ok(tanda.telarana.ruta);
  assert.deepEqual(tanda.vecinas.siguiente, NUEVA);
  const noExiste = await pedir("/api/tandas/tarea-demo/2099-01-01_00-00-00");
  assert.equal(noExiste.status, 404);
  assert.deepEqual(await noExiste.json(), { error: "No existe esa tanda" });
});

test("sirve capturas y nada más de una corrida", async () => {
  const captura = await pedir(`/archivos/${TANDA}/first_time/step_01.png`);
  assert.equal(captura.status, 200);
  assert.equal(captura.headers.get("content-type"), "image/png");
  for (const ruta of [
    `/archivos/${TANDA}/first_time/run.json`,
    `/archivos/${TANDA}/%2E%2E/step_01.png`,
    `/archivos/tarea-demo%2F..%2F..%2F/first_time/step_01.png`,
    `/archivos/${TANDA}/first_time/step_99.png`,
    `/archivos/${TANDA}/first_time/%E0%A4%A.png`,
    "/api/tandas/..%2F..%2Fpackage.json",
    "/servidor.js",
    "/lib/tandas.js",
    "/package.json",
    "/../servidor.js",
    "/%2E%2E/servidor.js",
    "/nucleo/%2E%2E/%2E%2E/servidor.js",
    "/no-existe.js",
    "/i18n/es/no-existe.js",
    "/Mayusculas.js",
  ]) {
    const respuesta = await pedir(ruta);
    assert.ok([400, 404].includes(respuesta.status), `${ruta} respondió ${respuesta.status}`);
  }
});

test("sirve la página con su política de seguridad", async () => {
  const pagina = await pedir("/");
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /<main/);
  assert.match(pagina.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await pedir("/app.js")).status, 200);
});

test("sirve cualquier archivo de public/, también en subcarpetas", async () => {
  const diccionario = await pedir("/i18n/es/datos.js");
  assert.equal(diccionario.status, 200);
  assert.equal(diccionario.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await pedir("/datos/textos.js")).status, 200);
  assert.equal((await pedir("/i18n")).status, 404, "una carpeta no se sirve");
});

test("HEAD de una captura no manda el cuerpo", async () => {
  const respuesta = await pedir(`/archivos/${TANDA}/first_time/step_01.png`, { method: "HEAD" });
  assert.equal(respuesta.status, 200);
  assert.ok(Number(respuesta.headers.get("content-length")) > 0);
});

test("leerRango entiende las formas de la cabecera Range", () => {
  assert.deepEqual(leerRango("bytes=0-99"), { inicio: 0, fin: 99 });
  assert.deepEqual(leerRango("bytes=100-"), { inicio: 100 });
  assert.deepEqual(leerRango("bytes=-500"), { fin: 500 });
  assert.equal(leerRango("bytes=-"), null);
  assert.equal(leerRango("items=0-1"), null);
  assert.equal(leerRango(undefined), null);
});

test("es de solo lectura", async () => {
  assert.equal((await pedir("/api/tandas", { method: "POST" })).status, 405);
});

test("un rango de bytes devuelve 206", async () => {
  const respuesta = await pedir(`/archivos/${TANDA}/first_time/step_01.png`, { headers: { Range: "bytes=0-3" } });
  assert.equal(respuesta.status, 206);
  assert.equal((await respuesta.arrayBuffer()).byteLength, 4);
  assert.match(respuesta.headers.get("content-range"), /^bytes 0-3\/\d+$/);
  const fuera = await pedir(`/archivos/${TANDA}/first_time/step_01.png`, { headers: { Range: "bytes=99999-" } });
  assert.equal(fuera.status, 416);
});
