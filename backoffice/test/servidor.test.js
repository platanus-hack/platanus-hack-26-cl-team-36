import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { crearServidor, hostPermitido, leerRango } from "../servidor.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const TANDA = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
const NUEVA = "demo.cl/visitor/tarea-demo/2026-11-21T11-00-00Z";
let servidor;
let base;

before(async () => {
  servidor = crearServidor({ raizCorridas: RAIZ });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

// El backoffice cuelga de /backoffice/; pedirEnRaiz pide fuera de él (la portada).
const pedir = (ruta, opciones) => fetch(`${base}/backoffice${ruta}`, opciones);
const pedirEnRaiz = (ruta, opciones) => fetch(`${base}${ruta}`, opciones);

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
  const noExiste = await pedir("/api/tandas/demo.cl/visitor/tarea-demo/2099-01-01T00-00-00Z");
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

test("GET /api/propuestas/<tanda> devuelve la propuesta del Diseñador que leyó la tanda", async () => {
  const respuesta = await pedir(`/api/propuestas/${TANDA}`);
  assert.equal(respuesta.status, 200);
  const propuesta = await respuesta.json();
  assert.equal(propuesta.estado, "succeeded");
  assert.equal(propuesta.corrida, "demo.cl/improver/2026-11-21T10-30-00Z");
  assert.deepEqual(propuesta.cambios.map((cambio) => cambio.tipo), ["texto", "interlineado", "enlaces"]);
  assert.equal(propuesta.vistas[0].capturas.desktop.despues, "demo.cl/improver/2026-11-21T10-30-00Z/vistas/01-desktop-despues.png");
  // Una tanda que ningún Diseñador leyó no tiene propuesta; una que no existe, 404.
  assert.equal((await (await pedir(`/api/propuestas/${NUEVA}`)).json()).estado, "ninguna");
  assert.equal((await pedir("/api/propuestas/demo.cl/visitor/tarea-demo/2099-01-01T00-00-00Z")).status, 404);
  assert.equal((await pedir("/api/propuestas/..%2F..%2Fpackage.json")).status, 404);
});

test("de una corrida del Diseñador solo sirve sus capturas vistas/*.png", async () => {
  const captura = await pedir("/propuestas/demo.cl/improver/2026-11-21T10-30-00Z/vistas/01-desktop-antes.png");
  assert.equal(captura.status, 200);
  assert.equal(captura.headers.get("content-type"), "image/png");
  for (const ruta of [
    "/propuestas/demo.cl/improver/2026-11-21T10-30-00Z/mejora.json",
    "/propuestas/demo.cl/improver/2026-11-21T10-30-00Z/manifest.json",
    "/propuestas/demo.cl/improver/2026-11-21T10-30-00Z/vistas/%2E%2E/manifest.json",
    "/propuestas/demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z/first_time/step_01.png",
    "/propuestas/demo.cl/improver/2026-11-21T10-30-00Z/vistas/no-existe.png",
  ]) {
    assert.equal((await pedir(ruta)).status, 404, ruta);
  }
});

test("sirve la página con su política de seguridad", async () => {
  const pagina = await pedir("/");
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /<main/);
  assert.match(pagina.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await pedir("/app.js")).status, 200);
});

