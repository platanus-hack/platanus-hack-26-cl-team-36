import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearServidor } from "../servidor.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const TANDA = "tarea-demo/2026-11-21_10-00-00";
let servidor;
let base;

before(async () => {
  servidor = crearServidor({ raizCorridas: RAIZ });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const pedir = (ruta, opciones) => fetch(`${base}${ruta}`, opciones);

test("GET /api/tandas lista las tandas", async () => {
  const respuesta = await pedir("/api/tandas");
  assert.equal(respuesta.status, 200);
  const lista = await respuesta.json();
  assert.deepEqual(lista.map((t) => t.id), [TANDA]);
});

test("GET /api/tandas/<id> devuelve la tanda derivada", async () => {
  const respuesta = await pedir(`/api/tandas/${TANDA}`);
  assert.equal(respuesta.status, 200);
  const tanda = await respuesta.json();
  assert.equal(tanda.intentos.length, 3);
  assert.ok(tanda.telarana.ruta);
  assert.equal((await pedir("/api/tandas/tarea-demo/2099-01-01_00-00-00")).status, 404);
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

test("es de solo lectura", async () => {
  assert.equal((await pedir("/api/tandas", { method: "POST" })).status, 405);
});

test("un rango de bytes devuelve 206", async () => {
  const respuesta = await pedir(`/archivos/${TANDA}/first_time/step_01.png`, { headers: { Range: "bytes=0-3" } });
  assert.equal(respuesta.status, 206);
  assert.equal((await respuesta.arrayBuffer()).byteLength, 4);
});
