import { test } from "node:test";
import assert from "node:assert/strict";
import { crearDescargas } from "../lib/descargas.js";
import { almacenEnMemoria } from "./almacen-en-memoria.js";

const ULTIMA = "_descargas/firefox/ultima.json";

test("descargas: la última versión sale de ultima.json y el archivo se arma con la versión", async () => {
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "0.6.0", publicado: "2026-11-22T07:46:23Z", archivo: "../otro.xpi" }) });
  assert.deepEqual(await crearDescargas(almacen).firefox(), {
    version: "0.6.0",
    archivo: "chameleon-mode-0.6.0.xpi",
    publicado: "2026-11-22T07:46:23.000Z",
  });
});

test("descargas: sin ultima.json, con una versión que no es X.Y.Z o con JSON dañado, no hay versión", async () => {
  for (const contenido of [undefined, "{", JSON.stringify({ version: "v0.6.0" }), JSON.stringify({ version: "0.6" }), JSON.stringify({ version: "1.0.0/../x" }), JSON.stringify({ version: 6 })]) {
    const almacen = almacenEnMemoria(contenido === undefined ? {} : { [ULTIMA]: contenido });
    assert.equal(await crearDescargas(almacen).firefox(), null, String(contenido));
  }
});

test("descargas: una fecha que no se entiende queda en null, la versión sigue", async () => {
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "1.2.3", publicado: "ayer" }) });
  assert.equal((await crearDescargas(almacen).firefox()).publicado, null);
});

test("descargas: ultima.json se relee a lo más una vez por minuto", async () => {
  let ahora = 0;
  const almacen = almacenEnMemoria({ [ULTIMA]: JSON.stringify({ version: "0.6.0" }) });
  const descargas = crearDescargas(almacen, { reloj: () => ahora });
  await descargas.firefox();
  almacen.escribir(ULTIMA, JSON.stringify({ version: "0.7.0" }));
  ahora = 59_000;
  assert.equal((await descargas.firefox()).version, "0.6.0");
  ahora = 60_000;
  assert.equal((await descargas.firefox()).version, "0.7.0");
});

test("descargas: solo abre .xpi con el nombre de una versión", async () => {
  const almacen = almacenEnMemoria({ "_descargas/firefox/chameleon-mode-0.6.0.xpi": Buffer.from("xpi"), "_descargas/firefox/ultima.json": "{}" });
  const descargas = crearDescargas(almacen);
  assert.equal((await descargas.abrirXpi("chameleon-mode-0.6.0.xpi")).tamano, 3);
  assert.equal(await descargas.abrirXpi("chameleon-mode-0.7.0.xpi"), null);
  for (const nombre of ["ultima.json", "../ultima.json", "chameleon-mode-0.6.0.xpi/", "chameleon-mode-06.0.0.xpi", "x.xpi"]) {
    assert.equal(descargas.abrirXpi(nombre), null, nombre);
  }
});
