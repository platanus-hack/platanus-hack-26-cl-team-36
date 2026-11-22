import { test } from "node:test";
import assert from "node:assert/strict";
import { crearDescargas } from "../lib/descargas.js";
import { almacenEnMemoria } from "./almacen-en-memoria.js";

const ULTIMA = "_descargas/firefox/ultima.json";

test("descargas: la última versión sale de ultima.json y el archivo se arma con la versión", async () => {
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "0.6.0", publicado: "2026-11-22T07:46:23Z", archivo: "../otro.xpi" }) });
  assert.deepEqual(await crearDescargas(almacen).ultima("firefox"), {
    version: "0.6.0",
    archivo: "chameleon-mode-0.6.0.xpi",
    publicado: "2026-11-22T07:46:23.000Z",
  });
});

test("descargas: sin ultima.json, con una versión que no es X.Y.Z o con JSON dañado, no hay versión", async () => {
  for (const contenido of [undefined, "{", JSON.stringify({ version: "v0.6.0" }), JSON.stringify({ version: "0.6" }), JSON.stringify({ version: "1.0.0/../x" }), JSON.stringify({ version: 6 })]) {
    const almacen = almacenEnMemoria(contenido === undefined ? {} : { [ULTIMA]: contenido });
    assert.equal(await crearDescargas(almacen).ultima("firefox"), null, String(contenido));
  }
});

test("descargas: una fecha que no se entiende queda en null, la versión sigue", async () => {
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "1.2.3", publicado: "ayer" }) });
  assert.equal((await crearDescargas(almacen).ultima("firefox")).publicado, null);
});

test("descargas: ultima.json se relee a lo más una vez por minuto", async () => {
  let ahora = 0;
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "0.6.0" }) });
  const descargas = crearDescargas(almacen, { reloj: () => ahora });
  await descargas.ultima("firefox");
  almacen.escribir(ULTIMA, JSON.stringify({ version: "0.7.0" }));
  ahora = 59_000;
  assert.equal((await descargas.ultima("firefox")).version, "0.6.0");
  ahora = 60_000;
  assert.equal((await descargas.ultima("firefox")).version, "0.7.0");
});

test("descargas: Chrome tiene su propio ultima.json y su .zip; un navegador desconocido no tiene versión", async () => {
  const almacen = almacenEnMemoria({
    "_descargas/chrome/ultima.json": JSON.stringify({ version: "0.7.0" }),
    "_descargas/chrome/chameleon-mode-chrome-0.7.0.zip": Buffer.from("zip"),
  });
  const descargas = crearDescargas(almacen);
  assert.deepEqual(await descargas.ultima("chrome"), { version: "0.7.0", archivo: "chameleon-mode-chrome-0.7.0.zip", publicado: null });
  assert.equal(await descargas.ultima("firefox"), null);
  for (const navegador of ["edge", "__proto__", "constructor", ""]) assert.equal(await descargas.ultima(navegador), null, navegador);
  assert.equal((await descargas.abrir("chameleon-mode-chrome-0.7.0.zip")).tamano, 3);
});

test("descargas: solo abre .xpi con el nombre de una versión", async () => {
  const almacen = almacenEnMemoria({ "_descargas/firefox/chameleon-mode-0.6.0.xpi": Buffer.from("xpi"), "_descargas/firefox/ultima.json": "{}" });
  const descargas = crearDescargas(almacen);
  assert.equal((await descargas.abrir("chameleon-mode-0.6.0.xpi")).tamano, 3);
  assert.equal(await descargas.abrir("chameleon-mode-0.7.0.xpi"), null);
  for (const nombre of ["ultima.json", "../ultima.json", "chameleon-mode-0.6.0.xpi/", "chameleon-mode-06.0.0.xpi", "x.xpi", "chameleon-mode-0.6.0.zip", "chameleon-mode-chrome-0.6.0.xpi"]) {
    assert.equal(descargas.abrir(nombre), null, nombre);
  }
});
