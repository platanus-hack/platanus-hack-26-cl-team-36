// Compresión (brotli y gzip según Accept-Encoding, Vary, nunca con Range ni SSE), ETag y 304, la caché inmutable de
// vendor/ y de v/<versión>/, las URL versionadas de la página (un despliegue nuevo no sirve módulos de otro) y las
// precargas.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { elegirCodificacion, esComprimible, importsDe } from "../lib/estaticos.js";
import { crearServidor } from "../servidor.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const PUBLICO = fileURLToPath(new URL("../public", import.meta.url));
const TANDA = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
let servidor;
let puerto;

const escuchar = async (opciones) => {
  const nuevo = crearServidor(opciones);
  await new Promise((listo) => nuevo.listen(0, "127.0.0.1", listo));
  return nuevo;
};

before(async () => {
  servidor = await escuchar({ raizCorridas: RAIZ });
  puerto = servidor.address().port;
});
after(() => servidor.close());

/** GET crudo (sin descomprimir, a diferencia de fetch): → { estado, cabeceras, cuerpo: Buffer }. */
function pedir(ruta, cabeceras = {}, { a = puerto, metodo = "GET" } = {}) {
  return new Promise((resolver, rechazar) => {
    const pedido = request({ host: "127.0.0.1", port: a, path: `/backoffice${ruta}`, method: metodo, headers: { Host: `localhost:${a}`, ...cabeceras } }, (respuesta) => {
      const partes = [];
      respuesta.on("data", (parte) => partes.push(parte));
      respuesta.on("end", () => resolver({ estado: respuesta.statusCode, cabeceras: respuesta.headers, cuerpo: Buffer.concat(partes) }));
    });
    pedido.on("error", rechazar);
    pedido.end();
  });
}

const descomprimir = ({ cabeceras, cuerpo }) =>
  cabeceras["content-encoding"] === "br" ? brotliDecompressSync(cuerpo) : cabeceras["content-encoding"] === "gzip" ? gunzipSync(cuerpo) : cuerpo;

async function versionActual(a = puerto) {
  const pagina = (await pedir("/", {}, { a })).cuerpo.toString("utf8");
  return /src="v\/([0-9a-f]{12})\/app\.js"/.exec(pagina)?.[1];
}

test("Accept-Encoding: br si se acepta, si no gzip; q=0 lo excluye", () => {
  assert.equal(elegirCodificacion("gzip, deflate, br, zstd"), "br");
  assert.equal(elegirCodificacion("gzip, deflate"), "gzip");
  assert.equal(elegirCodificacion("br;q=0, gzip;q=0.5"), "gzip");
  assert.equal(elegirCodificacion("*"), "br");
  assert.equal(elegirCodificacion("identity"), null);
  assert.equal(elegirCodificacion(undefined), null);
  assert.equal(esComprimible("text/javascript; charset=utf-8"), true);
  assert.equal(esComprimible("application/json; charset=utf-8"), true);
  assert.equal(esComprimible("image/svg+xml"), true);
  assert.equal(esComprimible("text/event-stream; charset=utf-8"), false, "el SSE de /api/vivo va sin comprimir");
  assert.equal(esComprimible("image/png"), false);
  assert.equal(esComprimible("video/webm"), false);
});

test("un módulo va con brotli o gzip según Accept-Encoding, con Vary, y descomprime al original", async () => {
  const tal = await pedir("/nucleo/enrutador.js");
  assert.equal(tal.cabeceras["content-encoding"], undefined);
  assert.equal(tal.cabeceras.vary, "Accept-Encoding");
  for (const [aceptada, codificacion] of [["gzip, deflate, br", "br"], ["gzip", "gzip"]]) {
    const comprimida = await pedir("/nucleo/enrutador.js", { "Accept-Encoding": aceptada });
    assert.equal(comprimida.estado, 200);
    assert.equal(comprimida.cabeceras["content-encoding"], codificacion);
    assert.equal(comprimida.cabeceras.vary, "Accept-Encoding");
    assert.equal(Number(comprimida.cabeceras["content-length"]), comprimida.cuerpo.length);
    assert.ok(comprimida.cuerpo.length < tal.cuerpo.length / 2, `${codificacion} achica`);
    assert.deepEqual(descomprimir(comprimida), tal.cuerpo);
  }
});