test("la raíz es la portada: dice work in progress y no enlaza al backoffice", async () => {
  const portada = await pedirEnRaiz("/");
  assert.equal(portada.status, 200);
  assert.equal(portada.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(portada.headers.get("content-security-policy"), /script-src 'self'/);
  const html = await portada.text();
  assert.match(html, /Work in progress/);
  assert.doesNotMatch(html, /backoffice/i);
  assert.equal((await pedirEnRaiz("/estilos.css")).headers.get("content-type"), "text/css; charset=utf-8");
  for (const archivo of ["/logo.svg", "/favicon.svg"]) {
    const respuesta = await pedirEnRaiz(archivo);
    assert.equal(respuesta.status, 200, archivo);
    assert.equal(respuesta.headers.get("content-type"), "image/svg+xml", archivo);
  }
});

test("/backoffice redirige a /backoffice/, con la consulta", async () => {
  const sinBarra = await pedirEnRaiz("/backoffice", { redirect: "manual" });
  assert.equal(sinBarra.status, 301);
  assert.equal(sinBarra.headers.get("location"), "/backoffice/");
  const conConsulta = await pedirEnRaiz("/backoffice?idioma=en", { redirect: "manual" });
  assert.equal(conConsulta.headers.get("location"), "/backoffice/?idioma=en");
});

test("fuera de /backoffice/ no se sirve nada del backoffice", async () => {
  for (const ruta of [
    "/api/tandas",
    `/archivos/${TANDA}/first_time/step_01.png`,
    "/resultados/demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z/manifest.json",
    "/app.js",
    "/i18n/es/datos.js",
    "/index.html/x",
    "/servidor.js",
    "/package.json",
    "/portada/index.html",
    "/backofficex/app.js",
    "/%62ackoffice/api/tandas",
  ]) {
    const respuesta = await pedirEnRaiz(ruta);
    assert.ok([400, 404].includes(respuesta.status), `${ruta} respondió ${respuesta.status}`);
  }
});

test("sirve cualquier archivo de public/, también en subcarpetas", async () => {
  const diccionario = await pedir("/i18n/es/datos.js");
  assert.equal(diccionario.status, 200);
  assert.equal(diccionario.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await pedir("/datos/textos.js")).status, 200);
  assert.equal((await pedir("/i18n")).status, 404, "una carpeta no se sirve");
});

test("sirve three.js de public/vendor como módulo, y nada fuera de una versión exacta", async () => {
  const three = await pedir("/vendor/three@0.160.0/three.module.js", { method: "HEAD" });
  assert.equal(three.status, 200);
  assert.equal(three.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await pedir("/vendor/three@0.160.0/LICENSE")).status, 404);
  assert.equal((await pedir("/vendor/three@latest/three.module.js")).status, 404);
  assert.equal((await pedir("/telarana/x@1.0.0/modelo.js")).status, 404, "las versiones solo bajo vendor/");
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

// fetch no deja cambiar la cabecera Host: se pide con node:http.
function pedirConHost(ruta, host) {
  return new Promise((listo, falla) => {
    const { port } = servidor.address();
    const pedido = request({ host: "127.0.0.1", port, path: ruta, headers: { Host: host } }, (respuesta) => {
      respuesta.resume();
      respuesta.on("end", () => listo(respuesta.statusCode));
    });
    pedido.on("error", falla);
    pedido.end();
  });
}

test("solo responde a Host de este computador con su puerto (DNS rebinding)", async () => {
  const { port } = servidor.address();
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
    assert.equal(await pedirConHost("/backoffice/api/tandas", host), 200, host);
  }
  for (const host of [`atacante.example:${port}`, "atacante.example", `localhost:${port + 1}`, `localhost.atacante.example:${port}`]) {
    assert.equal(await pedirConHost("/backoffice/api/tandas", host), 403, host);
  }
  assert.equal(await pedirConHost(`/backoffice/archivos/${TANDA}/first_time/step_00.png`, `atacante.example:${port}`), 403);
  assert.equal(await pedirConHost("/", `atacante.example:${port}`), 403);
});

test("GET /salud responde con cualquier Host (health check del balanceador); el resto sigue cerrado", async () => {
  const { port } = servidor.address();
  for (const host of ["10.0.1.23:4848", "atacante.example", `localhost:${port}`]) {
    assert.equal(await pedirConHost("/salud", host), 200, host);
  }
  assert.equal(await pedirConHost("/salud/", "10.0.1.23:4848"), 403);
  assert.equal(await pedirConHost("/salud?x=/api/tandas", "10.0.1.23:4848"), 403);
  assert.equal(await pedirConHost("/backoffice/api/tandas", "10.0.1.23:4848"), 403);
  assert.deepEqual(await (await pedirEnRaiz("/salud")).json(), { ok: true });
});

test("hostPermitido: puerto por defecto y hosts extra", () => {
  assert.equal(hostPermitido("localhost", 80), true);
  assert.equal(hostPermitido("localhost", 4848), false);
  assert.equal(hostPermitido("backoffice.interno:8080", 4848, new Set(["backoffice.interno:8080"])), true);
  assert.equal(hostPermitido(undefined, 4848), false);
  assert.equal(hostPermitido("", 4848), false);
});