test("la API va comprimida y sigue sin guardarse; una captura no se comprime", async () => {
  const tal = await pedir(`/api/tandas/${TANDA}`);
  const comprimida = await pedir(`/api/tandas/${TANDA}`, { "Accept-Encoding": "br" });
  assert.equal(comprimida.cabeceras["content-encoding"], "br");
  assert.equal(comprimida.cabeceras["cache-control"], "no-store");
  assert.equal(comprimida.cabeceras.vary, "Accept-Encoding");
  assert.deepEqual(JSON.parse(descomprimir(comprimida)), JSON.parse(tal.cuerpo));
  const captura = await pedir(`/archivos/${TANDA}/first_time/step_01.png`, { "Accept-Encoding": "br, gzip" });
  assert.equal(captura.cabeceras["content-encoding"], undefined);
  assert.equal(captura.cabeceras.vary, undefined);
});

test("un pedido con Range no se comprime", async () => {
  const conRango = await pedir("/nucleo/enrutador.js", { "Accept-Encoding": "br", Range: "bytes=0-99" });
  assert.equal(conRango.cabeceras["content-encoding"], undefined);
});

test("ETag: un If-None-Match vigente responde 304 sin cuerpo, con cualquier codificación; uno viejo, 200", async () => {
  for (const ruta of ["/", "/app.js", "/estilos/base.css"]) {
    const primera = await pedir(ruta, { "Accept-Encoding": "br" });
    const etag = primera.cabeceras.etag;
    assert.match(etag, /^"[\w-]+"$/, ruta);
    assert.equal(primera.cabeceras["cache-control"], "no-cache", `${ruta}: se guarda, pero se revalida`);
    const otra = await pedir(ruta, { "If-None-Match": etag });
    assert.equal(otra.estado, 304, `${ruta}: la etiqueta de la versión br vale para la sin comprimir`);
    assert.equal(otra.cuerpo.length, 0);
    assert.equal(otra.cabeceras.etag, (await pedir(ruta)).cabeceras.etag);
    assert.equal((await pedir(ruta, { "If-None-Match": '"otra"' })).estado, 200, ruta);
  }
});

test("vendor/<lib>@x.y.z/ y v/<versión>/ son inmutables; lo demás de public/ se revalida", async () => {
  const inmutable = "public, max-age=31536000, immutable";
  assert.equal((await pedir("/vendor/three@0.160.0/three.module.js", {}, { metodo: "HEAD" })).cabeceras["cache-control"], inmutable);
  const version = await versionActual();
  assert.match(version, /^[0-9a-f]{12}$/);
  for (const ruta of ["app.js", "nucleo/enrutador.js", "estilos/base.css", "vendor/three@0.160.0/three.module.js"]) {
    const respuesta = await pedir(`/v/${version}/${ruta}`, {}, { metodo: "HEAD" });
    assert.equal(respuesta.estado, 200, ruta);
    assert.equal(respuesta.cabeceras["cache-control"], inmutable, ruta);
  }
  assert.equal((await pedir("/app.js")).cabeceras["cache-control"], "no-cache");
  // La validación de rutas de public/ sigue igual bajo la versión.
  for (const ruta of [`/v/${version}/servidor.js`, `/v/${version}/../servidor.js`, `/v/${version}/vendor/three@latest/three.module.js`]) {
    assert.equal((await pedir(ruta)).estado, 404, ruta);
  }
});

test("la página pide todo lo suyo bajo la versión y precarga los módulos de nucleo/ y, por pantalla, los suyos", async () => {
  const version = await versionActual();
  const pagina = (await pedir("/")).cuerpo.toString("utf8");
  const propias = [...pagina.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((partes) => partes[1]).filter((url) => !/^https?:/.test(url));
  assert.ok(propias.length > 5);
  for (const url of propias) assert.ok(url.startsWith(`v/${version}/`), url);
  for (const modulo of ["nucleo/enrutador.js", "nucleo/datos.js", "nucleo/rutas.js", "i18n/en/comun.js"]) {
    assert.ok(pagina.includes(`<link rel="modulepreload" href="v/${version}/${modulo}">`), modulo);
  }
  assert.ok(!pagina.includes(`modulepreload" href="v/${version}/vendor/`), "three no se precarga en todas las vistas");
  const telarana = /<meta name="precarga:telarana" content="([^"]+)">/.exec(pagina)?.[1].split(" ") ?? [];
  for (const archivo of ["pantallas/telarana.js", "telarana/escena.js", "vendor/three@0.160.0/three.module.js", "estilos/telarana.css"]) {
    assert.ok(telarana.includes(`v/${version}/${archivo}`), archivo);
  }
  assert.ok(!telarana.includes(`v/${version}/nucleo/dom.js`), "lo que ya precarga la página no se repite");
});

test("importsDe lee los imports relativos, también los de varias líneas, y no los tipos de JSDoc", () => {
  const texto = [
    'import { a } from "./a.js";',
    "import {\n  b,\n  c,\n} from '../b.js';",
    'import * as THREE from "../vendor/three@0.160.0/three.module.js";',
    'import "./efecto.js";',
    'export { d } from "./d.js";',
    '/** @param {import("../../lib/derivar.js").Firma} firma */',
    'const e = await import(`./pantallas/${id}.js`);',
    'import { f } from "paquete";',
  ].join("\n");
  assert.deepEqual(importsDe(texto), ["./a.js", "../b.js", "../vendor/three@0.160.0/three.module.js", "./efecto.js", "./d.js"]);
});

test("un despliegue nuevo no sirve módulos de otra versión: 404, nunca una mezcla", async () => {
  const carpeta = await mkdtemp(path.join(tmpdir(), "backoffice-versiones-"));
  const vieja = path.join(carpeta, "vieja");
  const nueva = path.join(carpeta, "nueva");
  await cp(PUBLICO, vieja, { recursive: true });
  await cp(PUBLICO, nueva, { recursive: true });
  await writeFile(path.join(nueva, "nucleo", "dom.js"), "export const cambio = 1;\n", { flag: "a" });
  const [deVieja, deNueva] = await Promise.all([escuchar({ raizCorridas: RAIZ, publico: vieja }), escuchar({ raizCorridas: RAIZ, publico: nueva })]);
  try {
    const a = deVieja.address().port;
    const b = deNueva.address().port;
    const [versionVieja, versionNueva] = [await versionActual(a), await versionActual(b)];
    assert.notEqual(versionVieja, versionNueva, "cambiar un archivo cambia la versión");
    assert.equal((await pedir(`/v/${versionVieja}/nucleo/dom.js`, {}, { a })).estado, 200);
    const mezcla = await pedir(`/v/${versionVieja}/nucleo/dom.js`, {}, { a: b });
    assert.equal(mezcla.estado, 404, "el despliegue nuevo no responde por la versión vieja");
    assert.equal(mezcla.cabeceras["cache-control"], "no-store");
    assert.equal((await pedir(`/v/${versionNueva}/app.js`, {}, { a })).estado, 404, "ni el viejo por la nueva");
    assert.ok((await pedir(`/v/${versionNueva}/nucleo/dom.js`, {}, { a: b })).cuerpo.toString("utf8").endsWith("export const cambio = 1;\n"));

    // En el mismo proceso (npm run dev), un archivo editado cambia la versión (se revisa a lo más cada segundo).
    await writeFile(path.join(vieja, "app.js"), "// editado\n", { flag: "a" });
    const futuro = new Date(Date.now() + 5000);
    await utimes(path.join(vieja, "app.js"), futuro, futuro);
    await new Promise((listo) => setTimeout(listo, 1100));
    const editada = await versionActual(a);
    assert.notEqual(editada, versionVieja);
    assert.equal((await pedir(`/v/${versionVieja}/app.js`, {}, { a })).estado, 404);
    assert.ok((await pedir(`/v/${editada}/app.js`, {}, { a })).cuerpo.toString("utf8").endsWith("// editado\n"));
  } finally {
    deVieja.close();
    deNueva.close();
    await rm(carpeta, { recursive: true, force: true });
  }
});
